import { Bold, Braces, Code2, ImageIcon, Italic, Link2, Redo2, Underline, Undo2, Unlink, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/controls';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Menu, MenuItem, MenuSeparator, Popover, Tooltip } from '@/components/ui/overlay';
import { cn } from '@/lib/cn';
import type { CustomField } from '@/lib/types';

export const CORE_TAGS = [
  { key: 'first_name', label: 'First name', fallback: 'there' },
  { key: 'last_name', label: 'Last name', fallback: '' },
  { key: 'full_name', label: 'Full name', fallback: 'there' },
  { key: 'email', label: 'Email address', fallback: '' },
  { key: 'company_name', label: 'Your company name', fallback: '' },
];

export const tagText = (key: string, fallback?: string) => (fallback ? `{${key}|${fallback}}` : `{${key}}`);

/** Menu that inserts a personalisation tag like {first_name|there}. */
export function MergeTagMenu({ fields, onInsert, trigger }: { fields: CustomField[]; onInsert: (tag: string) => void; trigger: ReactNode }) {
  return (
    <Menu trigger={trigger} align="start">
      <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold text-muted">Contact</p>
      {CORE_TAGS.map((t) => (
        <MenuItem key={t.key} onSelect={() => onInsert(tagText(t.key, t.fallback))}>
          {t.label}
        </MenuItem>
      ))}
      {fields.length > 0 && (
        <>
          <MenuSeparator />
          <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold text-muted">Your fields</p>
          {fields.map((f) => (
            <MenuItem key={f.id} onSelect={() => onInsert(tagText(f.key))}>
              {f.label}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

function ToolButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onMouseDown={(e) => e.preventDefault()} // keep the text selection inside the email
        onClick={onClick}
        className={cn('grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink', active && 'bg-hover text-ink')}
      >
        {children}
      </button>
    </Tooltip>
  );
}


/** Styles that only exist inside the editor frame (never saved into the email). */
const EDITOR_CSS = `
  [data-drona-editor] { outline: none; }
  body { cursor: text; }
  *:hover:not(html):not(body):not(table):not(tbody):not(tr) { outline: 1px dashed rgba(11,122,98,.35); outline-offset: 2px; }
  img { cursor: pointer; }
  img.drona-selected { outline: 2px solid #4A3FD1 !important; outline-offset: 2px; }
  span[data-drona-tag] { display: inline-block; background: #E4F2ED; color: #075C49; border-radius: 5px; padding: 0 5px; margin: 0 1px; font-weight: 600; font-size: .92em; line-height: 1.45; cursor: default; user-select: none; -webkit-user-select: none; }
  span[data-drona-tag]:hover { outline: 1px solid #4A3FD1 !important; }
`;

const TAG_RE = /\{\s*([a-zA-Z_]\w*)\s*(?:\|([^{}]*))?\}/g;
const tagLabel = (key: string, fallback?: string) => {
  const name = key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return fallback ? `${name} (or “${fallback}”)` : name;
};

/** A merge tag as a solid chip: it can be moved or deleted, never typed into half-way. */
function chipFor(doc: Document, raw: string) {
  const m = new RegExp(TAG_RE.source).exec(raw)!;
  const span = doc.createElement('span');
  span.setAttribute('data-drona-tag', raw);
  span.setAttribute('contenteditable', 'false');
  span.textContent = tagLabel(m[1]!, m[2]);
  return span;
}

/** Turns {first_name|there} text into chips throughout the body. */
function chipify(doc: Document) {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('style,script,title,[data-drona-tag]') ? NodeFilter.FILTER_REJECT : new RegExp(TAG_RE.source).test(n.nodeValue ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  for (const node of nodes) {
    const text = node.nodeValue ?? '';
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(new RegExp(TAG_RE.source, 'g'))) {
      if (m.index! > last) frag.append(text.slice(last, m.index));
      frag.append(chipFor(doc, m[0]));
      last = m.index! + m[0].length;
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}

/** The HTML to save: chips back to {tags}, editor-only styles and markers removed. */
function cleanHtml(doc: Document) {
  const clone = doc.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelector('#drona-editor-css')?.remove();
  clone.querySelectorAll('[data-drona-tag]').forEach((el) => el.replaceWith(doc.createTextNode(el.getAttribute('data-drona-tag') ?? '')));
  clone.querySelectorAll('.drona-selected').forEach((e) => {
    e.classList.remove('drona-selected');
    if (!e.getAttribute('class')) e.removeAttribute('class');
  });
  return '<!DOCTYPE html>\n' + clone.outerHTML;
}

/**
 * Click-and-type editing of a finished email design. Text is edited in place;
 * images can be swapped by URL; the raw HTML is one tab away for anyone who wants it.
 */
export function VisualEditor({ html, onChange, fields }: { html: string; onChange: (html: string) => void; fields: CustomField[] }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [mode, setMode] = useState<'visual' | 'html'>('visual');
  const [source, setSource] = useState(html); // what the frame was loaded with
  const [code, setCode] = useState(html);
  const [img, setImg] = useState<{ el: HTMLImageElement; src: string; alt: string } | null>(null);
  const [link, setLink] = useState('');
  const [state, setState] = useState({ bold: false, italic: false, underline: false });
  const emitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const doc = () => ref.current?.contentDocument ?? null;
  const emit = useCallback(() => {
    clearTimeout(emitTimer.current);
    emitTimer.current = setTimeout(() => {
      const d = doc();
      if (!d) return;
      onChange(cleanHtml(d));
    }, 250);
  }, [onChange]);

  const exec = (cmd: string, value?: string) => {
    const d = doc();
    if (!d) return;
    d.execCommand(cmd, false, value);
    refreshState();
    emit();
  };
  const refreshState = () => {
    const d = doc();
    if (!d) return;
    setState({ bold: d.queryCommandState('bold'), italic: d.queryCommandState('italic'), underline: d.queryCommandState('underline') });
  };

  const onLoad = () => {
    const d = doc();
    if (!d) return;
    d.designMode = 'on';
    const style = d.createElement('style');
    style.id = 'drona-editor-css';
    style.textContent = EDITOR_CSS;
    d.head?.appendChild(style);
    chipify(d);
    d.addEventListener('input', emit);
    d.addEventListener('keyup', refreshState);
    d.addEventListener('mouseup', refreshState);
    d.addEventListener('click', (e) => {
      d.querySelectorAll('.drona-selected').forEach((x) => x.classList.remove('drona-selected'));
      const t = e.target as HTMLElement;
      if (t.tagName === 'IMG') {
        t.classList.add('drona-selected');
        const el = t as HTMLImageElement;
        setImg({ el, src: el.getAttribute('src') ?? '', alt: el.getAttribute('alt') ?? '' });
      } else setImg(null);
      // Links shouldn't navigate while editing
      if (t.closest('a')) e.preventDefault();
    });
    // Size to content
    const fit = () => ref.current && (ref.current.style.height = `${Math.max(560, d.documentElement.scrollHeight)}px`);
    fit();
    new ResizeObserver(fit).observe(d.body);
  };

  useEffect(() => () => clearTimeout(emitTimer.current), []);

  const switchMode = (m: 'visual' | 'html') => {
    if (m === 'html') {
      clearTimeout(emitTimer.current);
      const d = doc();
      const current = d ? cleanHtml(d) : html;
      setCode(current);
    } else {
      setSource(code);
      onChange(code);
    }
    setImg(null);
    setMode(m);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface px-3 py-2">
        {mode === 'visual' ? (
          <>
            <ToolButton label="Bold" active={state.bold} onClick={() => exec('bold')}>
              <Bold className="h-4 w-4" />
            </ToolButton>
            <ToolButton label="Italic" active={state.italic} onClick={() => exec('italic')}>
              <Italic className="h-4 w-4" />
            </ToolButton>
            <ToolButton label="Underline" active={state.underline} onClick={() => exec('underline')}>
              <Underline className="h-4 w-4" />
            </ToolButton>
            <span className="mx-1 h-5 w-px bg-line" aria-hidden />
            <Popover
              align="start"
              className="w-80 p-3"
              trigger={
                <button type="button" onMouseDown={(e) => e.preventDefault()} className="grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink" aria-label="Add link">
                  <Link2 className="h-4 w-4" />
                </button>
              }
            >
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!link.trim()) return;
                  ref.current?.contentWindow?.focus();
                  exec('createLink', /^(https?:|mailto:|tel:|\{)/i.test(link.trim()) ? link.trim() : `https://${link.trim()}`);
                  setLink('');
                }}
              >
                <label className="text-[13px] font-semibold" htmlFor="link-url">
                  Link selected text to
                </label>
                <Input id="link-url" className="h-10" placeholder="https://kurukshetra-travels.com/goa" value={link} onChange={(e) => setLink(e.target.value)} />
                <Button type="submit" size="sm" variant="primary">
                  Add link
                </Button>
              </form>
            </Popover>
            <ToolButton label="Remove link" onClick={() => exec('unlink')}>
              <Unlink className="h-4 w-4" />
            </ToolButton>
            <span className="mx-1 h-5 w-px bg-line" aria-hidden />
            <MergeTagMenu
              fields={fields}
              onInsert={(t) => {
                const d = doc();
                if (!d) return;
                ref.current?.contentWindow?.focus();
                // Insert at the caret by hand: execCommand('insertHTML') can drop it outside the paragraph
                const sel = d.getSelection();
                if (!sel || !sel.rangeCount || !d.body.contains(sel.anchorNode)) return toast('Click in the email where the field should go, then choose it again.');
                const range = sel.getRangeAt(0);
                range.deleteContents();
                const chip = chipFor(d, t);
                const space = d.createTextNode('\u00a0');
                range.insertNode(space);
                range.insertNode(chip);
                range.setStartAfter(space);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
                emit();
              }}
              trigger={
                <button type="button" onMouseDown={(e) => e.preventDefault()} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-ink-2 hover:bg-hover hover:text-ink">
                  <Braces className="h-4 w-4" />
                  Personalise
                </button>
              }
            />
            <span className="mx-1 h-5 w-px bg-line" aria-hidden />
            <ToolButton label="Undo" onClick={() => exec('undo')}>
              <Undo2 className="h-4 w-4" />
            </ToolButton>
            <ToolButton label="Redo" onClick={() => exec('redo')}>
              <Redo2 className="h-4 w-4" />
            </ToolButton>
          </>
        ) : (
          <span className="flex items-center gap-2 px-2 text-[13px] text-muted">
            <Code2 className="h-4 w-4" />
            For developers. Changes apply when you switch back.
          </span>
        )}
        <div className="ml-auto">
          <Segmented
            size="sm"
            label="Editor mode"
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'visual', label: 'Visual' },
              { value: 'html', label: 'HTML' },
            ]}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#edecf7] p-4 sm:p-8">
          {mode === 'visual' ? (
            <div className="mx-auto max-w-[680px] overflow-hidden rounded-[12px] bg-white shadow-[var(--shadow-lift)]">
              <iframe ref={ref} key={source} title="Email editor" srcDoc={source} sandbox="allow-same-origin" onLoad={onLoad} className="block w-full border-0" style={{ height: 560 }} />
            </div>
          ) : (
            <Textarea
              aria-label="Email HTML"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="h-full min-h-[560px] resize-none font-[ui-monospace,SFMono-Regular,Menlo,monospace] text-[12.5px] leading-relaxed"
            />
          )}
        </div>
        {mode === 'visual' && (
          <aside className="hidden w-72 shrink-0 flex-col gap-5 overflow-y-auto border-l border-line bg-surface p-5 lg:flex">
            {img ? (
              <>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <ImageIcon className="h-4 w-4 text-accent" /> Image
                </div>
                <Field label="Image address" hint="Paste a link to an image that’s online, for example from your website.">
                  {(p) => (
                    <Input
                      {...p}
                      className="h-10"
                      value={img.src}
                      onChange={(e) => {
                        img.el.setAttribute('src', e.target.value);
                        setImg({ ...img, src: e.target.value });
                        emit();
                      }}
                    />
                  )}
                </Field>
                <Field label="Description" hint="Shown when images are off, and read aloud by screen readers.">
                  {(p) => (
                    <Input
                      {...p}
                      className="h-10"
                      value={img.alt}
                      onChange={(e) => {
                        img.el.setAttribute('alt', e.target.value);
                        setImg({ ...img, alt: e.target.value });
                        emit();
                      }}
                    />
                  )}
                </Field>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Wand2 className="h-4 w-4 text-accent" /> Editing tips
                </div>
                <ul className="flex flex-col gap-3 text-[13px] leading-relaxed text-muted">
                  <li>Click any text in the email and type to change it.</li>
                  <li>
                    Replace anything in <span className="font-semibold text-ink">[SQUARE BRACKETS]</span>. You can’t send until they’re gone.
                  </li>
                  <li>
                    <span className="font-semibold text-ink">Personalise</span> adds a green field like <span className="rounded bg-accent-soft px-1 font-semibold text-accent-strong">First name</span>. Each person sees their own; the word in brackets is used when it’s missing.
                  </li>
                  <li>Click an image to change it.</li>
                  <li>The unsubscribe footer is added automatically when sending.</li>
                </ul>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

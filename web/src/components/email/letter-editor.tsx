import { Bold, Braces, Heading2, Italic, Link2, List, ListOrdered, Redo2, Undo2, Unlink } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Popover, Tooltip } from '@/components/ui/overlay';
import { cn } from '@/lib/cn';
import { cleanLetter } from '@/lib/letter';
import type { CustomField } from '@/lib/types';
import { chipFor, chipify, MergeTagMenu } from './visual-editor';

function Tool({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onMouseDown={(e) => e.preventDefault()} // keep the caret in the email
        onClick={onClick}
        className={cn('grid h-8 w-8 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-hover hover:text-ink', active && 'bg-accent-soft text-accent-strong')}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** The editor's HTML with green field chips turned back into {tags}, then cleaned for email. */
function readBody(el: HTMLElement) {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-drona-tag]').forEach((c) => c.replaceWith(document.createTextNode(c.getAttribute('data-drona-tag') ?? '')));
  return cleanLetter(clone);
}

/**
 * Write an email the way you'd write one in Gmail: type straight in, with bold, lists, links and
 * personal fields. No design, nothing in brackets to replace.
 */
export function LetterEditor({ body, onChange, fields, autoFocus }: { body: string; onChange: (body: string) => void; fields: CustomField[]; autoFocus?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);
  const range = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const [state, setState] = useState({
    bold: false,
    italic: false,
    ul: false,
    ol: false,
  });

  // Load the body unless it's what we just sent up (typing must not reset the caret)
  useEffect(() => {
    const el = ref.current;
    if (!el || body === last.current) return;
    el.innerHTML = body;
    chipify(document, el);
    last.current = body;
  }, [body]);

  useEffect(() => {
    if (!autoFocus || !ref.current) return;
    // Caret into the empty line between greeting and sign-off, where the message goes
    const el = ref.current;
    const empty = [...el.querySelectorAll('p')].find((p) => !p.textContent?.trim());
    el.focus();
    const sel = window.getSelection();
    if (empty && sel) {
      const r = document.createRange();
      r.setStart(empty, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }, [autoFocus]);

  const emit = () => {
    if (!ref.current) return;
    const next = readBody(ref.current);
    last.current = next;
    onChange(next);
  };
  const refresh = () =>
    setState({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
            ul: document.queryCommandState('insertUnorderedList'),
      ol: document.queryCommandState('insertOrderedList'),
    });
  const exec = (cmd: string, value?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, value);
    refresh();
    emit();
  };
  const remember = () => {
    const sel = window.getSelection();
    range.current = sel && sel.rangeCount && ref.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
  };
  const restore = () => {
    ref.current?.focus();
    const sel = window.getSelection();
    if (range.current && sel) {
      sel.removeAllRanges();
      sel.addRange(range.current);
    }
  };

  const insertTag = (tag: string) => {
    restore();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !ref.current?.contains(sel.anchorNode)) return toast('Click in the email where it should go, then choose it again.');
    const r = sel.getRangeAt(0);
    r.deleteContents();
    const chip = chipFor(document, tag);
    const space = document.createTextNode(' ');
    r.insertNode(space);
    r.insertNode(chip);
    r.setStartAfter(space);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    emit();
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-surface focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--color-accent-soft)]">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line-soft bg-sunken px-1.5 py-1">
        <Tool label="Bold" active={state.bold} onClick={() => exec('bold')}>
          <Bold className="h-4 w-4" />
        </Tool>
        <Tool label="Italic" active={state.italic} onClick={() => exec('italic')}>
          <Italic className="h-4 w-4" />
        </Tool>
        <Tool label="Heading" onClick={() => exec('formatBlock', document.queryCommandValue('formatBlock') === 'h2' ? 'p' : 'h2')}>
          <Heading2 className="h-4 w-4" />
        </Tool>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <Tool label="Bullet list" active={state.ul} onClick={() => exec('insertUnorderedList')}>
          <List className="h-4 w-4" />
        </Tool>
        <Tool label="Numbered list" active={state.ol} onClick={() => exec('insertOrderedList')}>
          <ListOrdered className="h-4 w-4" />
        </Tool>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <Popover
          align="start"
          className="w-80 p-3"
          open={linkOpen}
          onOpenChange={(o) => {
            if (o) remember();
            setLinkOpen(o);
          }}
          trigger={
            <button type="button" onMouseDown={(e) => e.preventDefault()} aria-label="Add link" className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink">
              <Link2 className="h-4 w-4" />
            </button>
          }
        >
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const url = link.trim();
              if (!url) return;
              const href = /^(https?:|mailto:|tel:|\{)/i.test(url) ? url : `https://${url}`;
              setLinkOpen(false);
              restore();
              if (window.getSelection()?.isCollapsed) document.execCommand('insertHTML', false, `<a href="${href.replace(/"/g, '&quot;')}">${url.replace(/</g, '&lt;')}</a>`);
              else document.execCommand('createLink', false, href);
              setLink('');
              emit();
            }}
          >
            <label className="text-[13px] font-semibold" htmlFor="letter-link">
              Link to
            </label>
            <Input id="letter-link" autoFocus className="h-10" placeholder="kurukshetra-travels.in/goa" value={link} onChange={(e) => setLink(e.target.value)} />
            <p className="text-xs text-muted">Select some words first to turn them into the link.</p>
            <Button type="submit" size="sm" variant="primary">
              Add link
            </Button>
          </form>
        </Popover>
        <Tool label="Remove link" onClick={() => exec('unlink')}>
          <Unlink className="h-4 w-4" />
        </Tool>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <MergeTagMenu
          fields={fields}
          onInsert={insertTag}
          trigger={
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                remember();
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-ink-2 hover:bg-hover hover:text-ink"
            >
              <Braces className="h-4 w-4" />
              Personalise
            </button>
          }
        />
        <span className="ml-auto flex max-sm:hidden">
          <Tool label="Undo" onClick={() => exec('undo')}>
            <Undo2 className="h-4 w-4" />
          </Tool>
          <Tool label="Redo" onClick={() => exec('redo')}>
            <Redo2 className="h-4 w-4" />
          </Tool>
        </span>
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-multiline
        aria-label="Email message"
        contentEditable
        suppressContentEditableWarning
        spellCheck
        onFocus={() => document.execCommand('defaultParagraphSeparator', false, 'p')}
        onInput={emit}
        onKeyUp={refresh}
        onMouseUp={refresh}
        onPaste={(e) => {
          // Paste words, not someone else's fonts and colours
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          const html = text
            .split(/\r?\n\s*\r?\n/)
            .map((para) => `<p>${para.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\r?\n/g, '<br>')}</p>`)
            .join('');
          document.execCommand(text.includes('\n') ? 'insertHTML' : 'insertText', false, text.includes('\n') ? html : text);
          emit();
        }}
        className={cn(
          'min-h-[300px] px-5 py-4 font-[Arial,Helvetica,sans-serif] text-[15px] leading-[1.6] text-[#1a1a1a] outline-none',
          '[&_p]:mb-3.5 [&_h2]:mb-3 [&_h2]:text-[21px] [&_h2]:font-bold [&_h3]:text-[17px] [&_h3]:font-bold',
          '[&_ul]:mb-3.5 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mb-3.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1',
          '[&_a]:text-[#1a56c4] [&_a]:underline',
          '[&_[data-drona-tag]]:mx-px [&_[data-drona-tag]]:inline-block [&_[data-drona-tag]]:rounded-[5px] [&_[data-drona-tag]]:bg-accent-soft [&_[data-drona-tag]]:px-1.5 [&_[data-drona-tag]]:text-[.92em] [&_[data-drona-tag]]:font-semibold [&_[data-drona-tag]]:text-accent-strong',
        )}
      />
    </div>
  );
}

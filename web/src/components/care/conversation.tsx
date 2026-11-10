import { Headset, Lock, Paperclip } from 'lucide-react';
import { Fragment, useEffect, useRef } from 'react';
import { fileKind, formatBytes } from '@/components/attachments/attachments';
import { Avatar } from '@/components/ui/display';
import type { SupportMessage } from '@/lib/care';
import { cn } from '@/lib/cn';
import { date, time } from '@/lib/format';
import type { Attachment } from '@/lib/types';

const dayKey = (iso: string) => new Date(iso).toDateString();
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date(iso, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function Files({ files, url, mine }: { files: Attachment[]; url: (a: Attachment, download?: boolean) => string; mine: boolean }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {files.map((f) => {
        const k = fileKind(f.type, f.name);
        if (k.key === 'image')
          return (
            <a key={f.id} href={url(f)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-[12px] ring-1 ring-black/5">
              <img src={url(f)} alt={f.name} className="max-h-52 max-w-[260px] object-cover" loading="lazy" />
            </a>
          );
        const Icon = k.icon;
        return (
          <a
            key={f.id}
            href={url(f, true)}
            className={cn('flex max-w-[260px] items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-[13px] transition-colors', mine ? 'bg-white/15 hover:bg-white/25' : 'bg-sunken hover:bg-hover')}
          >
            <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-[8px]', k.tone)}>
              <Icon className="h-4 w-4" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{f.name}</span>
              <span className={cn('text-[11.5px]', mine ? 'text-white/70' : 'text-muted')}>
                {k.label} · {formatBytes(f.size)}
              </span>
            </span>
          </a>
        );
      })}
    </div>
  );
}

/**
 * A request's conversation. `side` says who is reading: their own messages sit on the right in
 * colour; the other side's on the left. Customer care also sees its private notes, in yellow.
 */
export function Conversation({ messages, side, fileUrl }: { messages: SupportMessage[]; side: 'agency' | 'care'; fileUrl: (a: Attachment, download?: boolean) => string }) {
  const end = useRef<HTMLLIElement>(null);
  const count = messages.length;
  const first = useRef(true);
  // Keep the newest message in view, scrolling only the conversation box (never the page)
  useEffect(() => {
    let box = end.current?.parentElement ?? null;
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    if (!box || box === document.documentElement || box === document.body) return;
    box.scrollTo({ top: box.scrollHeight, behavior: first.current ? 'auto' : 'smooth' });
    first.current = false;
  }, [count]);
  let lastDay = '';
  return (
    <ol className="flex flex-col gap-3">
      {messages.map((m, i) => {
        const day = dayKey(m.createdAt);
        const showDay = day !== lastDay;
        lastDay = day;
        const prev = messages[i - 1];
        const grouped = !showDay && prev && prev.author === m.author && prev.internal === m.internal && prev.name === m.name && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
        const head = showDay ? (
          <li className="flex items-center gap-3 py-1 text-[12px] font-semibold text-faint" aria-hidden>
            <span className="h-px flex-1 bg-line-soft" />
            {dayLabel(m.createdAt)}
            <span className="h-px flex-1 bg-line-soft" />
          </li>
        ) : null;

        if (m.author === 'SYSTEM')
          return (
            <Fragment key={m.id}>
              {head}
              <li className="flex justify-center">
                <span className={cn('rounded-full px-3 py-1 text-[12px] font-medium', m.internal ? 'bg-[#fff6d6] text-[#7a5600]' : 'bg-line-soft text-muted')}>
                  {m.internal && <Lock className="mr-1 inline h-3 w-3" />}
                  {m.body} · {time(m.createdAt)}
                </span>
              </li>
            </Fragment>
          );

        const mine = (side === 'agency' && m.author === 'AGENCY') || (side === 'care' && m.author === 'CARE');
        const note = m.internal;
        return (
          <Fragment key={m.id}>
            {head}
            <li className={cn('flex items-end gap-2.5', mine && 'flex-row-reverse', grouped && '-mt-1.5')}>
              <span className="w-8 shrink-0">
                {!grouped &&
                  (m.author === 'CARE' ? (
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-[linear-gradient(135deg,#ff8a1f,#ff5f6d)] text-white shadow-[0_4px_10px_-4px_#ff5f6d]">
                      <Headset className="h-4 w-4" />
                    </span>
                  ) : (
                    <Avatar name={m.name} size={32} />
                  ))}
              </span>
              <div className={cn('flex max-w-[min(560px,82%)] flex-col', mine ? 'items-end' : 'items-start')}>
                {!grouped && (
                  <span className="mb-1 flex items-center gap-1.5 px-1 text-[12px] text-muted">
                    <b className="font-semibold text-ink-2">{m.name}</b>
                    {m.author === 'CARE' && side === 'agency' && <span>· Customer care</span>}
                    {note && (
                      <span className="inline-flex items-center gap-1 font-semibold text-[#8a6100]">
                        <Lock className="h-3 w-3" /> Private note
                      </span>
                    )}
                    <span>· {time(m.createdAt)}</span>
                  </span>
                )}
                <div
                  className={cn(
                    'whitespace-pre-wrap break-words rounded-[18px] px-4 py-2.5 text-[14px] leading-relaxed',
                    note
                      ? 'border border-dashed border-[#e8c55a] bg-[#fff8dc] text-ink'
                      : mine
                        ? 'bg-[linear-gradient(135deg,#4a3fd1,#6a4ff0)] text-white shadow-[0_6px_16px_-10px_#4a3fd1]'
                        : 'border border-line bg-surface text-ink shadow-[0_1px_2px_rgb(23_21_59/0.04)]',
                    mine ? 'rounded-br-[6px]' : 'rounded-bl-[6px]',
                  )}
                >
                  {m.body}
                  {m.attachments.length > 0 && <Files files={m.attachments} url={fileUrl} mine={mine && !note} />}
                </div>
              </div>
            </li>
          </Fragment>
        );
      })}
      <li ref={end} aria-hidden />
    </ol>
  );
}

export function AttachHint() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <Paperclip className="h-3.5 w-3.5" /> Screenshots help us see it straight away
    </span>
  );
}

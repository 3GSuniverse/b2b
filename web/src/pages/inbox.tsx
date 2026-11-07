import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bot,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock3,
  FileText,
  Image as ImageIcon,
  MapPin,
  Megaphone,
  MessageCircle,
  Mic,
  RotateCcw,
  Search,
  SendHorizontal,
  Smartphone,
  TriangleAlert,
  User,
  UserPlus,
  Video,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AddContactSheet } from '@/components/contacts/add-contact';
import { useLists } from '@/components/campaigns/audience';
import { Segmented } from '@/components/ui/controls';
import { EmptyState, Panel, Skeleton } from '@/components/ui/display';
import { useWhatsApp } from '@/components/whatsapp/settings';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { phone as formatPhone } from '@/lib/format';

/**
 * WhatsApp inbox: every conversation on the agency's linked number in one place.
 * Left, the people who wrote; right, the whole conversation, including the broadcast
 * or reminder they replied to, and a box to answer from the agency's number.
 */

type ChatRow = {
  id: string;
  phone: string;
  lastMessageAt: string;
  lastPreview: string | null;
  lastDirection: 'IN' | 'OUT' | null;
  unread: number;
  done: boolean;
  contactId: string | null;
  name: string | null;
};
type ThreadMessage = {
  id: string;
  direction: 'IN' | 'OUT';
  source: 'customer' | 'reply' | 'broadcast' | 'automatic' | 'phone';
  body: string | null;
  mediaKind: string | null;
  mediaName: string | null;
  at: string;
  sentBy: string | null;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'BOUNCED' | 'COMPLAINED' | 'FAILED' | 'SUPPRESSED' | null;
  delivered: boolean;
  read: boolean;
  error: string | null;
  campaignName: string | null;
};
type Thread = {
  chat: { id: string; phone: string; done: boolean; unread: number };
  contact: { id: string; name: string | null; email: string | null; whatsappStatus: string } | null;
  messages: ThreadMessage[];
};
type Filter = 'all' | 'unread' | 'done';

const MEDIA: Record<string, { icon: typeof ImageIcon; label: string }> = {
  image: { icon: ImageIcon, label: 'Photo' },
  video: { icon: Video, label: 'Video' },
  document: { icon: FileText, label: 'Document' },
  audio: { icon: Mic, label: 'Voice message' },
  sticker: { icon: ImageIcon, label: 'Sticker' },
  location: { icon: MapPin, label: 'Location' },
  contact: { icon: User, label: 'Contact' },
};

const who = (c: { name: string | null; phone: string }) => c.name || formatPhone(c.phone);

function shortTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now.getTime() - d.getTime() < 6 * 86_400_000) return d.toLocaleDateString('en-IN', { weekday: 'short' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
function dayLabel(iso: string) {
  const d = new Date(iso);
  const t = shortTime(iso);
  if (/AM|PM|am|pm/.test(t)) return 'Today';
  if (t === 'Yesterday') return t;
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function useInboxUnread() {
  return useQuery({ queryKey: ['inbox', 'unread'], queryFn: () => api.get<{ chats: number; messages: number }>('/api/inbox/unread'), refetchInterval: 15_000 });
}

export function InboxTab() {
  const [params, setParams] = useSearchParams();
  const open = params.get('chat');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const list = useQuery({
    queryKey: ['inbox', 'list', filter, term],
    queryFn: () => api.get<{ chats: ChatRow[] }>(`/api/inbox?${new URLSearchParams({ filter, ...(term && { search: term }) })}`),
    refetchInterval: 5_000,
    placeholderData: (p) => p,
  });
  const select = (id: string | null) => setParams(id ? { chat: id } : {}, { replace: !id });

  return (
    <Panel className="grid h-[calc(100dvh-210px)] min-h-[460px] md:h-[calc(100dvh-250px)] grid-cols-[minmax(0,1fr)] overflow-hidden p-0 md:grid-cols-[340px_minmax(0,1fr)]">
      <aside className={cn('flex min-h-0 flex-col border-line-soft md:border-r', open && 'hidden md:flex')}>
        <div className="flex flex-col gap-2.5 border-b border-line-soft p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, number or message"
              aria-label="Search conversations"
              className="h-10 w-full rounded-[10px] border border-line bg-sunken pl-9 pr-3 text-sm outline-none focus:border-success focus:bg-surface focus:ring-2 focus:ring-success/20"
            />
          </div>
          <Segmented
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'unread', label: 'Unread' },
              { value: 'done', label: 'Done' },
            ]}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!list.data ? (
            <div className="flex flex-col gap-2 p-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : list.data.chats.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              {term ? `No conversation matches “${term}”.` : filter === 'unread' ? 'All caught up. No unread messages.' : filter === 'done' ? 'Conversations you mark as done show here.' : 'When customers reply to your WhatsApp messages, the conversations appear here.'}
            </p>
          ) : (
            <ul className="stagger">
              {list.data.chats.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => select(c.id)}
                    className={cn(
                      'flex w-full items-center gap-3 border-b border-line-soft px-3.5 py-3 text-left transition-colors hover:bg-sunken',
                      open === c.id && 'bg-success-soft/50 hover:bg-success-soft/60',
                    )}
                  >
                    <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-bold', c.name ? 'bg-success-soft text-success-strong' : 'bg-sunken text-muted')}>
                      {c.name ? c.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() : <Smartphone className="h-4 w-4" />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn('truncate text-sm', c.unread ? 'font-bold' : 'font-semibold')}>{who(c)}</span>
                        <span className={cn('shrink-0 text-[11px]', c.unread ? 'font-semibold text-success' : 'text-muted')}>{shortTime(c.lastMessageAt)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className={cn('min-w-0 flex-1 truncate text-[13px]', c.unread ? 'text-ink' : 'text-muted')}>
                          {c.lastDirection === 'OUT' && <span className="text-faint">You: </span>}
                          {c.lastPreview || ' '}
                        </span>
                        {c.unread > 0 && <span className="tnum grid h-5 min-w-5 place-items-center rounded-full bg-success px-1.5 text-[11px] font-bold text-white">{c.unread}</span>}
                        {c.done && !c.unread && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-label="Done" />}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
      <section className={cn('flex min-h-0 flex-col', !open && 'hidden md:flex')}>
        {open ? (
          <Conversation key={open} id={open} onBack={() => select(null)} />
        ) : (
          <div className="grid flex-1 place-items-center bg-[#f4f1ea]/40 p-6">
            <EmptyState icon={<MessageCircle />} title="Pick a conversation">
              Customers’ replies to your broadcasts and reminders, and every chat on your linked number from now on, show up here.
            </EmptyState>
          </div>
        )}
      </section>
    </Panel>
  );
}

function Conversation({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const wa = useWhatsApp();
  const lists = useLists();
  const q = useQuery({ queryKey: ['inbox', 'thread', id], queryFn: () => api.get<Thread>(`/api/inbox/${id}`), refetchInterval: 4_000 });
  const t = q.data;
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const lastCount = useRef(0);

  // Seen: clear the unread count when it's opened or new messages arrive while it's open
  const read = useMutation({
    mutationFn: () => api.post(`/api/inbox/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox', 'unread'] }),
  });
  useEffect(() => {
    if (t?.chat.unread) read.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.chat.unread]);

  // Stay at the bottom as messages arrive
  useLayoutEffect(() => {
    const n = t?.messages.length ?? 0;
    if (n !== lastCount.current && scroller.current) {
      scroller.current.scrollTo({ top: scroller.current.scrollHeight, behavior: lastCount.current ? 'smooth' : 'auto' });
      lastCount.current = n;
    }
  }, [t?.messages.length]);

  const send = useMutation({
    mutationFn: (body: string) => api.post(`/api/inbox/${id}/reply`, { text: body }),
    onMutate: () => setText(''),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox'] });
      box.current?.focus();
    },
    onError: (e: Error, body) => {
      setText(body);
      toast.error(e instanceof ApiError ? e.message : 'Couldn’t send the reply');
    },
  });
  const done = useMutation({
    mutationFn: (v: boolean) => api.post(`/api/inbox/${id}/done`, { done: v }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['inbox'] });
      toast.success(v ? 'Marked as done' : 'Opened again');
      if (v) onBack();
    },
  });

  const submit = () => {
    const body = text.trim();
    if (body && !send.isPending) send.mutate(body);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const groups = useMemo(() => {
    const out: { day: string; items: ThreadMessage[] }[] = [];
    for (const m of t?.messages ?? []) {
      const day = dayLabel(m.at);
      if (out.at(-1)?.day !== day) out.push({ day, items: [] });
      out.at(-1)!.items.push(m);
    }
    return out;
  }, [t?.messages]);

  if (!t) return <Skeleton className="m-4 flex-1" />;
  const title = t.contact?.name || formatPhone(t.chat.phone);
  const linked = wa.data?.status === 'CONNECTED';

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line-soft px-3 py-2.5 sm:px-4">
        <button type="button" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-hover md:hidden" aria-label="Back to conversations">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-success-soft text-sm font-bold text-success-strong">
          {t.contact?.name ? t.contact.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() : <Smartphone className="h-4 w-4" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-semibold">{title}</span>
          <span className="truncate text-xs text-muted">{t.contact?.name ? formatPhone(t.chat.phone) : 'Not saved as a customer'}</span>
        </span>
        {t.contact ? (
          <Link to={`/contacts?q=${encodeURIComponent(t.contact.name ?? t.chat.phone)}`} className="hidden h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-semibold hover:bg-sunken sm:inline-flex">
            <User className="h-4 w-4" /> Customer
          </Link>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-semibold hover:bg-sunken">
            <UserPlus className="h-4 w-4" /> <span className="hidden sm:inline">Save as customer</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => done.mutate(!t.chat.done)}
          className={cn('inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-colors', t.chat.done ? 'border border-line hover:bg-sunken' : 'bg-success text-white hover:bg-success-strong')}
        >
          {t.chat.done ? <RotateCcw className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          <span className="hidden sm:inline">{t.chat.done ? 'Open again' : 'Mark done'}</span>
        </button>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto bg-[#efeae2] bg-[radial-gradient(rgb(0_0_0/0.035)_1px,transparent_1px)] [background-size:16px_16px] px-3 py-4 sm:px-6">
        {groups.map((g) => (
          <div key={g.day} className="flex flex-col gap-1.5">
            <span className="mx-auto my-2 rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-ink-2 shadow-sm">{g.day}</span>
            {g.items.map((m, i) => (
              <Bubble key={m.id} m={m} first={i === 0 || g.items[i - 1]!.direction !== m.direction} />
            ))}
          </div>
        ))}
      </div>

      <footer className="border-t border-line-soft bg-surface p-2.5 sm:p-3">
        {!linked && wa.data && (
          <p className="mb-2 flex items-center gap-1.5 rounded-[10px] bg-warm-soft px-3 py-2 text-[12px] text-warm-strong">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" /> Your WhatsApp number isn’t linked. Replies wait until you <Link to="/whatsapp/setup" className="font-semibold underline">link it again</Link>.
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={box}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            placeholder={`Reply to ${title.split(' ')[0]}…`}
            aria-label="Reply"
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-[22px] border border-line bg-sunken px-4 py-[11px] text-[14px] leading-snug outline-none [field-sizing:content] focus:border-success focus:bg-surface focus:ring-2 focus:ring-success/20"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim() || send.isPending}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-success text-white shadow-[0_6px_14px_-6px_rgb(14_148_102/0.7)] transition-[transform,opacity] hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
            aria-label="Send reply"
          >
            <SendHorizontal className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-1.5 px-2 text-[11px] text-faint">Enter to send, Shift + Enter for a new line. Goes from your linked number, ahead of any broadcast that’s sending.</p>
      </footer>
      <AddContactSheet
        open={adding}
        onClose={() => setAdding(false)}
        lists={lists.data?.lists ?? []}
        prefill={{ phone: t.chat.phone }}
        onCreated={() => {
          setAdding(false);
          qc.invalidateQueries({ queryKey: ['inbox'] });
        }}
      />
    </>
  );
}

function Bubble({ m, first }: { m: ThreadMessage; first: boolean }) {
  const out = m.direction === 'OUT';
  const media = m.mediaKind ? MEDIA[m.mediaKind] : null;
  const label =
    m.source === 'broadcast'
      ? { icon: Megaphone, text: m.campaignName ? `Broadcast: ${m.campaignName}` : 'Broadcast' }
      : m.source === 'automatic'
        ? { icon: Bot, text: 'Sent automatically' }
        : m.source === 'phone'
          ? { icon: Smartphone, text: 'From the phone' }
          : m.source === 'reply' && m.sentBy
            ? { icon: User, text: m.sentBy }
            : null;
  const failed = m.status === 'FAILED' || m.status === 'SUPPRESSED';
  return (
    <div className={cn('flex', out ? 'justify-end' : 'justify-start', first && 'mt-1.5')}>
      <div
        className={cn(
          'relative max-w-[min(78%,520px)] rounded-[12px] px-3 pb-1.5 pt-2 text-[14px] leading-snug text-[#111b21] shadow-[0_1px_0.5px_rgb(11_20_26/0.13)]',
          out ? 'bg-[#d9fdd3]' : 'bg-white',
          first && (out ? 'rounded-tr-[4px]' : 'rounded-tl-[4px]'),
        )}
      >
        {label && (
          <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-[#0b7a52]">
            <label.icon className="h-3 w-3" /> {label.text}
          </span>
        )}
        {media && (
          <span className="mb-1 flex items-center gap-2 rounded-[8px] bg-black/[0.05] px-2.5 py-2 text-[13px] text-ink-2">
            <media.icon className="h-4 w-4 shrink-0" /> <span className="truncate">{m.mediaName || media.label}</span>
          </span>
        )}
        {m.body && (
          <p className="whitespace-pre-wrap break-words">
            {m.mediaKind === 'location' ? (
              <a href={m.body} target="_blank" rel="noreferrer" className="text-[#027eb5] underline">
                Open in Google Maps
              </a>
            ) : (
              m.body
            )}
          </p>
        )}
        <span className="float-right -mb-0.5 ml-3 mt-1 flex items-center gap-1 text-[11px] text-[#667781]">
          {new Date(m.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
          {out && m.status && (failed ? <TriangleAlert className="h-3.5 w-3.5 text-danger" /> : m.status === 'QUEUED' ? <Clock3 className="h-3 w-3" /> : m.read ? <CheckCheck className="h-3.5 w-3.5 text-[#53bdeb]" /> : m.delivered ? <CheckCheck className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />)}
        </span>
        {failed && <span className="clear-both block pt-1 text-[11px] font-semibold text-danger">{m.status === 'SUPPRESSED' ? 'Not sent: they replied STOP' : 'Not sent. Check the linked number.'}</span>}
      </div>
    </div>
  );
}

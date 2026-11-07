import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Loader2,
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
  Sparkles,
  Wand2,
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
import { useSession } from '@/lib/session';
import { Dialog } from '@/components/ui/overlay';
import { Button } from '@/components/ui/button';

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

  const ai = { enabled: !!useQuery({ queryKey: ['ai'], queryFn: () => api.get<{ enabled: boolean }>('/api/ai'), staleTime: 300_000 }).data?.enabled };
  const { user } = useSession();
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
        {ai.enabled && (
          <DronaAiTray
            chatId={id}
            canTeach={user.role !== 'MEMBER'}
            hasCustomerMessage={!!t.messages.some((m) => m.direction === 'IN')}
            onDraft={(reply) => {
              typeInto(reply, setText);
              box.current?.focus();
            }}
            drafted={!!text.trim()}
          />
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

// ---------------------------------------------------------------------------- Drona AI

type Suggestion = { reply: string; situation: string; language: string; needsHuman: boolean; note: string | null };

const SITUATION: Record<string, string> = {
  greeting: 'Greeting',
  price_enquiry: 'Price question',
  availability: 'Availability',
  itinerary_details: 'Itinerary',
  ready_to_book: 'Ready to book',
  payment: 'Payment',
  documents_or_travel_info: 'Travel details',
  change_or_cancel: 'Change or cancel',
  complaint: 'Complaint',
  thanks_or_closing: 'Thanks',
  not_interested: 'Not interested',
  other: 'Other',
};

const HINTS = ['Share the price', 'Ask for dates and people', 'Ask for the advance', 'Offer to call them', 'Say sorry', 'Thank them'];

/** Puts the reply in the box a few words at a time, so it reads like it's being written. */
function typeInto(full: string, set: (v: string) => void) {
  const words = full.split(/(\s+)/);
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || words.length < 6) return set(full);
  let i = 0;
  const step = Math.max(1, Math.ceil(words.length / 30));
  const tick = () => {
    i = Math.min(words.length, i + step);
    set(words.slice(0, i).join(''));
    if (i < words.length) window.setTimeout(tick, 22);
  };
  tick();
}

function DronaAiTray({ chatId, canTeach, hasCustomerMessage, onDraft, drafted }: { chatId: string; canTeach: boolean; hasCustomerMessage: boolean; onDraft: (reply: string) => void; drafted: boolean }) {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState('');
  const [last, setLast] = useState<Suggestion | null>(null);
  const [teaching, setTeaching] = useState(false);
  const suggest = useMutation({
    mutationFn: (h?: string) => api.post<Suggestion>(`/api/inbox/${chatId}/suggest`, h ? { hint: h } : {}),
    onSuccess: (r) => {
      setLast(r);
      setOpen(false);
      setHint('');
      onDraft(r.reply);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const go = (h?: string) => !suggest.isPending && suggest.mutate(h?.trim() || undefined);

  return (
    <div className="mb-2 flex flex-col gap-2">
      {last && drafted && !suggest.isPending && (
        <div className="hub-in flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 font-semibold text-accent-strong">
            <Sparkles className="h-3 w-3" /> Written by Drona AI
          </span>
          <span className="rounded-full bg-sunken px-2.5 py-1 text-ink-2">{SITUATION[last.situation] ?? last.situation}</span>
          <span className="rounded-full bg-sunken px-2.5 py-1 text-ink-2">{last.language}</span>
          {last.needsHuman ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-warm-soft px-2.5 py-1 font-semibold text-warm-strong">
              <TriangleAlert className="h-3 w-3" /> Check before sending{last.note ? `: ${last.note}` : ''}
            </span>
          ) : (
            <span className="text-muted">Read it, change anything, then send.</span>
          )}
        </div>
      )}
      {open && (
        <div className="hub-in flex flex-col gap-2.5 rounded-[16px] border border-accent/25 bg-[linear-gradient(135deg,var(--color-accent-soft),transparent_70%)] p-3">
          <div className="flex flex-wrap gap-1.5">
            {HINTS.map((h) => (
              <button
                key={h}
                type="button"
                disabled={suggest.isPending}
                onClick={() => go(h)}
                className="rounded-full border border-accent/25 bg-surface px-3 py-1.5 text-[12px] font-semibold text-accent-strong transition-[transform,background] hover:-translate-y-px hover:bg-accent-soft active:scale-95 disabled:opacity-50"
              >
                {h}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              go(hint);
            }}
          >
            <input
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="Or tell Drona AI what to say, e.g. “offer the January dates”"
              aria-label="Instruction for Drona AI"
              className="h-10 min-w-0 flex-1 rounded-[10px] border border-line bg-surface px-3 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <Button type="submit" size="sm" variant="primary" loading={suggest.isPending} className="h-10">
              <Wand2 className="h-4 w-4" /> Write
            </Button>
          </form>
          {canTeach && (
            <button type="button" onClick={() => setTeaching(true)} className="self-start text-[12px] font-semibold text-accent hover:text-accent-strong">
              Teach Drona AI about your agency
            </button>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!hasCustomerMessage || suggest.isPending}
          onClick={() => go()}
          title={hasCustomerMessage ? 'Drona AI reads the conversation and writes a reply' : 'Nothing from the customer to answer yet'}
          className="ai-orb group inline-flex h-9 items-center gap-1.5 rounded-full bg-[linear-gradient(120deg,#4A3FD1,#7a6cf5)] px-3.5 text-[13px] font-bold text-white shadow-[0_6px_16px_-8px_rgb(74_63_209/0.8)] transition-transform hover:-translate-y-px active:scale-95 disabled:opacity-50"
        >
          {suggest.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 transition-transform group-hover:rotate-12" />}
          {suggest.isPending ? 'Reading the chat…' : 'Suggest a reply'}
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={!hasCustomerMessage}
          className={cn('h-9 rounded-full px-3 text-[13px] font-semibold transition-colors disabled:opacity-50', open ? 'bg-accent-soft text-accent-strong' : 'text-muted hover:bg-sunken hover:text-ink')}
        >
          {open ? 'Close' : 'Tell it what to say'}
        </button>
      </div>
      <TeachDialog open={teaching} onClose={() => setTeaching(false)} />
    </div>
  );
}

function TeachDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ai', 'notes'], queryFn: () => api.get<{ aiNotes: string | null }>('/api/ai/notes'), enabled: open });
  const [text, setText] = useState<string | null>(null);
  const value = text ?? q.data?.aiNotes ?? '';
  const save = useMutation({
    mutationFn: () => api.put('/api/ai/notes', { aiNotes: value.trim() || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai', 'notes'] });
      toast.success('Drona AI will use this from the next reply');
      setText(null);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Teach Drona AI about your agency"
      description="Everything here is used in every reply it writes. Your packages and each customer’s trips are read automatically; add what they don’t say."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <textarea
        value={value}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        maxLength={4000}
        placeholder={`Office hours: 9 am to 8 pm, Monday to Saturday.
Payment: UPI to 98480 12345 or bank transfer. 25% advance to confirm.
Cancellation: full refund up to 30 days before travel, 50% up to 15 days.
Pickup for Tirupati trips is from our office at Benz Circle.
Always offer to call the customer for group bookings.`}
        className="w-full rounded-[12px] border border-line bg-surface px-3.5 py-3 text-[13px] leading-relaxed outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
      <p className="mt-1.5 text-right text-[11px] text-muted">{value.length} / 4,000</p>
    </Dialog>
  );
}

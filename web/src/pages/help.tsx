import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CheckCircle2, Headset, Paperclip, Plus, Send, ShieldCheck, Star } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AttachmentPicker } from '@/components/attachments/attachments';
import { AttachHint, Conversation } from '@/components/care/conversation';
import { Button, LinkButton } from '@/components/ui/button';
import { Badge, Panel, Skeleton } from '@/components/ui/display';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Switch } from '@/components/ui/controls';
import { api, ApiError } from '@/lib/api';
import { burst } from '@/lib/celebrate';
import { CATEGORIES, categoryOf, type Category, type MyTicket, type SupportMessage, type TicketStatus } from '@/lib/care';
import { cn } from '@/lib/cn';
import { ago, dateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Attachment } from '@/lib/types';
import { tx } from '../lib/words';

/** How a request's state reads to the agency. */
export const AGENCY_STATUS: Record<TicketStatus, { label: string; tone: 'orange' | 'blue' | 'green'; dot: string }> = {
  OPEN: { label: 'With customer care', tone: 'orange', dot: 'bg-highlight' },
  WAITING: { label: 'Customer care replied', tone: 'blue', dot: 'bg-accent' },
  RESOLVED: { label: 'Solved', tone: 'green', dot: 'bg-success' },
};

const agencyFile = (a: Attachment, download = false) => `/api/attachments/${a.id}${download ? '?download' : ''}`;

/** The colourful band at the top of the customer care pages. */
function Hero({ children, title, text }: { children?: React.ReactNode; title: string; text: string }) {
  return (
    <section className="relative overflow-hidden rounded-[24px] bg-[linear-gradient(120deg,#2a1f8f,#4a3fd1_45%,#8a4fff_80%,#ff8a6a)] px-6 py-7 text-white shadow-[var(--shadow-lift)] sm:px-8 sm:py-9">
      {/* soft sound-wave rings behind the headset */}
      <svg aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-[340px] w-[340px] opacity-25" viewBox="0 0 200 200">
        {[30, 52, 74, 96].map((r) => (
          <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="white" strokeWidth="1.5" />
        ))}
      </svg>
      <div className="relative flex flex-wrap items-center gap-5">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[20px] bg-white/15 ring-1 ring-white/25 backdrop-blur">
          <Headset className="h-8 w-8" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.025em] sm:text-[32px]">{title}</h1>
          <p className="max-w-[56ch] text-[14.5px] leading-relaxed text-white/85">{text}</p>
        </div>
        {children}
      </div>
    </section>
  );
}

export function HelpPage() {
  const q = useQuery({ queryKey: ['support', 'tickets'], queryFn: () => api.get<{ tickets: MyTicket[] }>('/api/support/tickets'), refetchInterval: 20_000 });
  const { user } = useSession();
  const tickets = q.data?.tickets ?? [];
  const open = tickets.filter((t) => t.status !== 'RESOLVED');
  const solved = tickets.filter((t) => t.status === 'RESOLVED');
  return (
    <div className="flex flex-col gap-6">
      <Hero title="Customer care" text="Stuck on something? Tell us here. A person from the Dhrona team reads every request and replies on this page. You’ll get an alert when they do.">
        <Link
          to="/help/new"
          className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-bold text-accent shadow-[0_10px_24px_-12px_rgb(0_0_0/0.5)] transition-transform hover:-translate-y-0.5 active:translate-y-0"
        >
          <Plus className="h-5 w-5" strokeWidth={2.6} /> New request
        </Link>
      </Hero>

      {q.isPending ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[84px] rounded-[18px]" />
          ))}
        </div>
      ) : tickets.length === 0 ? (
        <Panel className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-[18px] font-bold">What do you need help with?</h2>
            <p className="text-sm text-muted">Pick one to start. No request is too small.</p>
          </div>
          <CategoryGrid onPick={() => undefined} linkTo />
        </Panel>
      ) : (
        <>
          <TicketList title="In progress" tickets={open} empty="Nothing waiting. Everything you asked about is solved." showBy={user.role === 'OWNER'} />
          {solved.length > 0 && <TicketList title="Solved" tickets={solved} showBy={user.role === 'OWNER'} />}
        </>
      )}
    </div>
  );
}

function TicketList({ title, tickets, empty, showBy }: { title: string; tickets: MyTicket[]; empty?: string; showBy: boolean }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        {title} <span className="tnum rounded-full bg-line-soft px-2 text-[12px] text-muted">{tickets.length}</span>
      </h2>
      {tickets.length === 0 && empty ? (
        <p className="rounded-[16px] border border-dashed border-line px-4 py-5 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="stagger flex flex-col gap-2.5">
          {tickets.map((t) => {
            const c = categoryOf(t.category);
            const s = AGENCY_STATUS[t.status];
            const Icon = c.icon;
            return (
              <li key={t.id}>
                <Link to={`/help/${t.id}`} className={cn('lift group flex items-center gap-4 rounded-[18px] border bg-surface p-4 shadow-[0_1px_2px_rgb(23_21_59/0.04)]', t.unread ? 'border-accent/40 shadow-[0_0_0_3px_var(--color-accent-soft)]' : 'border-line')}>
                  <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-[14px]', c.tone)}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-semibold">{t.subject}</span>
                      {t.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="New reply" />}
                    </span>
                    <span className="truncate text-[13px] text-muted">
                      {t.last ? `${t.last.author === 'CARE' ? 'Customer care: ' : t.last.author === 'SYSTEM' ? '' : 'You: '}${t.last.body}` : ''}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 text-[12px] text-faint">
                      <span className="tnum">Request {t.number}</span>
                      {showBy && t.byName && <span>· by {t.byName}</span>}
                      <span>· {ago(t.lastMessageAt)}</span>
                    </span>
                  </span>
                  <Badge tone={s.tone} dot className="hidden sm:inline-flex">
                    {s.label}
                  </Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CategoryGrid({ value, onPick, linkTo }: { value?: Category | null; onPick: (c: Category) => void; linkTo?: boolean }) {
  return (
    <div role="radiogroup" aria-label="What it’s about" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {CATEGORIES.map((c) => {
        const Icon = c.icon;
        const on = value === c.id;
        const inner = (
          <>
            <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-[12px] transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110', c.tone)}>
              <Icon className="h-5 w-5" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[14px] font-semibold leading-tight">{tx(c.label)}</span>
              <span className="truncate text-[12px] text-muted">{c.hint}</span>
            </span>
            {on && (
              <span className="absolute right-2 top-2 grid h-5 w-5 animate-check place-items-center rounded-full text-white" style={{ background: c.solid }}>
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            )}
          </>
        );
        const cls = cn(
          'group relative flex items-center gap-3 rounded-[16px] border bg-surface p-3 text-left transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5',
          on ? 'border-transparent' : 'border-line hover:border-[#cfcde6]',
        );
        const style = on ? { boxShadow: `0 0 0 2px ${c.solid}, 0 10px 22px -16px ${c.solid}` } : undefined;
        return linkTo ? (
          <Link key={c.id} to={`/help/new?about=${c.id}`} className={cls}>
            {inner}
          </Link>
        ) : (
          <button key={c.id} type="button" role="radio" aria-checked={on} onClick={() => onPick(c.id)} className={cls} style={style}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}

export function NewRequestPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user, tenant } = useSession();
  const about = params.get('about') as Category | null;
  const from = params.get('from') ?? undefined;
  const [category, setCategory] = useState<Category | null>(CATEGORIES.some((c) => c.id === about) ? about : null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [urgent, setUrgent] = useState(false);

  const send = useMutation({
    mutationFn: () =>
      api.post<{ ticket: { id: string; number: number } }>('/api/support/tickets', {
        category,
        subject,
        body,
        urgent,
        attachments: files.map((f) => f.id),
        context: { page: from, screen: `${window.innerWidth}×${window.innerHeight}` },
      }),
    onSuccess: (r) => {
      burst();
      toast.success(`Request ${r.ticket.number} sent`, { description: 'Customer care will reply on this page. You’ll get an alert.' });
      qc.invalidateQueries({ queryKey: ['support'] });
      nav(`/help/${r.ticket.id}`, { replace: true });
    },
  });
  const err = (k: string) => (send.error instanceof ApiError ? send.error.field(k) : undefined);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!category) return toast.error('Choose what it’s about first');
    send.mutate();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Link to="/help" className="inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Customer care
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-[28px] font-extrabold tracking-[-0.025em]">New request</h1>
        <p className="text-sm text-muted">Tell us like you’d tell a colleague. We read every word.</p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          <Panel className="flex flex-col gap-4 p-5 sm:p-6">
            <h2 className="text-[16px] font-bold">What’s it about?</h2>
            <CategoryGrid value={category} onPick={setCategory} />
          </Panel>

          <Panel className="flex flex-col gap-5 p-5 sm:p-6">
            <Field label="In a few words" error={err('subject')} aside={`${subject.length} / 140`}>
              {(p) => <Input {...p} maxLength={140} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. WhatsApp logs out every hour" autoFocus={!!category} />}
            </Field>
            <Field label="What happened?" error={err('body')} hint="What you were doing, what you expected, and what you saw instead.">
              {(p) => <Textarea {...p} rows={7} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Since this morning, our linked number disconnects every hour. I scan the QR code again and it works for a while…" />}
            </Field>
            <div className="flex flex-col gap-2">
              <span className="flex items-center justify-between">
                <span className="text-[13px] font-semibold">Screenshots or files</span>
                <AttachHint />
              </span>
              <AttachmentPicker value={files} onChange={setFiles} channel="BOTH" />
            </div>
            <label className={cn('flex items-center gap-3 rounded-[14px] border px-4 py-3 transition-colors', urgent ? 'border-[#f3c9a8] bg-warm-soft' : 'border-line')}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[14px] font-semibold">It’s stopping our work</span>
                <span className="text-[12.5px] text-muted">We’ll look at it before other requests.</span>
              </span>
              <Switch checked={urgent} onCheckedChange={setUrgent} label="It’s stopping our work" />
            </label>
          </Panel>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" size="lg" loading={send.isPending}>
              <Send className="h-4 w-4" /> Send to customer care
            </Button>
            <LinkButton to="/help" variant="ghost">
              Cancel
            </LinkButton>
          </div>
        </div>

        <aside className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-5 xl:sticky xl:top-6">
          <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-success-soft text-success">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <h2 className="text-[15px] font-bold">You won’t have to explain twice</h2>
          <p className="text-[13px] leading-relaxed text-ink-2">With your request, customer care sees:</p>
          <ul className="flex flex-col gap-1.5 text-[13px] text-ink-2">
            {[
              tx(`Your agency, ${tenant.name}, and its plan`),
              `That it’s from ${user.name}`,
              from ? `The page you were on (${from})` : 'Which browser you use',
              'How your WhatsApp and email sending are doing',
            ].map((x) => (
              <li key={x} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" /> {x}
              </li>
            ))}
          </ul>
          <p className="text-[12.5px] leading-relaxed text-muted">They never see your passwords, and they can’t send anything for you.</p>
        </aside>
      </div>
    </form>
  );
}

export function RequestPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['support', 'ticket', id],
    queryFn: () =>
      api.get<{
        ticket: { id: string; number: number; subject: string; category: Category; status: TicketStatus; createdAt: string; resolvedAt: string | null; rating: number | null; ratingNote: string | null };
        messages: SupportMessage[];
      }>(`/api/support/tickets/${id}`),
    refetchInterval: 12_000,
  });
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['support'] });
  };
  const reply = useMutation({
    mutationFn: () => api.post(`/api/support/tickets/${id}/messages`, { body, attachments: files.map((f) => f.id) }),
    onSuccess: () => {
      setBody('');
      setFiles([]);
      setAttaching(false);
      refresh();
    },
  });
  const resolve = useMutation({
    mutationFn: () => api.post(`/api/support/tickets/${id}/resolve`),
    onSuccess: () => {
      burst();
      refresh();
    },
  });

  if (q.isPending) return <Skeleton className="h-[480px] rounded-[20px]" />;
  if (q.isError || !q.data)
    return (
      <Panel className="p-8 text-center text-sm text-muted">
        That request could not be found. <Link to="/help" className="font-semibold text-accent">See all requests</Link>
      </Panel>
    );

  const { ticket: t, messages } = q.data;
  const c = categoryOf(t.category);
  const s = AGENCY_STATUS[t.status];
  const Icon = c.icon;
  const solved = t.status === 'RESOLVED';

  return (
    <div className="flex flex-col gap-5">
      <Link to="/help" className="inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Customer care
      </Link>
      <header className="flex flex-wrap items-start gap-4">
        <span className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-[16px]', c.tone)}>
          <Icon className="h-6 w-6" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-[24px] font-extrabold leading-tight tracking-[-0.02em]">{t.subject}</h1>
          <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
            <span className="tnum">Request {t.number}</span>
            <span>· {tx(c.label)}</span>
            <span>· Sent {dateTime(t.createdAt)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={s.tone} dot>
            {s.label}
          </Badge>
          {!solved && (
            <Button size="sm" loading={resolve.isPending} onClick={() => resolve.mutate()}>
              <CheckCircle2 className="h-4 w-4" /> It’s solved
            </Button>
          )}
        </div>
      </header>

      <Panel className="flex flex-col overflow-hidden">
        <div className="max-h-[min(62vh,640px)] min-h-[280px] overflow-y-auto bg-[radial-gradient(circle_at_top_right,#f1efff,transparent_55%)] px-4 py-5 sm:px-6">
          <Conversation messages={messages} side="agency" fileUrl={agencyFile} />
          {t.status === 'OPEN' && messages.at(-1)?.author === 'AGENCY' && (
            <p className="mt-4 flex items-center justify-center gap-2 text-[12.5px] text-muted">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-highlight opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-highlight" />
              </span>
              Customer care has your message. You’ll get an alert when they reply.
            </p>
          )}
        </div>

        {solved && <Rating id={t.id} rating={t.rating} onDone={refresh} />}

        <form
          className="flex flex-col gap-3 border-t border-line-soft bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) reply.mutate();
          }}
        >
          {attaching && <AttachmentPicker value={files} onChange={setFiles} channel="BOTH" />}
          <div className="flex items-end gap-2">
            <Textarea
              aria-label="Your reply"
              rows={2}
              className="min-h-[52px] flex-1 resize-none"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) reply.mutate();
              }}
              placeholder={solved ? 'Write here to open it again…' : 'Write a reply…'}
            />
            <Button type="button" variant="ghost" aria-label="Attach files" onClick={() => setAttaching((a) => !a)} className={cn(attaching && 'bg-accent-soft text-accent')}>
              <Paperclip className="h-4 w-4" />
            </Button>
            <Button type="submit" variant="primary" loading={reply.isPending} disabled={!body.trim()}>
              <Send className="h-4 w-4" /> Send
            </Button>
          </div>
          {reply.error instanceof ApiError && <p className="text-[13px] text-danger">{reply.error.field('body') ?? reply.error.message}</p>}
        </form>
      </Panel>
    </div>
  );
}

/** "How did we do?" once a request is solved. */
function Rating({ id, rating, onDone }: { id: string; rating: number | null; onDone: () => void }) {
  const [hover, setHover] = useState(0);
  const [picked, setPicked] = useState(rating ?? 0);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(!!rating);
  const save = useMutation({
    mutationFn: () => api.post(`/api/support/tickets/${id}/rating`, { rating: picked, note: note || undefined }),
    onSuccess: () => {
      setSent(true);
      toast.success('Thank you. That helps us a lot.');
      onDone();
    },
  });
  const shown = hover || picked;
  const words = ['', 'Not helpful', 'Could be better', 'Okay', 'Good', 'Brilliant'];
  return (
    <div className="flex flex-col items-center gap-3 border-t border-line-soft bg-[linear-gradient(180deg,#f2fbf6,#fff)] px-4 py-5 text-center">
      <span className="text-[14px] font-semibold">{sent ? 'Thanks for rating us' : 'This is solved. How did we do?'}</span>
      <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={sent}
            aria-label={`${n} of 5: ${words[n]}`}
            onMouseEnter={() => !sent && setHover(n)}
            onClick={() => setPicked(n)}
            className="rounded-lg p-1 transition-transform duration-200 enabled:hover:scale-125"
          >
            <Star className={cn('h-7 w-7 transition-colors', n <= shown ? 'fill-highlight text-highlight' : 'text-line')} />
          </button>
        ))}
      </div>
      <span className="h-4 text-[12.5px] font-medium text-muted">{words[shown]}</span>
      {!sent && picked > 0 && (
        <div className="flex w-full max-w-md flex-col gap-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything to add? (optional)" />
          <Button variant="primary" size="sm" loading={save.isPending} onClick={() => save.mutate()}>
            Send rating
          </Button>
        </div>
      )}
    </div>
  );
}

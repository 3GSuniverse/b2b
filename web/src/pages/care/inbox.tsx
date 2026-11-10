import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, CheckCircle2, ChevronDown, Crown, Flag, Inbox, Lock, MessageSquareText, PanelRight, RotateCcw, Search, Send, Sparkles, Star, UserRound } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AgencyPanel, useAgencyProfile } from '@/components/care/agency-profile';
import { Conversation } from '@/components/care/conversation';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Skeleton } from '@/components/ui/display';
import { Input, NativeSelect, Textarea } from '@/components/ui/field';
import { Menu, MenuItem, MenuSeparator, Sheet } from '@/components/ui/overlay';
import { api, qs } from '@/lib/api';
import { burst } from '@/lib/celebrate';
import { CARE_STATUS, CATEGORIES, categoryOf, PRIORITY, type CareTicket, type CareView, type Priority, type QueueTicket } from '@/lib/care';
import { cn } from '@/lib/cn';
import { ago, dateTime } from '@/lib/format';
import type { Attachment } from '@/lib/types';
import { summaryQuery, useStaff } from './app';

const careFile = (a: Attachment, download = false) => `/api/care/attachments/${a.id}${download ? '?download' : ''}`;

const VIEWS: { id: CareView; label: string; key: 'needsReply' | 'unassigned' | 'mine' | 'waiting' | 'resolvedToday' | 'all' }[] = [
  { id: 'needs_reply', label: 'Needs reply', key: 'needsReply' },
  { id: 'unassigned', label: 'Nobody on it', key: 'unassigned' },
  { id: 'mine', label: 'Mine', key: 'mine' },
  { id: 'waiting', label: 'Waiting on agency', key: 'waiting' },
  { id: 'resolved', label: 'Solved', key: 'resolvedToday' },
  { id: 'all', label: 'Everything', key: 'all' },
];

/** "4h 20m", "2d 3h": how long someone has waited. */
function waited(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60 ? `${m % 60}m` : ''}`.trim();
  return `${Math.floor(h / 24)}d ${h % 24 ? `${h % 24}h` : ''}`.trim();
}
const waitTone = (iso: string) => {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h >= 24 ? 'text-danger' : h >= 4 ? 'text-warm' : 'text-success';
};

/** The queue, the open request, and the agency behind it, side by side. */
export function CareInbox() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as CareView) || 'needs_reply';
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const summary = useQuery(summaryQuery).data;
  const list = useQuery({
    queryKey: ['care', 'tickets', view, term, category],
    queryFn: () => api.get<{ tickets: QueueTicket[] }>(`/api/care/tickets${qs({ view, q: term, category })}`),
    refetchInterval: 15_000,
    placeholderData: (p) => p,
  });
  const setView = (v: CareView) => setParams(v === 'needs_reply' ? {} : { view: v }, { replace: true });
  const keep = params.toString() ? `?${params}` : '';

  return (
    <div className="flex h-full flex-col">
      {/* The numbers that matter today, doubling as the queue's views */}
      <div className={cn('shrink-0 border-b border-line bg-surface px-4 pb-0 pt-4 sm:px-5', id && 'hidden lg:block')}>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 pb-3">
          <div className="flex flex-col">
            <h1 className="text-[20px] font-extrabold tracking-[-0.02em]">Requests</h1>
            <span className="text-[12.5px] text-muted">
              {summary?.oldestOpen ? (
                <>
                  Longest wait <b className={cn('font-semibold', waitTone(summary.oldestOpen))}>{waited(summary.oldestOpen)}</b>
                </>
              ) : (
                'Nobody is waiting. Lovely.'
              )}
            </span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Pill icon={<Flag className="h-3.5 w-3.5" />} tone="bg-danger-soft text-danger" label="Urgent or high" value={summary?.urgent} />
            <Pill icon={<Sparkles className="h-3.5 w-3.5" />} tone="bg-success-soft text-success-strong" label="Solved today" value={summary?.resolvedToday} />
            <Pill icon={<MessageSquareText className="h-3.5 w-3.5" />} tone="bg-blue-soft text-blue-ink" label="First reply, typical" value={summary?.firstReplyMinutes != null ? minutes(summary.firstReplyMinutes) : '—'} />
            <Pill icon={<Star className="h-3.5 w-3.5" />} tone="bg-highlight-soft text-warm-strong" label="Rating, 30 days" value={summary?.rating != null ? `${summary.rating} / 5` : '—'} />
          </div>
        </div>
        <nav aria-label="Views" className="-mb-px flex gap-1 overflow-x-auto">
          {VIEWS.map((v) => {
            const on = v.id === view;
            const count = summary?.[v.key];
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                className={cn('flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-[13px] font-semibold transition-colors', on ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')}
              >
                {v.label}
                {count !== undefined && v.id !== 'all' && (
                  <span className={cn('tnum rounded-full px-1.5 text-[11.5px]', on ? (v.id === 'needs_reply' && count ? 'bg-highlight text-white' : 'bg-accent text-white') : 'bg-line-soft text-ink-2')}>{count}</span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* The queue */}
        <section aria-label="Queue" className={cn('flex w-full shrink-0 flex-col border-r border-line bg-surface lg:w-[360px] 2xl:w-[380px]', id && 'hidden lg:flex')}>
          <div className="flex shrink-0 gap-2 border-b border-line-soft p-3">
            <Input leading={<Search className="h-4 w-4" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Agency, person, words, 1042" aria-label="Search requests" className="h-10" />
            <NativeSelect aria-label="Topic" value={category} onChange={(e) => setCategory(e.target.value)} className="h-10 w-[120px]">
              <option value="">All topics</option>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.isPending ? (
              <div className="flex flex-col gap-2 p-3">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-[92px] rounded-[14px]" />
                ))}
              </div>
            ) : !list.data?.tickets.length ? (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <span className="grid h-14 w-14 place-items-center rounded-[18px] bg-success-soft text-success">
                  <Inbox className="h-7 w-7" />
                </span>
                <p className="text-[15px] font-semibold">{term || category ? 'Nothing matches' : view === 'needs_reply' ? 'All caught up' : 'Nothing here'}</p>
                <p className="text-[13px] text-muted">{view === 'needs_reply' && !term ? 'Every agency has an answer. New requests appear here by themselves.' : 'Try another view or search.'}</p>
              </div>
            ) : (
              <ul className={cn('flex flex-col', list.isFetching && list.isPlaceholderData && 'opacity-60')}>
                {list.data.tickets.map((t) => (
                  <QueueRow key={t.id} t={t} active={t.id === id} href={`/care/t/${t.id}${keep}`} />
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* The open request */}
        <section aria-label="Request" className={cn('min-w-0 flex-1 flex-col', id ? 'flex' : 'hidden lg:flex')}>
          {id ? <TicketView key={id} id={id} back={`/care${keep}`} /> : <NoTicket count={summary?.needsReply ?? 0} />}
        </section>
      </div>
    </div>
  );
}

const minutes = (m: number) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 6) / 10} h` : `${Math.round(m / 144) / 10} d`);

function Pill({ icon, tone, label, value }: { icon: ReactNode; tone: string; label: string; value: ReactNode }) {
  return (
    <span className="flex items-center gap-2 rounded-full border border-line-soft bg-sunken py-1 pl-1 pr-3 text-[12px]">
      <span className={cn('grid h-6 w-6 place-items-center rounded-full', tone)}>{icon}</span>
      <span className="text-muted">{label}</span>
      <b className="tnum font-bold text-ink">{value ?? '—'}</b>
    </span>
  );
}

function QueueRow({ t, active, href }: { t: QueueTicket; active: boolean; href: string }) {
  const c = categoryOf(t.category);
  const Icon = c.icon;
  const p = PRIORITY[t.priority];
  return (
    <li>
      <Link
        to={href}
        aria-current={active ? 'page' : undefined}
        className={cn('relative flex gap-3 border-b border-line-soft py-3 pl-4 pr-3 transition-colors', active ? 'bg-accent-soft/70' : 'hover:bg-sunken')}
      >
        {/* Priority stripe */}
        <span className={cn('absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full', t.priority === 'URGENT' ? 'bg-danger' : t.priority === 'HIGH' ? 'bg-highlight' : 'bg-transparent')} aria-hidden />
        <span className={cn('mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[11px]', c.tone)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className={cn('min-w-0 flex-1 truncate text-[13.5px]', t.unread ? 'font-bold' : 'font-semibold')}>{t.agencyName}</span>
            {t.priorityPlan && <Crown className="h-3.5 w-3.5 shrink-0 text-highlight" aria-label="Priority support plan" />}
            {t.status === 'OPEN' ? (
              <span className={cn('tnum shrink-0 text-[11.5px] font-semibold', waitTone(t.lastMessageAt))}>{waited(t.lastMessageAt)}</span>
            ) : (
              <span className="shrink-0 text-[11.5px] text-faint">{ago(t.lastMessageAt)}</span>
            )}
          </span>
          <span className={cn('truncate text-[13px]', t.unread ? 'font-semibold text-ink' : 'text-ink-2')}>{t.subject}</span>
          <span className="truncate text-[12px] text-muted">
            {t.last?.author === 'CARE' ? 'Care: ' : ''}
            {t.last?.body}
          </span>
          <span className="mt-1 flex items-center gap-1.5 text-[11.5px] text-faint">
            <span className="tnum">{t.number}</span>
            <span>·</span>
            <span className="truncate">{t.requester ?? 'Unknown'}</span>
            {t.priority !== 'NORMAL' && <span className={cn('rounded-full px-1.5 py-px text-[10.5px] font-bold', p.cls)}>{p.label}</span>}
            {t.status !== 'OPEN' && <Badge tone={CARE_STATUS[t.status].tone}>{CARE_STATUS[t.status].label}</Badge>}
            <span className="ml-auto flex items-center gap-1.5">
              {t.unread && <span className="h-2 w-2 rounded-full bg-accent" aria-label="Unread" />}
              {t.assigneeName ? (
                <span title={`With ${t.assigneeName}`}>
                  <Avatar name={t.assigneeName} size={20} />
                </span>
              ) : (
                <span className="rounded-full border border-dashed border-line px-1.5 text-[10.5px]">nobody</span>
              )}
            </span>
          </span>
        </span>
      </Link>
    </li>
  );
}

function NoTicket({ count }: { count: number }) {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <svg aria-hidden viewBox="0 0 120 120" className="h-28 w-28">
          {[24, 38, 52].map((r, i) => (
            <circle key={r} cx="60" cy="60" r={r} fill="none" stroke={i === 1 ? '#ff8a1f' : '#8f86ff'} strokeOpacity={0.35 - i * 0.08} strokeWidth="2" />
          ))}
          <circle cx="60" cy="60" r="14" fill="#4a3fd1" />
          <path d="M53 62v-3a7 7 0 0 1 14 0v3" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
        <p className="text-[17px] font-bold">{count ? `${count} ${count === 1 ? 'agency is' : 'agencies are'} waiting` : 'You’re all caught up'}</p>
        <p className="text-[13.5px] text-muted">Open a request from the list. You’ll see the conversation here, and everything about the agency beside it.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- one request

function TicketView({ id, back }: { id: string; back: string }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const staff = useStaff();
  const t = useQuery({ queryKey: ['care', 'ticket', id], queryFn: () => api.get<CareTicket>(`/api/care/tickets/${id}`), refetchInterval: 10_000 });
  const team = useQuery({ queryKey: ['care', 'staff'], queryFn: () => api.get<{ staff: { id: string; name: string; role: string }[] }>('/api/care/staff'), staleTime: 300_000 });
  const profile = useAgencyProfile(t.data?.ticket.tenantId);
  const [details, setDetails] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['care', 'ticket', id] });
    qc.invalidateQueries({ queryKey: ['care', 'tickets'] });
    qc.invalidateQueries({ queryKey: ['care', 'summary'] });
  };
  const patch = useMutation({ mutationFn: (body: Record<string, unknown>) => api.patch(`/api/care/tickets/${id}`, body), onSuccess: refresh });

  if (t.isPending)
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <Skeleton className="h-10 w-2/3 rounded-lg" />
        <Skeleton className="h-64 rounded-[18px]" />
      </div>
    );
  if (!t.data) return <p className="p-8 text-sm text-muted">That request could not be found.</p>;
  const { ticket, requester, messages } = t.data;
  const c = categoryOf(ticket.category);
  const CatIcon = c.icon;
  const solved = ticket.status === 'RESOLVED';

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex shrink-0 flex-col gap-3 border-b border-line bg-surface px-4 py-3 sm:px-5">
          <div className="flex items-start gap-3">
            <Link to={back} className="-ml-1 mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover lg:hidden" aria-label="Back to requests">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <span className={cn('mt-0.5 hidden h-10 w-10 shrink-0 place-items-center rounded-[12px] sm:grid', c.tone)}>
              <CatIcon className="h-5 w-5" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h2 className="text-[18px] font-bold leading-snug tracking-[-0.01em]">{ticket.subject}</h2>
              <p className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-muted">
                <span className="tnum font-semibold text-ink-2">Request {ticket.number}</span>
                <span>·</span>
                <Link to={`/care/agencies/${ticket.tenantId}`} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
                  <Building2 className="h-3.5 w-3.5" />
                  {profile.data?.agency.name ?? 'Agency'}
                </Link>
                <span>·</span>
                <span>{requester?.name ?? 'Someone'}</span>
                <span>· opened {dateTime(ticket.createdAt)}</span>
              </p>
            </div>
            <Button size="sm" variant="ghost" className="2xl:hidden" onClick={() => setDetails(true)}>
              <PanelRight className="h-4 w-4" /> <span className="hidden sm:inline">Agency</span>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={CARE_STATUS[ticket.status].tone} dot>
              {CARE_STATUS[ticket.status].label}
            </Badge>
            <PriorityMenu value={ticket.priority} onChange={(p) => patch.mutate({ priority: p })} />
            <Menu
              align="start"
              trigger={
                <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface pl-1 pr-2.5 text-[12px] font-semibold hover:bg-sunken">
                  {ticket.assignee ? <Avatar name={ticket.assignee.name} size={20} /> : <UserRound className="ml-1 h-3.5 w-3.5 text-muted" />}
                  {ticket.assignee ? (ticket.assignee.id === staff.id ? 'You' : ticket.assignee.name) : 'Nobody on it'}
                  <ChevronDown className="h-3.5 w-3.5 text-muted" />
                </button>
              }
            >
              {ticket.assigneeId !== staff.id && <MenuItem onSelect={() => patch.mutate({ assigneeId: staff.id })}>Take it myself</MenuItem>}
              {(team.data?.staff ?? [])
                .filter((s) => s.id !== staff.id && s.id !== ticket.assigneeId)
                .map((s) => (
                  <MenuItem key={s.id} onSelect={() => patch.mutate({ assigneeId: s.id })}>
                    Give to {s.name}
                  </MenuItem>
                ))}
              {ticket.assigneeId && (
                <>
                  <MenuSeparator />
                  <MenuItem onSelect={() => patch.mutate({ assigneeId: null })}>Nobody</MenuItem>
                </>
              )}
            </Menu>
            <NativeSelect aria-label="Topic" value={ticket.category} onChange={(e) => patch.mutate({ category: e.target.value })} className="h-7 w-auto rounded-full py-0 pl-3 pr-8 text-[12px] font-semibold">
              {CATEGORIES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </NativeSelect>
            <span className="ml-auto flex items-center gap-2">
              {ticket.rating && (
                <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-warm-strong" title={ticket.ratingNote ?? undefined}>
                  <Star className="h-3.5 w-3.5 fill-highlight text-highlight" /> {ticket.rating}/5
                </span>
              )}
              {solved ? (
                <Button size="sm" onClick={() => patch.mutate({ status: 'OPEN' })}>
                  <RotateCcw className="h-4 w-4" /> Reopen
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() =>
                    patch.mutate(
                      { status: 'RESOLVED' },
                      {
                        onSuccess: () => {
                          burst();
                          toast.success(`Request ${ticket.number} solved`);
                          nav(back);
                        },
                      },
                    )
                  }
                >
                  <CheckCircle2 className="h-4 w-4 text-success" /> Mark solved
                </Button>
              )}
            </span>
          </div>
        </header>

        {/* Conversation */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top_left,#f1efff,transparent_50%)] px-4 py-5 sm:px-6">
          <Conversation messages={messages} side="care" fileUrl={careFile} />
        </div>

        <Composer ticket={t.data} domain={profile.data?.channels.domains.find((d) => d.identity !== 'VERIFIED')?.domain} onSent={refresh} onSolved={() => nav(back)} />
      </div>

      {/* The agency, beside the conversation on wide screens */}
      <aside aria-label="Agency details" className="hidden w-[420px] shrink-0 overflow-y-auto border-l border-line bg-surface 2xl:block">
        <AgencyPanel id={ticket.tenantId} ticket={t.data} />
      </aside>
      <Sheet open={details} onOpenChange={setDetails} title={profile.data?.agency.name ?? 'Agency'} width="max-w-[460px]">
        <div className="-mx-6 -my-6">
          <AgencyPanel id={ticket.tenantId} ticket={t.data} />
        </div>
      </Sheet>
    </div>
  );
}

function PriorityMenu({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  const p = PRIORITY[value];
  return (
    <Menu
      align="start"
      trigger={
        <button type="button" className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-bold', p.cls)}>
          <Flag className="h-3.5 w-3.5" /> {p.label}
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </button>
      }
    >
      {(['URGENT', 'HIGH', 'NORMAL', 'LOW'] as Priority[]).map((x) => (
        <MenuItem key={x} onSelect={() => onChange(x)}>
          <span className="flex items-center gap-2">
            <span className={cn('h-2.5 w-2.5 rounded-full', PRIORITY[x].dot)} />
            {PRIORITY[x].label}
          </span>
        </MenuItem>
      ))}
    </Menu>
  );
}

/** Ready answers for the questions that come up again and again. */
const SAVED: { title: string; text: (v: { first: string; domain: string }) => string }[] = [
  { title: 'Ask for a screenshot', text: (v) => `Hi ${v.first}, thanks for writing in. Could you send a screenshot of what you see, and tell us roughly when it started? That helps us find it quickly.` },
  {
    title: 'WhatsApp logged out: link again',
    text: (v) =>
      `Hi ${v.first}, WhatsApp logged your number out of Dhrona. On your phone, open WhatsApp → Settings → Linked devices and remove any devices you don’t use. Then in Dhrona go to WhatsApp → Linked number and scan the QR code again. It should stay linked after that.`,
  },
  {
    title: 'Domain not verified: DNS records',
    text: (v) =>
      `Hi ${v.first}, ${v.domain} isn’t verified yet because its DNS records aren’t showing. In Dhrona, open Settings → Sending and copy each record exactly into your domain provider (GoDaddy, Hostinger and so on). They can take up to an hour to appear. Tell us once they’re added and we’ll check.`,
  },
  { title: 'Plan is active now', text: (v) => `Hi ${v.first}, your plan is active now. If anything still looks old, sign out and sign in again so the page picks up the change.` },
  { title: 'Fixed: please try again', text: (v) => `Hi ${v.first}, this is fixed now. Please try again, and tell us if anything still looks off.` },
  { title: 'Thanks for the idea', text: (v) => `Hi ${v.first}, thank you for the idea. We’ve shared it with the team building Dhrona. We’ll let you know here if it’s added.` },
];

function Composer({ ticket: t, domain, onSent, onSolved }: { ticket: CareTicket; domain?: string; onSent: () => void; onSolved: () => void }) {
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const draftKey = `care-draft-${t.ticket.id}`;
  const [body, setBody] = useState(() => {
    try {
      return sessionStorage.getItem(draftKey) ?? '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    try {
      if (body) sessionStorage.setItem(draftKey, body);
      else sessionStorage.removeItem(draftKey);
    } catch {
      /* private window */
    }
  }, [body, draftKey]);
  const box = useRef<HTMLTextAreaElement>(null);
  const first = t.requester?.name.split(' ')[0] ?? 'there';
  const vars = useMemo(() => ({ first, domain: domain ?? 'your domain' }), [first, domain]);
  const send = useMutation({
    mutationFn: (resolve: boolean) => api.post(`/api/care/tickets/${t.ticket.id}/messages`, { body, internal: mode === 'note', resolve }),
    onSuccess: (_r, resolve) => {
      setBody('');
      onSent();
      if (resolve) {
        burst();
        toast.success(`Replied and solved request ${t.ticket.number}`);
        onSolved();
      } else toast.success(mode === 'note' ? 'Note saved' : `Sent to ${first}`);
    },
  });
  const note = mode === 'note';
  return (
    <form
      className={cn('shrink-0 border-t px-4 pb-4 pt-2.5 transition-colors sm:px-5', note ? 'border-[#e8c55a] bg-[#fffaf0]' : 'border-line bg-surface')}
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) send.mutate(false);
      }}
    >
      <div className="mb-2 flex items-center gap-1">
        {(
          [
            ['reply', <>Reply<span className="hidden sm:inline"> to {first}</span></>, <Send key="s" className="h-3.5 w-3.5" />],
            ['note', <>Private<span className="hidden sm:inline"> note</span></>, <Lock key="l" className="h-3.5 w-3.5" />],
          ] as const
        ).map(([m, label, icon]) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              box.current?.focus();
            }}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold transition-colors',
              mode === m ? (m === 'note' ? 'bg-[#ffe9a8] text-[#6b4d00]' : 'bg-accent-soft text-accent-strong') : 'text-muted hover:bg-hover hover:text-ink',
            )}
          >
            {icon}
            {label}
          </button>
        ))}
        <span className="ml-auto">
          <Menu
            trigger={
              <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold text-muted hover:bg-hover hover:text-ink">
                <MessageSquareText className="h-3.5 w-3.5" /> Saved<span className="hidden sm:inline"> replies</span>
              </button>
            }
          >
            <div className="w-72">
              {SAVED.map((s) => (
                <MenuItem
                  key={s.title}
                  onSelect={() => {
                    setMode('reply');
                    setBody((b) => (b.trim() ? `${b.trim()}\n\n` : '') + s.text(vars));
                    setTimeout(() => box.current?.focus(), 30);
                  }}
                >
                  <span className="flex flex-col">
                    <span className="font-semibold">{s.title}</span>
                    <span className="line-clamp-1 text-xs text-muted">{s.text(vars)}</span>
                  </span>
                </MenuItem>
              ))}
            </div>
          </Menu>
        </span>
      </div>
      <Textarea
        ref={box}
        aria-label={note ? 'Private note' : 'Reply'}
        rows={4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) {
            e.preventDefault();
            send.mutate(false);
          }
        }}
        placeholder={note ? 'Only customer care sees this. What did you find? What should the next person know?' : `Write to ${first}. They see your first name only.`}
        className={cn('min-h-[96px] resize-y', note && 'border-[#e8c55a] bg-white focus:border-[#d9a300]')}
      />
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-faint">Ctrl + Enter sends</span>
        <span className="ml-auto flex gap-2">
          {!note && t.ticket.status !== 'RESOLVED' && (
            <Button type="button" disabled={!body.trim()} loading={send.isPending && send.variables === true} onClick={() => send.mutate(true)}>
              <CheckCircle2 className="h-4 w-4 text-success" /> Send and solve
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={!body.trim()} loading={send.isPending && send.variables === false} className={cn(note && 'bg-[#b88400] hover:bg-[#9a6f00]')}>
            {note ? <Lock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {note ? 'Save note' : 'Send'}
          </Button>
        </span>
      </div>
    </form>
  );
}



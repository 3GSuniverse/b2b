import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Circle,
  Clock3,
  Crown,
  ExternalLink,
  Globe,
  Laptop,
  Mail,
  MessageCircle,
  MinusCircle,
  Monitor,
  Plane,
  Receipt,
  Smartphone,
  Users,
  XCircle,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Badge, CopyButton, Skeleton } from '@/components/ui/display';
import { api } from '@/lib/api';
import { CARE_STATUS, type AgencyProfile, type CareTicket } from '@/lib/care';
import { cn } from '@/lib/cn';
import { ago, date, dateTime, inr, n, phone } from '@/lib/format';
import { businessLabel, nb, txFor } from '../../lib/words';

export const useAgencyProfile = (id: string | undefined) =>
  useQuery({ queryKey: ['care', 'agency', id], queryFn: () => api.get<AgencyProfile>(`/api/care/agencies/${id}`), enabled: !!id, refetchInterval: 60_000 });

type Level = 'good' | 'warn' | 'bad' | 'off';
type Signal = { level: Level; icon: ReactNode; title: string; note?: string };

const ROLE = { OWNER: nb('Agency owner'), ADMIN: 'Manager', MEMBER: 'Employee' } as const;

/**
 * What's wrong (or fine) with this agency right now, worst first. This is what customer care reads
 * first: most requests are explained by one of these.
 */
export function signals(p: AgencyProfile): Signal[] {
  const out: Signal[] = [];
  const now = Date.now();
  const a = p.agency;
  if (a.status !== 'ACTIVE') out.push({ level: 'bad', icon: <XCircle />, title: a.status === 'SUSPENDED' ? 'Account suspended' : 'Sending is paused', note: a.pausedReason ?? undefined });

  const pl = p.plan;
  if (pl.plan === 'TRIAL') {
    if (pl.trialEnded) out.push({ level: 'bad', icon: <Clock3 />, title: pl.planId ? 'Plan lapsed: sending is off' : 'Free trial ended: sending is off', note: pl.trialEndsAt ? `Ended ${date(pl.trialEndsAt, { day: 'numeric', month: 'short' })}` : undefined });
    else out.push({ level: (pl.daysLeft ?? 9) <= 2 ? 'warn' : 'good', icon: <Clock3 />, title: `Free trial: ${pl.daysLeft === 0 ? 'ends today' : `${pl.daysLeft} ${pl.daysLeft === 1 ? 'day' : 'days'} left`}` });
  } else if (pl.paidUntil) {
    const days = Math.ceil((new Date(pl.paidUntil).getTime() - now) / 86_400_000);
    out.push({ level: days <= 5 ? 'warn' : 'good', icon: <Receipt />, title: `${pl.name}, paid till ${date(pl.paidUntil, { day: 'numeric', month: 'short', year: 'numeric' })}`, note: days <= 5 ? `Renewal due in ${Math.max(0, days)} ${days === 1 ? 'day' : 'days'}` : undefined });
  } else {
    out.push({ level: 'good', icon: <Receipt />, title: `${pl.name}`, note: 'No end date' });
  }

  const wa = p.channels.whatsapp;
  if (!wa || wa.status === 'DISCONNECTED') out.push({ level: 'off', icon: <MessageCircle />, title: 'WhatsApp not linked' });
  else if (wa.status === 'CONNECTED') {
    const cap = p.usage.whatsappPerDay;
    const near = cap ? p.usage.whatsappLast24h / cap >= 0.9 : false;
    out.push({ level: near ? 'warn' : 'good', icon: <MessageCircle />, title: `WhatsApp linked ${phone(wa.phone)}`, note: `${n(p.usage.whatsappLast24h)}${cap ? ` of ${n(cap)}` : ''} sent in 24 hours${near ? ': almost at the daily limit' : ''}` });
  } else if (wa.status === 'CONNECTING') out.push({ level: 'warn', icon: <MessageCircle />, title: 'WhatsApp: waiting for the QR code to be scanned' });
  else out.push({ level: 'bad', icon: <MessageCircle />, title: wa.status === 'BLOCKED' ? 'WhatsApp refused this number' : 'WhatsApp logged out from the phone', note: wa.lastError ?? undefined });

  const readyDomain = p.channels.domains.some((d) => d.identity === 'VERIFIED' && d.dkim === 'VERIFIED');
  const brokenBox = p.channels.mailboxes.find((m) => m.status !== 'ACTIVE');
  const okBox = p.channels.mailboxes.some((m) => m.status === 'ACTIVE');
  if (brokenBox) out.push({ level: 'bad', icon: <Mail />, title: `${brokenBox.email} disconnected`, note: brokenBox.lastError ?? 'They need to connect it again in Settings' });
  if (!readyDomain && !okBox) {
    const pending = p.channels.domains.find((d) => d.identity !== 'VERIFIED' || d.dkim !== 'VERIFIED');
    out.push({ level: 'warn', icon: <Globe />, title: pending ? `${pending.domain} not verified yet` : 'No email sender set up', note: pending ? 'DNS records missing or not found' : 'They can’t send email broadcasts' });
  } else if (readyDomain || okBox) out.push({ level: 'good', icon: <Mail />, title: 'Email sender ready', note: [...p.channels.domains.filter((d) => d.identity === 'VERIFIED').map((d) => d.domain), ...p.channels.mailboxes.filter((m) => m.status === 'ACTIVE').map((m) => m.email)].join(', ') });

  const e = p.usage.week.email;
  if (e.total > 20 && e.bounced / e.total > 0.05) out.push({ level: 'bad', icon: <AlertTriangle />, title: `${Math.round((e.bounced / e.total) * 100)}% of emails bounced this week`, note: 'A bad address list; it risks the sending domain' });
  const failed = p.usage.week.email.failed + p.usage.week.whatsapp.failed;
  if (failed > 0) out.push({ level: failed > 20 ? 'bad' : 'warn', icon: <AlertTriangle />, title: `${n(failed)} ${failed === 1 ? 'message' : 'messages'} failed this week`, note: p.usage.topErrors[0]?.error });
  if (pl.monthlyQuota && p.usage.emailsThisMonth / pl.monthlyQuota >= 0.9) out.push({ level: 'warn', icon: <Mail />, title: `${n(p.usage.emailsThisMonth)} of ${n(pl.monthlyQuota)} emails used this month` });

  const order: Record<Level, number> = { bad: 0, warn: 1, off: 2, good: 3 };
  return out.sort((x, y) => order[x.level] - order[y.level]);
}

const LEVEL: Record<Level, { ring: string; icon: string; dot: ReactNode }> = {
  bad: { ring: 'border-[#f5c2c8] bg-danger-soft', icon: 'text-danger', dot: <XCircle className="h-4 w-4 text-danger" /> },
  warn: { ring: 'border-[#f3d3b0] bg-warm-soft', icon: 'text-warm', dot: <AlertTriangle className="h-4 w-4 text-warm" /> },
  off: { ring: 'border-line bg-sunken', icon: 'text-faint', dot: <MinusCircle className="h-4 w-4 text-faint" /> },
  good: { ring: 'border-line-soft bg-surface', icon: 'text-success', dot: <CheckCircle2 className="h-4 w-4 text-success" /> },
};

function SignalList({ list }: { list: Signal[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {list.map((s, i) => (
        <li key={i} className={cn('flex items-start gap-2.5 rounded-[12px] border px-3 py-2', LEVEL[s.level].ring)}>
          <span className={cn('mt-0.5 shrink-0 [&>svg]:h-4 [&>svg]:w-4', LEVEL[s.level].icon)}>{s.icon}</span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[13px] font-semibold leading-snug">{s.title}</span>
            {s.note && <span className="break-words text-[12px] leading-snug text-muted">{s.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, children, aside }: { title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="flex items-center justify-between text-[12.5px] font-bold text-muted">
        {title}
        {aside}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-[13px]">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 text-right font-medium text-ink">{children}</span>
    </div>
  );
}

/** A usage meter: used of allowed, turning orange then red as it fills. */
function Meter({ label, used, limit, note }: { label: string; used: number; limit: number | null; note?: string }) {
  const ratio = limit ? Math.min(1, used / limit) : 0;
  const tone = ratio >= 1 ? 'bg-danger' : ratio >= 0.85 ? 'bg-highlight' : 'bg-accent';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="tnum text-muted">
          <b className="font-semibold text-ink">{n(used)}</b>
          {limit ? ` / ${n(limit)}` : ''}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line-soft">
        <div className={cn('h-full rounded-full transition-[width] duration-700', tone)} style={{ width: `${limit ? Math.max(2, ratio * 100) : 0}%` }} />
      </div>
      {note && <span className="text-[11.5px] text-faint">{note}</span>}
    </div>
  );
}

function deviceIcon(d: string) {
  return /Android|iPhone/.test(d) ? <Smartphone className="h-3.5 w-3.5" /> : /Mac|Windows|Linux/.test(d) ? <Laptop className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />;
}

const VERIFY = (s: 'PENDING' | 'VERIFIED' | 'FAILED') =>
  s === 'VERIFIED' ? <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-label="Verified" /> : s === 'FAILED' ? <XCircle className="h-3.5 w-3.5 text-danger" aria-label="Failed" /> : <Circle className="h-3.5 w-3.5 text-faint" aria-label="Pending" />;

type Tab = 'overview' | 'people' | 'sending' | 'money' | 'activity';

/**
 * The agency behind a request, everything customer care needs on one panel.
 * `ticket` adds the person who asked and where they were.
 */
export function AgencyPanel({ id, ticket, wide }: { id: string; ticket?: CareTicket; wide?: boolean }) {
  const q = useAgencyProfile(id);
  const [tab, setTab] = useState<Tab>('overview');
  if (q.isPending)
    return (
      <div className="flex flex-col gap-3 p-5">
        <Skeleton className="h-20 rounded-[16px]" />
        <Skeleton className="h-44 rounded-[16px]" />
        <Skeleton className="h-32 rounded-[16px]" />
      </div>
    );
  if (!q.data) return <p className="p-5 text-sm text-muted">{nb("Couldn’t load this agency.")}</p>;
  const p = q.data;
  const sig = signals(p);
  const bad = sig.filter((s) => s.level === 'bad').length;
  const requester = ticket?.requester ? p.people.find((x) => x.id === ticket.requester!.id) : undefined;

  return (
    <div className="flex flex-col">
      {/* Agency header */}
      <div className="relative overflow-hidden bg-[linear-gradient(135deg,#1d1a4d,#2e2580_60%,#4a3fd1)] px-5 pb-4 pt-5 text-white">
        <svg aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 opacity-20" viewBox="0 0 100 100">
          {[18, 30, 42].map((r) => (
            <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="white" strokeWidth="1" />
          ))}
        </svg>
        <div className="relative flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-white/12 ring-1 ring-white/20">
            <Building2 className="h-5 w-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <span className="truncate text-[17px] font-bold">{p.agency.name}</span>
              {p.plan.features.prioritySupport && p.plan.source === 'paid' && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-highlight px-2 py-0.5 text-[10.5px] font-bold">
                  <Crown className="h-3 w-3" /> Priority
                </span>
              )}
            </span>
            <span className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-white/70">
              <span>
                {nb("Agency ID")} <b className="font-semibold text-white">{p.agency.loginCode}</b>
              </span>
              <span>· {businessLabel(p.agency.businessType)}</span>
              <span>· with us since {date(p.agency.createdAt, { month: 'short', year: 'numeric' })}</span>
            </span>
          </div>
          {!wide && (
            <Link to={`/care/agencies/${p.agency.id}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white" aria-label="Open the full agency page">
              <ExternalLink className="h-4 w-4" />
            </Link>
          )}
        </div>
        <div className="relative mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            { k: p.plan.name, v: 'Plan' },
            { k: `${p.people.filter((x) => !x.disabled).length}`, v: 'Logins' },
            { k: n(p.usage.contacts.total), v: 'Customers' },
          ].map((x) => (
            <span key={x.v} className="flex min-w-0 flex-col rounded-[12px] bg-white/10 px-2 py-2">
              <span className="truncate text-[14px] font-bold">{x.k}</span>
              <span className="text-[11px] text-white/65">{x.v}</span>
            </span>
          ))}
        </div>
      </div>

      <div role="tablist" aria-label="Agency details" className="sticky top-0 z-[1] flex gap-1 overflow-x-auto border-b border-line-soft bg-surface/95 px-4 py-2.5 backdrop-blur">
        {(
          [
            ['overview', 'Overview'],
            ['people', 'People'],
            ['sending', 'Sending'],
            ['money', 'Money'],
            ['activity', 'Activity'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={tab === v}
            onClick={() => setTab(v)}
            className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold transition-colors', tab === v ? 'bg-ink text-white' : 'text-muted hover:bg-hover hover:text-ink')}
          >
            {label}
            {v === 'overview' && bad > 0 && <span className="tnum grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] text-white">{bad}</span>}
          </button>
        ))}
      </div>

      <div className={cn('flex flex-col gap-6 px-5 py-5', wide && 'lg:grid lg:grid-cols-2 lg:gap-8')}>
        {tab === 'overview' && (
          <>
            {ticket?.requester && (
              <Section title="Who asked">
                <div className="flex flex-col gap-2 rounded-[16px] border border-line bg-sunken p-3.5">
                  <div className="flex items-center gap-3">
                    <Avatar name={ticket.requester.name} email={ticket.requester.email} size={38} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[14px] font-semibold">{ticket.requester.name}</span>
                      <span className="truncate text-[12px] text-muted">
                        {ROLE[ticket.requester.role]} · {ticket.requester.email ?? `@${ticket.requester.username}`}
                      </span>
                    </span>
                    {ticket.requester.email && <CopyButton value={ticket.requester.email} label="Copy email" />}
                  </div>
                  <div className="divide-y divide-line-soft">
                    {ticket.ticket.context.page && (
                      <Row label="Was on">
                        <code className="rounded bg-surface px-1.5 py-0.5 text-[12px]">{ticket.ticket.context.page}</code>
                      </Row>
                    )}
                    <Row label="Using">{ticket.ticket.device}</Row>
                    {ticket.ticket.context.screen && <Row label="Screen">{ticket.ticket.context.screen}</Row>}
                    <Row label="Last signed in">{ticket.requester.lastLoginAt ? ago(ticket.requester.lastLoginAt) : 'Never'}</Row>
                    {requester && <Row label="Signed in on">{`${requester.signedInOn} ${requester.signedInOn === 1 ? 'device' : 'devices'}`}</Row>}
                    {ticket.requester.disabled && <Row label="Login">{<Badge tone="red">Switched off by the owner</Badge>}</Row>}
                  </div>
                </div>
              </Section>
            )}
            <Section title="Right now" aside={bad ? <Badge tone="red">{bad} to look at</Badge> : <Badge tone="green">All fine</Badge>}>
              <SignalList list={sig} />
            </Section>
            <Section title="Contact">
              <div className="divide-y divide-line-soft">
                <Row label="Owner">{p.agency.owner?.name ?? '—'}</Row>
                {p.agency.owner?.email && (
                  <Row label="Email">
                    <a href={`mailto:${p.agency.owner.email}`} className="text-accent hover:underline">
                      {p.agency.owner.email}
                    </a>
                  </Row>
                )}
                {p.channels.whatsapp?.phone && <Row label="WhatsApp number">{phone(p.channels.whatsapp.phone)}</Row>}
                {p.agency.postalAddress && <Row label="Address">{p.agency.postalAddress}</Row>}
                <Row label="Time zone">{p.agency.timezone}</Row>
              </div>
            </Section>
            {p.tickets.length > 1 && (
              <Section title={`Their requests (${p.tickets.length})`}>
                <ul className="flex flex-col gap-1">
                  {p.tickets.map((t) => (
                    <li key={t.id}>
                      <Link to={`/care/t/${t.id}`} className={cn('flex items-center gap-2 rounded-[10px] px-2 py-1.5 text-[13px] hover:bg-hover', ticket?.ticket.id === t.id && 'bg-accent-soft')}>
                        <span className="tnum w-10 shrink-0 text-faint">{t.number}</span>
                        <span className="min-w-0 flex-1 truncate">{t.subject}</span>
                        <Badge tone={CARE_STATUS[t.status].tone}>{CARE_STATUS[t.status].label}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </>
        )}

        {tab === 'people' && (
          <Section title={`${p.people.length} ${p.people.length === 1 ? 'login' : 'logins'} · plan allows ${p.plan.seats} employees`}>
            <ul className="flex flex-col gap-2">
              {p.people.map((u) => (
                <li key={u.id} className={cn('flex flex-col gap-2 rounded-[14px] border p-3', u.id === ticket?.requester?.id ? 'border-accent/50 bg-accent-soft/40' : 'border-line')}>
                  <div className="flex items-center gap-3">
                    <Avatar name={u.name} email={u.email} size={34} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-1.5 truncate text-[13.5px] font-semibold">
                        {u.name}
                        {u.id === ticket?.requester?.id && <Badge tone="blue">Asked this</Badge>}
                      </span>
                      <span className="truncate text-[12px] text-muted">
                        {ROLE[u.role]} · {u.email ?? `@${u.username}`}
                      </span>
                    </span>
                    {u.disabled ? <Badge tone="red">Off</Badge> : u.lastSeenAt && Date.now() - new Date(u.lastSeenAt).getTime() < 15 * 60_000 ? <Badge tone="green" dot>Online</Badge> : null}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
                    <span>Last sign-in {u.lastLoginAt ? ago(u.lastLoginAt) : 'never'}</span>
                    <span>· Added {date(u.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  </div>
                  {u.devices.length > 0 && (
                    <ul className="flex flex-col gap-1">
                      {u.devices.map((d, i) => (
                        <li key={i} className="flex items-center gap-2 rounded-[8px] bg-sunken px-2 py-1 text-[12px] text-ink-2">
                          {deviceIcon(d.device)}
                          <span className="min-w-0 flex-1 truncate">{d.device}</span>
                          <span className="text-faint">{ago(d.lastSeenAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {tab === 'sending' && (
          <>
            <Section title="Usage">
              <div className="flex flex-col gap-3.5 rounded-[16px] border border-line p-4">
                <Meter label="Emails this month" used={p.usage.emailsThisMonth} limit={p.plan.monthlyQuota} />
                <Meter label="Emails, last 24 hours" used={p.usage.emailsLast24h} limit={p.usage.emailsPerDay} note={p.usage.emailsPerDay ? undefined : 'No daily limit on this plan'} />
                <Meter label="WhatsApp, last 24 hours" used={p.usage.whatsappLast24h} limit={p.usage.whatsappPerDay} />
              </div>
            </Section>
            <Section title="Last 7 days">
              <div className="grid grid-cols-2 gap-2">
                {(['email', 'whatsapp'] as const).map((ch) => {
                  const w = p.usage.week[ch];
                  return (
                    <div key={ch} className="flex flex-col gap-1.5 rounded-[14px] border border-line p-3">
                      <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                        {ch === 'email' ? <Mail className="h-3.5 w-3.5 text-accent" /> : <MessageCircle className="h-3.5 w-3.5 text-success" />}
                        {ch === 'email' ? 'Email' : 'WhatsApp'}
                      </span>
                      <span className="tnum text-[22px] font-extrabold leading-none">{n(w.total)}</span>
                      <span className="tnum text-[11.5px] leading-snug text-muted">
                        {n(w.delivered)} delivered · {n(w.queued)} waiting
                        {w.failed + w.bounced > 0 && <b className="font-semibold text-danger"> · {n(w.failed + w.bounced)} failed</b>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Section>
            {p.usage.topErrors.length > 0 && (
              <Section title="Why messages failed">
                <ul className="flex flex-col gap-1.5">
                  {p.usage.topErrors.map((e, i) => (
                    <li key={i} className="flex gap-2.5 rounded-[12px] bg-danger-soft/60 px-3 py-2 text-[12.5px]">
                      <span className="tnum shrink-0 font-bold text-danger">{n(e.n)}×</span>
                      <span className="min-w-0 break-words text-ink-2">
                        <b className="font-semibold">{e.channel === 'EMAIL' ? 'Email' : 'WhatsApp'}:</b> {e.error}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            <Section title="Sending from">
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {p.channels.whatsapp && (
                  <li className="flex items-center gap-2 rounded-[10px] border border-line px-3 py-2">
                    <MessageCircle className="h-4 w-4 text-success" />
                    <span className="min-w-0 flex-1 truncate">{p.channels.whatsapp.phone ? phone(p.channels.whatsapp.phone) : 'WhatsApp'}</span>
                    <Badge tone={p.channels.whatsapp.status === 'CONNECTED' ? 'green' : p.channels.whatsapp.status === 'DISCONNECTED' ? 'grey' : 'red'}>{p.channels.whatsapp.status.toLowerCase().replace('_', ' ')}</Badge>
                  </li>
                )}
                {p.channels.domains.map((d) => (
                  <li key={d.id} className="flex flex-col gap-1.5 rounded-[10px] border border-line px-3 py-2">
                    <span className="flex items-center gap-2">
                      <Globe className="h-4 w-4 text-accent" />
                      <span className="min-w-0 flex-1 truncate font-medium">{d.domain}</span>
                      {d.lastCheckedAt && <span className="text-[11.5px] text-faint">checked {ago(d.lastCheckedAt)}</span>}
                    </span>
                    <span className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
                      {(
                        [
                          ['Owner', d.ownership],
                          ['Amazon', d.identity],
                          ['DKIM', d.dkim],
                          ['Mail from', d.mailFrom],
                        ] as const
                      ).map(([k, v]) => (
                        <span key={k} className="inline-flex items-center gap-1">
                          {VERIFY(v)} {k}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
                {p.channels.mailboxes.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 rounded-[10px] border border-line px-3 py-2">
                    <Mail className="h-4 w-4 text-blue-ink" />
                    <span className="min-w-0 flex-1 truncate">{m.email}</span>
                    <Badge tone={m.status === 'ACTIVE' ? 'green' : 'red'}>{m.provider === 'GOOGLE' ? 'Gmail' : 'Outlook'}</Badge>
                  </li>
                ))}
                {!p.channels.whatsapp && !p.channels.domains.length && !p.channels.mailboxes.length && <li className="text-muted">Nothing set up yet.</li>}
              </ul>
            </Section>
            <Section title="Recent broadcasts">
              {p.campaigns.length === 0 ? (
                <p className="text-[13px] text-muted">None sent yet.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {p.campaigns.map((c) => (
                    <li key={c.id} className="flex flex-col gap-1 rounded-[12px] border border-line px-3 py-2">
                      <span className="flex items-center gap-2 text-[13px]">
                        {c.channel === 'EMAIL' ? <Mail className="h-3.5 w-3.5 shrink-0 text-accent" /> : <MessageCircle className="h-3.5 w-3.5 shrink-0 text-success" />}
                        <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                        <Badge tone={c.status === 'SENT' ? 'green' : c.status === 'FAILED' || c.status === 'CANCELLED' ? 'red' : c.status === 'SENDING' ? 'blue' : 'grey'}>{c.status.toLowerCase()}</Badge>
                      </span>
                      <span className="tnum text-[11.5px] text-muted">
                        {n(c.sent)} of {n(c.recipients)} sent · {n(c.delivered)} delivered{c.failed + c.bounced > 0 ? ` · ${n(c.failed + c.bounced)} failed` : ''} · {date(c.startedAt ?? c.createdAt)}
                      </span>
                      {c.lastError && <span className="text-[11.5px] text-danger">{c.lastError}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title={txFor(p.agency.businessType, "Their customers and trips")}>
              <div className="grid grid-cols-2 gap-2 text-[12.5px]">
                <div className="flex items-center gap-2 rounded-[12px] border border-line p-3">
                  <Users className="h-4 w-4 text-blue-ink" />
                  <span className="tnum">
                    <b className="font-semibold">{n(p.usage.contacts.total)}</b> customers, {n(p.usage.contacts.whatsappOk)} on WhatsApp
                  </span>
                </div>
                <div className="flex items-center gap-2 rounded-[12px] border border-line p-3">
                  <Plane className="h-4 w-4 text-plum-ink" />
                  <span className="tnum">
                    <b className="font-semibold">{n(p.usage.trips.total)}</b> {txFor(p.agency.businessType, 'trips')}, {n(p.usage.trips.booked)} booked
                  </span>
                </div>
              </div>
            </Section>
          </>
        )}

        {tab === 'money' && (
          <>
            <Section title="Plan">
              <div className="divide-y divide-line-soft rounded-[16px] border border-line px-4 py-1">
                <Row label="Plan">{p.plan.name}</Row>
                <Row label="Employee logins">{p.plan.seats}</Row>
                {p.plan.paidUntil && <Row label="Paid till">{date(p.plan.paidUntil, { day: 'numeric', month: 'short', year: 'numeric' })}</Row>}
                {p.plan.plan === 'TRIAL' && p.plan.trialEndsAt && <Row label="Trial ends">{date(p.plan.trialEndsAt, { day: 'numeric', month: 'short', year: 'numeric' })}</Row>}
                <Row label="Email limit">{n(p.plan.monthlyQuota)} a month</Row>
                <Row label="Includes">
                  {[p.plan.features.automations && 'Automatic messages', p.plan.features.groups && 'Groups', p.plan.features.ai && 'Drona AI', p.plan.features.leadApi && 'Leads API'].filter(Boolean).join(', ') || 'The basics'}
                </Row>
              </div>
            </Section>
            <Section title="Payments">
              {p.payments.length === 0 ? (
                <p className="text-[13px] text-muted">No online payments yet.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {p.payments.map((x) => (
                    <li key={x.id} className="flex items-center gap-3 rounded-[12px] border border-line px-3 py-2.5 text-[13px]">
                      <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-[10px]', x.status === 'PAID' ? 'bg-success-soft text-success' : x.status === 'FAILED' ? 'bg-danger-soft text-danger' : 'bg-line-soft text-muted')}>
                        <Receipt className="h-4 w-4" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-semibold">
                          {inr(x.amount)} <span className="font-normal text-muted">· {x.planId} · {x.seats} logins · {x.period === 'year' ? 'yearly' : 'monthly'}</span>
                        </span>
                        <span className="truncate text-[11.5px] text-muted">
                          {x.status === 'PAID' ? `Paid ${dateTime(x.paidAt)}` : x.status === 'FAILED' ? `Failed ${dateTime(x.createdAt)}` : `Started ${dateTime(x.createdAt)}, not paid`}
                          {x.razorpayPaymentId && ` · ${x.razorpayPaymentId}`}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}

        {tab === 'activity' && (
          <>
            {p.alerts.length > 0 && (
              <Section title="Alerts they got">
                <ul className="flex flex-col gap-1.5">
                  {p.alerts.map((a) => (
                    <li key={a.id} className="flex gap-2.5 rounded-[12px] border border-line px-3 py-2 text-[12.5px]">
                      {a.level === 'ERROR' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warm" />}
                      <span className="flex min-w-0 flex-col">
                        <span className="font-semibold">{a.title}</span>
                        {a.body && <span className="text-muted">{a.body}</span>}
                        <span className="text-[11px] text-faint">{ago(a.createdAt)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            <Section title="What they did lately">
              {p.activity.length === 0 ? (
                <p className="text-[13px] text-muted">Nothing recorded yet.</p>
              ) : (
                <ol className="relative flex flex-col gap-3 border-l-2 border-line-soft pl-4">
                  {p.activity.map((x) => (
                    <li key={x.id} className="relative text-[12.5px]">
                      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-accent ring-4 ring-surface" aria-hidden />
                      <span className="font-semibold">{txFor(p.agency.businessType, humanAction(x.action, x.meta))}</span>
                      <span className="text-muted">
                        {' '}
                        · {x.userName ?? 'Dhrona'} · {ago(x.createdAt)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

const ACTIONS: Record<string, string> = {
  'trip.create': 'Added an enquiry',
  'trip.update': 'Edited a trip',
  'trip.status': 'Moved a trip',
  'trip.delete': 'Deleted a trip',
  'trip.schedule': 'Set a payment schedule',
  'trip.payment': 'Recorded a payment',
  'trip.payment_void': 'Cancelled a payment',
  'trip.quote': 'Worked on a quote',
  'trip.reminder': 'Sent a payment reminder',
  'trip.followup': 'Sent a trip message',
  'trip.travellers': 'Changed travellers',
  'trip.ids_viewed': 'Viewed traveller IDs',
  'group.create': 'Made a group departure',
  'group.update': 'Edited a group departure',
  'group.booking': 'Booked seats on a group',
  'group.assign': 'Assigned a group booking',
  'group.broadcast': 'Messaged a group',
  'package.create': 'Made a package',
  'whatsapp.connect': 'Started linking WhatsApp',
  'whatsapp.disconnect': 'Unlinked WhatsApp',
  'account.update': nb('Changed agency details'),
  'payments.settings': 'Changed payment settings',
  'trips.messages_settings': 'Changed trip messages',
  'api_key.create': 'Made an API key',
  'api_key.revoke': 'Removed an API key',
  'ai.reply': 'Used Drona AI for a reply',
  'ai.draft': 'Used Drona AI for a quote',
  'billing.paid': 'Paid for the plan',
  'plan.paid': 'Plan set by the operator',
  'plan.set': 'Plan set by the operator',
  'plan.trial': 'Trial changed by the operator',
};

/** What an activity log entry means, in plain words. */
function humanAction(a: string, meta: unknown) {
  const m = (meta ?? {}) as Record<string, unknown>;
  if (a === 'trip.status' && m.to) return `Moved a trip to ${String(m.to).toLowerCase()}`;
  if (a === 'trip.payment' && m.amount) return `Recorded a payment of ${m.amount}`;
  if (a === 'trip.quote' && m.step) return `Quote ${m.step}${m.total ? `, ${m.total}` : ''}`;
  if (ACTIONS[a]) return ACTIONS[a];
  const s = a.replace(/[._]/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

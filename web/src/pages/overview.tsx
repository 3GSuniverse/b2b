import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  Inbox,
  Mail,
  Megaphone,
  MessageCircle,
  MessageSquarePlus,
  PlaneTakeoff,
  Repeat2,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { LinkButton } from '@/components/ui/button';
import { Badge, IconChip, Panel, PanelHeader, ProgressBar, RingGauge, Skeleton, type ChipTone } from '@/components/ui/display';
import { Tooltip as Tip } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ago, date, dateTime, inr, n, pct, until } from '@/lib/format';
import { CountPercent, CountUp, useMounted, useReducedMotion } from '@/lib/motion';
import type { Communication, MessageSource, Overview } from '@/lib/types';

/**
 * The Overview: everything Dhrona said to customers this month, how much of it happened on its
 * own, what it's doing right now, and what's coming up this week.
 */

// ---------------------------------------------------------------- Greeting

/** A small sun or moon beside the greeting: rays turn slowly by day, stars twinkle at night. */
function TimeEmblem() {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 18) {
    return (
      <svg aria-hidden viewBox="0 0 40 40" className="h-9 w-9 shrink-0">
        <g className="emblem-rays" style={{ transformOrigin: '20px 20px' }}>
          {Array.from({ length: 8 }, (_, i) => (
            <line key={i} x1="20" y1="3" x2="20" y2="8" stroke="var(--color-highlight)" strokeWidth="2.6" strokeLinecap="round" transform={`rotate(${i * 45} 20 20)`} />
          ))}
        </g>
        <circle cx="20" cy="20" r="8.5" fill="var(--color-highlight)" />
        <circle cx="17" cy="17.5" r="2.4" fill="#fff" fillOpacity=".55" />
      </svg>
    );
  }
  return (
    <svg aria-hidden viewBox="0 0 40 40" className="h-9 w-9 shrink-0">
      <path d="M26 30.5A12 12 0 1 1 22.5 7a10 10 0 0 0 3.5 23.5Z" fill="var(--color-accent)" />
      <path className="emblem-star" d="M31 8l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1Z" fill="var(--color-highlight)" />
      <path className="emblem-star [animation-delay:900ms]" d="M34 19l.7 1.5 1.5.7-1.5.7-.7 1.5-.7-1.5-1.5-.7 1.5-.7Z" fill="var(--color-highlight)" />
    </svg>
  );
}

// ---------------------------------------------------------------- This month

function Change({ value, suffix, invert }: { value: number | null; suffix: string; invert?: boolean }) {
  if (value === null) return <span className="text-[13px] text-muted">No data for last month yet</span>;
  if (value === 0) return <span className="text-[13px] text-muted">Same as last month</span>;
  const up = value > 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="text-[13px] text-muted">
      <span className={cn('tnum whitespace-nowrap font-medium', good ? 'text-success-strong' : 'text-warm-strong')}>
        <Icon className="mr-0.5 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
        {up ? '+' : ''}
        {value}
        {suffix}
      </span>{' '}
      vs last month
    </span>
  );
}

function Kpis({ c }: { c: Communication['thisMonth'] }) {
  const mounted = useMounted();
  const emailShare = c.sent ? (c.email / c.sent) * 100 : 50;
  const items: { label: string; icon: ReactNode; tone: ChipTone; value: ReactNode; note: ReactNode }[] = [
    {
      label: 'Messages sent',
      icon: <Send />,
      tone: 'indigo',
      value: <CountUp value={c.sent} />,
      note: (
        <span className="flex flex-col gap-1.5">
          <span className="flex h-1.5 overflow-hidden rounded-full bg-line-soft" aria-hidden>
            <span className="h-full bg-accent transition-[width] duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)]" style={{ width: mounted ? `${emailShare}%` : '0%' }} />
            <span className="h-full bg-success transition-[width] duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)] delay-150" style={{ width: mounted ? `${100 - emailShare}%` : '0%' }} />
          </span>
          <span className="tnum text-[13px] text-muted">
            {n(c.email)} by email, {n(c.whatsapp)} on WhatsApp
          </span>
          <Change value={c.sentChange} suffix="%" />
        </span>
      ),
    },
    {
      label: 'Sent automatically',
      icon: <Zap />,
      tone: 'saffron',
      value: <CountUp value={c.automatic} />,
      note: <span className="tnum text-[13px] text-muted">{c.automaticShare}% of all messages, with nobody at the desk</span>,
    },
    {
      label: 'Delivered',
      icon: <Inbox />,
      tone: 'green',
      value: <CountPercent value={c.deliveryRate} />,
      note: <span className="tnum text-[13px] text-muted">{n(c.delivered)} reached your customers</span>,
    },
    {
      label: 'Opened or read',
      icon: <Check />,
      tone: 'plum',
      value: <CountPercent value={c.openRate} />,
      note: <span className="tnum text-[13px] text-muted">{n(c.opened)} opened by email or read on WhatsApp</span>,
    },
  ];
  return (
    <Panel className="stagger grid grid-cols-2 overflow-hidden lg:grid-cols-4">
      {items.map((k, i) => (
        <div
          key={k.label}
          className={cn(
            'spotlight group/kpi flex flex-col gap-2.5 p-5 transition-colors duration-200 sm:p-6',
            i % 2 === 1 && 'border-l border-line-soft',
            i >= 2 && 'border-t border-line-soft lg:border-t-0',
            i === 2 && 'lg:border-l',
          )}
        >
          <span className="flex items-center gap-2.5 text-[13px] font-semibold text-muted">
            <IconChip icon={k.icon} tone={k.tone} className="transition-transform duration-300 ease-[cubic-bezier(0.22,1.4,0.36,1)] group-hover/kpi:-rotate-6 group-hover/kpi:scale-110" />
            {k.label}
          </span>
          <span className="tnum text-[30px] font-bold leading-none tracking-[-0.03em] sm:text-[34px]">{k.value}</span>
          {k.note}
        </div>
      ))}
    </Panel>
  );
}

// ---------------------------------------------------------------- 30 days, by what sent it

type Series = 'automatic' | 'broadcast' | 'direct';
const SERIES: Record<Series, { label: string; color: string }> = {
  automatic: { label: 'Automatic', color: 'var(--color-chart-1)' },
  broadcast: { label: 'Broadcasts', color: 'var(--color-chart-2)' },
  direct: { label: 'Sent by your team', color: '#b7b2f2' },
};
const ORDER: Series[] = ['automatic', 'broadcast', 'direct'];
type Day = Communication['last30Days'][number];
const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => date(d + 'T12:00:00Z', opts);

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: Day }[] }) {
  const p = active && payload?.[0]?.payload;
  if (!p) return null;
  return (
    <div className="min-w-48 rounded-[12px] border border-line bg-surface px-3.5 py-3 shadow-[var(--shadow-pop)]">
      <p className="text-xs font-semibold text-muted">{dayLabel(p.day, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
      <dl className="mt-2 flex flex-col gap-1.5 text-[13px]">
        {ORDER.map((k) => (
          <div key={k} className="flex items-center justify-between gap-6">
            <dt className="flex items-center gap-2 text-ink-2">
              <span className="h-2 w-2 rounded-[3px]" style={{ background: SERIES[k].color }} aria-hidden />
              {SERIES[k].label}
            </dt>
            <dd className="tnum font-semibold">{n(p[k])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function MessagesChart({ data }: { data: Day[] }) {
  const reduced = useReducedMotion();
  const [hidden, setHidden] = useState<Set<Series>>(new Set());
  const shown = ORDER.filter((k) => !hidden.has(k));
  const total = data.reduce((a, d) => a + shown.reduce((x, k) => x + d[k], 0), 0);
  const auto = data.reduce((a, d) => a + d.automatic, 0);
  const all = data.reduce((a, d) => a + d.automatic + d.broadcast + d.direct, 0);
  const empty = all === 0;
  const toggle = (k: Series) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(k)) next.delete(k);
      else if (shown.length > 1) next.add(k); // always keep one series on
      return next;
    });
  return (
    <Panel className="spotlight flex flex-col gap-5 p-5 sm:p-6">
      <PanelHeader
        title="Messages, last 30 days"
        description={
          empty ? (
            'Every message Dhrona sends shows up here, by what sent it.'
          ) : (
            <>
              <span className="tnum font-semibold text-ink">{n(total)}</span> messages shown, <span className="tnum font-semibold text-ink">{pct(all ? (auto / all) * 100 : 0)}</span> of them sent automatically
            </>
          )
        }
      />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Show or hide">
        {ORDER.map((k) => {
          const on = !hidden.has(k);
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(k)}
              className={cn(
                'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] font-semibold transition-all duration-200 active:scale-95',
                on ? 'border-line bg-surface text-ink' : 'border-dashed border-line bg-transparent text-faint',
              )}
            >
              <span className={cn('h-2.5 w-2.5 rounded-full transition-transform duration-300', on ? 'scale-100' : 'scale-50')} style={{ background: SERIES[k].color }} aria-hidden />
              {SERIES[k].label}
            </button>
          );
        })}
      </div>
      <div className="relative -ml-2 h-[240px] sm:h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="24%">
            <CartesianGrid vertical={false} stroke="var(--color-line-soft)" />
            <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: 'var(--color-line)' }} tick={{ fill: 'var(--color-muted)', fontSize: 12 }} tickFormatter={(d: string) => dayLabel(d)} interval={6} tickMargin={10} />
            <YAxis width={40} tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: 'var(--color-muted)', fontSize: 12 }} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-ink)', fillOpacity: 0.04, radius: 6 }} isAnimationActive={false} />
            {shown.map((k, i) => (
              <Bar
                key={k}
                dataKey={k}
                stackId="all"
                fill={SERIES[k].color}
                radius={i === shown.length - 1 ? [5, 5, 0, 0] : 0}
                isAnimationActive={!reduced}
                animationDuration={700}
                animationBegin={i * 160}
                animationEasing="ease-out"
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
        {empty && (
          <div className="absolute inset-0 grid place-items-center">
            <span className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13px] text-muted">Nothing sent in the last 30 days yet</span>
          </div>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- Working for you: the live feed

const SOURCE: Record<MessageSource, { icon: ReactNode; tone: ChipTone; label: string }> = {
  automation: { icon: <Repeat2 />, tone: 'indigo', label: 'Automation' },
  payment_reminder: { icon: <Wallet />, tone: 'saffron', label: 'Payment reminder' },
  trip_message: { icon: <PlaneTakeoff />, tone: 'blue', label: 'Trip message' },
  broadcast: { icon: <Megaphone />, tone: 'plum', label: 'Broadcast' },
  direct: { icon: <Send />, tone: 'green', label: 'Sent by your team' },
};

function deliveryLabel(a: Communication['activity'][number]) {
  if (['BOUNCED', 'COMPLAINED', 'FAILED'].includes(a.status)) return { text: 'Didn’t arrive', cls: 'text-danger' };
  if (a.opened) return { text: a.channel === 'WHATSAPP' ? 'Read' : 'Opened', cls: 'text-success-strong' };
  if (a.status === 'DELIVERED') return { text: 'Delivered', cls: 'text-ink-2' };
  return { text: 'Sent', cls: 'text-muted' };
}

function WorkingForYou({ items }: { items: Communication['activity'] }) {
  return (
    <Panel className="spotlight flex flex-col">
      <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="dispatch-live absolute inset-0 rounded-full bg-success" />
              <span className="relative h-2 w-2 rounded-full bg-success" />
            </span>
            Working for you
          </h2>
          <p className="text-[13px] text-muted">The latest messages Dhrona sent, newest first.</p>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="px-6 pb-8 pt-2 text-sm leading-relaxed text-muted">
          Nothing sent yet. Payment reminders, pre-trip details and birthday wishes appear here as Dhrona sends them.
        </p>
      ) : (
        <ol className="stagger flex flex-col px-2 pb-2 sm:px-3 sm:pb-3">
          {items.map((a) => {
            const s = SOURCE[a.source];
            const d = deliveryLabel(a);
            const body = (
              <>
                <IconChip icon={s.icon} tone={s.tone} className="feed-chip" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-semibold">{a.title}</span>
                  <span className="truncate text-xs text-muted">
                    To {a.to}
                    {a.trip?.title ? `, ${a.trip.title}` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className={cn('flex items-center gap-1 text-xs font-semibold', d.cls)}>
                    {a.channel === 'WHATSAPP' ? <MessageCircle className="h-3 w-3" aria-label="WhatsApp" /> : <Mail className="h-3 w-3" aria-label="Email" />}
                    {d.text}
                  </span>
                  <span className="text-[11px] text-faint">{ago(a.at)}</span>
                </span>
              </>
            );
            const cls = 'group flex items-center gap-3 rounded-[12px] px-3 py-2.5 transition-colors duration-200';
            return (
              <li key={a.id}>
                {a.trip ? (
                  <Link to={`/trips/${a.trip.id}`} className={cn(cls, 'hover:bg-hover')}>
                    {body}
                  </Link>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- This week

function Countdown({ at }: { at: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const u = until(at);
  if (u.past) return <span className="text-sm font-semibold text-accent-strong">Starting now</span>;
  const parts = u.d > 0 ? [[u.d, 'days'], [u.h, 'hours'], [u.m, 'min']] : [[u.h, 'hours'], [u.m, 'min'], [u.s, 'sec']];
  return (
    <div className="flex items-end gap-4" aria-label={`Sends in ${parts.map(([v, l]) => `${v} ${l}`).join(' ')}`}>
      {parts.map(([v, l]) => (
        <div key={l} className="flex items-baseline gap-1.5">
          <span className="tnum inline-flex overflow-hidden text-[34px] font-semibold leading-none tracking-[-0.03em]">
            <span key={v} className="animate-[tick-in_420ms_cubic-bezier(0.22,1.2,0.36,1)]">{v}</span>
          </span>
          <span className="text-[13px] text-muted">{l}</span>
        </div>
      ))}
    </div>
  );
}

function ComingUp({ o }: { o: Overview }) {
  const c = o.communication.comingUp;
  const rows: { key: string; icon: ReactNode; tone: ChipTone; title: ReactNode; note: string; to: string }[] = [];
  if (c.overdue > 0)
    rows.push({ key: 'overdue', icon: <AlertCircle />, tone: 'red', title: <>{inr(c.overdue)} overdue on {c.overdueTrips} {c.overdueTrips === 1 ? 'trip' : 'trips'}</>, note: 'Overdue reminders go out on their own', to: '/trips' });
  if (c.dueThisWeek > 0) rows.push({ key: 'due', icon: <Wallet />, tone: 'saffron', title: <>{inr(c.dueThisWeek)} due this week</>, note: 'Customers get a reminder before each due date', to: '/trips' });
  if (c.departingThisWeek > 0)
    rows.push({ key: 'leaving', icon: <PlaneTakeoff />, tone: 'blue', title: <>{c.departingThisWeek} {c.departingThisWeek === 1 ? 'trip leaves' : 'trips leave'} this week</>, note: 'Pre-trip details are sent automatically', to: '/trips' });
  if (c.newEnquiries > 0)
    rows.push({ key: 'enquiries', icon: <MessageSquarePlus />, tone: 'indigo', title: <>{c.newEnquiries} {c.newEnquiries === 1 ? 'enquiry is' : 'enquiries are'} waiting for a quote</>, note: 'Draft one in minutes from your price list', to: '/trips' });
  return (
    <Panel className="spotlight flex flex-col gap-4 p-5 sm:p-6">
      <PanelHeader title="This week" action={<Clock3 className="h-[18px] w-[18px] text-muted" aria-hidden />} />
      {o.upcoming && (
        <Link to={`/campaigns/${o.upcoming.id}/edit`} className="lift group flex flex-col gap-3 rounded-[14px] border border-line-soft bg-sunken p-4 hover:border-line">
          <span className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-muted">
              <Megaphone className="h-4 w-4 shrink-0 text-highlight" aria-hidden />
              <span className="truncate">Next broadcast: {o.upcoming.name}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
          <Countdown at={o.upcoming.scheduledAt} />
          <span className="tnum text-xs text-muted">
            {dateTime(o.upcoming.scheduledAt)}, {n(o.upcoming.recipients)} recipients
          </span>
        </Link>
      )}
      {rows.length ? (
        <ul className="stagger flex flex-col gap-1">
          {rows.map((r) => (
            <li key={r.key}>
              <Link to={r.to} className="group flex items-center gap-3 rounded-[12px] px-2 py-2 transition-colors duration-200 hover:bg-hover">
                <IconChip icon={r.icon} tone={r.tone} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="tnum text-[13px] font-semibold">{r.title}</span>
                  <span className="text-xs text-muted">{r.note}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-faint opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        !o.upcoming && <p className="text-sm leading-relaxed text-muted">A quiet week. Nothing is due and no trips leave in the next seven days.</p>
      )}
    </Panel>
  );
}

function AiCard({ drafts }: { drafts: number }) {
  const ai = useQuery({ queryKey: ['ai'], queryFn: () => api.get<{ enabled: boolean }>('/api/ai'), staleTime: 300_000 });
  if (!ai.data?.enabled) return null;
  return (
    <Panel className="spotlight relative flex flex-col gap-3 overflow-hidden p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="ai-orb grid h-10 w-10 place-items-center rounded-[12px] bg-accent text-white">
          <Sparkles className="ai-sparkle h-5 w-5" aria-hidden />
        </span>
        <div className="flex flex-col">
          <h2 className="text-[15px] font-semibold tracking-tight">Dhrona AI</h2>
          <span className="tnum text-[13px] text-muted">
            <CountUp value={drafts} /> {drafts === 1 ? 'quote' : 'quotes'} drafted this month
          </span>
        </div>
      </div>
      <p className="text-[13px] leading-relaxed text-ink-2">
        Open any enquiry and choose <strong className="font-semibold">Draft with AI</strong>. Dhrona writes the day-by-day plan in English, Telugu or Hindi, priced from your own rates.
      </p>
      <LinkButton to="/trips" size="sm" className="self-start">
        Open trips
      </LinkButton>
    </Panel>
  );
}

function Customers({ o }: { o: Overview }) {
  const a = o.audience;
  return (
    <Panel className="spotlight flex flex-col gap-5 p-5 sm:p-6">
      <PanelHeader title="Customers" action={<Link to="/contacts" className="text-[13px] font-semibold text-accent hover:text-accent-strong">View all</Link>} />
      <div className="flex items-baseline gap-2">
        <span className="tnum text-[34px] font-bold leading-none tracking-[-0.03em]">
          <CountUp value={a.total} />
        </span>
        <span className="text-[13px] text-muted">in your address book</span>
      </div>
      <dl className="grid grid-cols-2 gap-4 text-[13px]">
        <div className="flex flex-col gap-2">
          <dt className="flex items-center gap-1.5 text-muted">
            <Mail className="h-3.5 w-3.5" aria-hidden /> By email
          </dt>
          <dd className="tnum text-[18px] font-bold">{n(a.subscribed)}</dd>
          <ProgressBar value={a.subscribed} max={Math.max(a.total, 1)} label="Customers who can receive email" />
        </div>
        <div className="flex flex-col gap-2">
          <dt className="flex items-center gap-1.5 text-muted">
            <MessageCircle className="h-3.5 w-3.5" aria-hidden /> On WhatsApp
          </dt>
          <dd className="tnum text-[18px] font-bold">{n(o.whatsappReachable)}</dd>
          <ProgressBar value={o.whatsappReachable} max={Math.max(a.total, 1)} label="Customers who agreed to WhatsApp" tone="highlight" />
        </div>
      </dl>
    </Panel>
  );
}

function Health({ o }: { o: Overview }) {
  const h = o.health;
  const early = h.sample < 200;
  return (
    <Panel className="flex flex-col gap-5 p-5 sm:p-6">
      <PanelHeader
        title="Delivery health"
        action={
          early ? (
            <Badge tone="grey">Too early to tell</Badge>
          ) : h.status === 'good' ? (
            <Badge tone="green" dot>Healthy</Badge>
          ) : (
            <Badge tone="orange" dot>Needs attention</Badge>
          )
        }
      />
      <div className="grid grid-cols-2 gap-2">
        <Tip content={`Emails that couldn't be delivered. Sending pauses automatically at ${h.bounceLimit}% to protect your domain.`}>
          <div tabIndex={0} className="rounded-xl outline-offset-4">
            <RingGauge value={h.bounceRate} limit={h.bounceLimit} label="Bounces" display={pct(h.bounceRate)} sub={`limit ${h.bounceLimit}%`} />
          </div>
        </Tip>
        <Tip content={`People who marked an email as spam. Sending pauses automatically at ${h.complaintLimit}%.`}>
          <div tabIndex={0} className="rounded-xl outline-offset-4">
            <RingGauge value={h.complaintRate} limit={h.complaintLimit} label="Spam reports" display={pct(h.complaintRate, 2)} sub={`limit ${h.complaintLimit}%`} />
          </div>
        </Tip>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        {early
          ? `Based on ${n(h.sample)} emails so far. Rates become meaningful after about 200 sends.`
          : `Based on your last ${n(h.sample)} emails. Bounced and spam-reporting addresses are never emailed again.`}
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------- Setup checklist

function Setup({ o }: { o: Overview }) {
  const steps = [
    {
      done: o.sending.sendersReady > 0,
      title: 'Connect the address you send from',
      body: 'Verify your company domain, or connect a Gmail account in one click.',
      to: '/settings/senders',
      cta: 'Connect',
      icon: <Mail />,
    },
    {
      done: o.audience.total > 0,
      title: 'Bring in your customers',
      body: 'Upload a CSV or Excel export. Columns are matched for you.',
      to: '/contacts?import=1',
      cta: 'Import',
      icon: <Upload />,
    },
    {
      done: o.recentCampaigns.some((c) => c.status !== 'DRAFT'),
      title: 'Send your first message',
      body: 'Turn on trip reminders, or send a broadcast from a template.',
      to: '/campaigns/new',
      cta: 'Create',
      icon: <Send />,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  const nextIdx = steps.findIndex((s) => !s.done);

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold">Get ready to send</h2>
          <p className="text-[13px] text-muted">Three steps, about ten minutes.</p>
        </div>
        <div className="flex w-40 flex-col gap-1.5">
          <span className="tnum text-right text-xs font-medium text-muted">
            {doneCount} of {steps.length} done
          </span>
          <ProgressBar value={doneCount} max={steps.length} label="Setup progress" />
        </div>
      </div>
      <ol className="stagger grid md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className={cn('flex flex-col gap-3 p-5 sm:p-6', i > 0 && 'border-t border-line-soft md:border-l md:border-t-0', i === nextIdx && 'bg-accent-soft/40')}>
            <span
              className={cn(
                'grid h-8 w-8 place-items-center rounded-full text-[13px] font-semibold',
                s.done ? 'bg-success text-white' : i === nextIdx ? 'bg-primary text-on-primary' : 'bg-line-soft text-muted',
              )}
              aria-hidden
            >
              {s.done ? <Check className="animate-check h-4 w-4" strokeWidth={3} /> : i + 1}
            </span>
            <div className="flex flex-col gap-1">
              <h3 className={cn('text-sm font-semibold', s.done && 'text-muted line-through decoration-line')}>
                {s.title}
                {s.done && <span className="sr-only"> (done)</span>}
              </h3>
              <p className="text-[13px] leading-relaxed text-muted">{s.body}</p>
            </div>
            {!s.done && (
              <LinkButton to={s.to} size="sm" variant={i === nextIdx ? 'primary' : 'secondary'} className="mt-auto self-start">
                {s.cta}
              </LinkButton>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

// ---------------------------------------------------------------- Page

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy aria-label="Loading overview">
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-[132px] rounded-[var(--radius-panel)]" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-3">
        <Skeleton className="h-[380px] rounded-[var(--radius-panel)] lg:col-span-2" />
        <Skeleton className="h-[380px] rounded-[var(--radius-panel)]" />
      </div>
    </div>
  );
}

export function OverviewPage() {
  const q = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/api/overview'), refetchInterval: 60_000 });
  if (!q.data) return <OverviewSkeleton />;
  const o = q.data;
  const c = o.communication;
  const domainsPending = o.sending.domains.filter((d) => !d.readyToSend);

  return (
    <div className="stagger flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <TimeEmblem />
          <div className="flex flex-col gap-1">
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em]">{o.greeting}</h1>
            <p className="text-sm text-muted">
              {date(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })}.{' '}
              {c.thisMonth.automatic > 0 ? <>Dhrona has sent <span className="tnum font-semibold text-ink">{n(c.thisMonth.automatic)}</span> messages on its own this month.</> : 'Here is your agency today.'}
            </p>
          </div>
        </div>
        {o.sending.defaultSender && (
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-2">
            <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
            Sending as <span className="font-semibold text-ink">{o.sending.defaultSender}</span>
          </span>
        )}
      </header>

      {domainsPending.length > 0 && o.sending.sendersReady > 0 && (
        <Link to="/settings/domains" className="flex items-center gap-3 rounded-[14px] border border-[#f3c9a8] bg-warm-soft px-4 py-3 text-sm text-warm-strong hover:border-warm">
          <Clock3 className="h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1">
            <strong className="font-semibold">{domainsPending.map((d) => d.domain).join(', ')}</strong> is still waiting for DNS records. We check every few minutes.
          </span>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      )}

      <Setup o={o} />
      <Kpis c={c.thisMonth} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <MessagesChart data={c.last30Days} />
          <WorkingForYou items={c.activity} />
        </div>
        <div className="stagger flex flex-col gap-6">
          <ComingUp o={o} />
          <AiCard drafts={c.thisMonth.aiDrafts} />
          <Health o={o} />
          <Customers o={o} />
        </div>
      </div>
    </div>
  );
}

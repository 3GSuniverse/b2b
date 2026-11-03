import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Check, ChevronRight, Clock3, Mail, Send, ShieldCheck, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { LinkButton } from '@/components/ui/button';
import { Segmented } from '@/components/ui/controls';
import { Badge, Panel, PanelHeader, ProgressBar, RingGauge, Skeleton } from '@/components/ui/display';
import { Tooltip as Tip } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { date, dateTime, n, pct, until } from '@/lib/format';
import { campaignHref, CampaignStatusBadge } from '@/lib/status';
import type { Overview } from '@/lib/types';

// ---------------------------------------------------------------- KPIs

function Change({ value, suffix, invert }: { value: number | null; suffix: string; invert?: boolean }) {
  if (value === null) return <span className="text-[13px] text-muted">No data for last month yet</span>;
  if (value === 0) return <span className="text-[13px] text-muted">Same as last month</span>;
  const up = value > 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="text-[13px] text-muted">
      <span className={cn('tnum whitespace-nowrap font-medium', good ? 'text-accent-strong' : 'text-warm-strong')}>
        <Icon className="mr-0.5 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
        {up ? '+' : ''}
        {value}
        {suffix}
      </span>{' '}
      vs last month
    </span>
  );
}

function Kpis({ o }: { o: Overview }) {
  const m = o.thisMonth;
  const items = [
    { label: 'Emails sent', value: n(m.sent), note: <Change value={m.sentChange} suffix="%" /> },
    { label: 'Delivered', value: pct(m.deliveryRate), note: <span className="tnum text-[13px] text-muted">{n(m.delivered)} reached the inbox</span> },
    { label: 'Click rate', value: pct(m.clickRate), note: <Change value={m.clickRateChange} suffix=" pts" /> },
    { label: 'Unsubscribed', value: n(m.unsubscribed), note: <span className="tnum text-[13px] text-muted">{pct(m.unsubscribeRate)} of delivered</span> },
  ];
  return (
    <Panel className="grid grid-cols-2 lg:grid-cols-4">
      {items.map((k, i) => (
        <div
          key={k.label}
          className={cn(
            'flex flex-col gap-2.5 p-5 sm:p-6',
            i % 2 === 1 && 'border-l border-line-soft',
            i >= 2 && 'border-t border-line-soft lg:border-t-0',
            i === 2 && 'lg:border-l',
          )}
        >
          <span className="text-[13px] font-medium text-muted">{k.label}</span>
          <span className="tnum text-[30px] font-semibold leading-none tracking-[-0.03em] sm:text-[34px]">{k.value}</span>
          {k.note}
        </div>
      ))}
    </Panel>
  );
}

// ---------------------------------------------------------------- 30-day chart

type Metric = 'delivered' | 'clicked';
const METRIC: Record<Metric, { label: string; noun: string; color: string }> = {
  delivered: { label: 'Delivered', noun: 'emails delivered', color: 'var(--color-chart-1)' },
  clicked: { label: 'Clicks', noun: 'clicks', color: 'var(--color-chart-2)' },
};

type Point = Overview['last30Days'][number];

const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => date(d + 'T12:00:00Z', opts);

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  const p = active && payload?.[0]?.payload;
  if (!p) return null;
  return (
    <div className="min-w-52 rounded-[12px] border border-line bg-surface px-3.5 py-3 shadow-[var(--shadow-pop)]">
      <p className="text-xs font-semibold text-muted">{dayLabel(p.day, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
      {p.campaigns.length > 0 && <p className="mt-1 text-[13px] font-semibold text-ink">{p.campaigns.map((c) => c.name).join(', ')}</p>}
      <dl className="mt-2 flex flex-col gap-1.5 text-[13px]">
        {(
          [
            ['Sent', p.sent, 'var(--color-faint)'],
            ['Delivered', p.delivered, METRIC.delivered.color],
            ['Clicks', p.clicked, METRIC.clicked.color],
          ] as const
        ).map(([label, v, color]) => (
          <div key={label} className="flex items-center justify-between gap-6">
            <dt className="flex items-center gap-2 text-ink-2">
              <span className="h-2 w-2 rounded-[3px]" style={{ background: color }} aria-hidden />
              {label}
            </dt>
            <dd className="tnum font-semibold">{n(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ActivityChart({ o }: { o: Overview }) {
  const [metric, setMetric] = useState<Metric>('delivered');
  const [active, setActive] = useState<number | null>(null);
  const data = o.last30Days;
  const total = data.reduce((a, d) => a + d[metric], 0);
  const peakIdx = data.reduce((best, d, i) => (d[metric] > (data[best]?.[metric] ?? 0) ? i : best), 0);
  const peak = data[peakIdx];
  const color = METRIC[metric].color;
  const empty = data.every((d) => d.sent === 0);

  return (
    <Panel className="flex flex-col gap-5 p-5 sm:p-6">
      <PanelHeader
        title="Last 30 days"
        description={
          empty ? (
            'Daily activity shows up here once your first emails go out.'
          ) : (
            <>
              <span className="tnum font-semibold text-ink">{n(total)}</span> {METRIC[metric].noun}
              {peak && peak[metric] > 0 && <>, most on {dayLabel(peak.day)}</>}
            </>
          )
        }
        action={
          <Segmented
            label="Chart metric"
            size="sm"
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'delivered', label: 'Delivered' },
              { value: 'clicked', label: 'Clicks' },
            ]}
          />
        }
      />
      <div className="relative -ml-2 h-[260px] sm:h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 30, right: 8, bottom: 0, left: 0 }}
            barCategoryGap="22%"
            onMouseMove={(s) => setActive(typeof s?.activeTooltipIndex === 'number' ? s.activeTooltipIndex : s?.activeTooltipIndex != null ? Number(s.activeTooltipIndex) : null)}
            onMouseLeave={() => setActive(null)}
          >
            <CartesianGrid vertical={false} stroke="var(--color-line-soft)" />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={{ stroke: 'var(--color-line)' }}
              tick={{ fill: 'var(--color-muted)', fontSize: 12 }}
              tickFormatter={(d: string) => dayLabel(d)}
              interval={6}
              tickMargin={10}
            />
            <YAxis
              width={44}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              tick={{ fill: 'var(--color-muted)', fontSize: 12 }}
              tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-ink)', fillOpacity: 0.04, radius: 6 }} isAnimationActive={false} />
            <Bar
              dataKey={metric}
              animationDuration={500}
              shape={(props: unknown) => {
                const { x, y, width, height, index } = props as { x: number; y: number; width: number; height: number; index: number };
                const isPeak = index === peakIdx && !!peak && peak[metric] > 0;
                const name = isPeak ? peak.campaigns[0]?.name : undefined;
                const cx = x + width / 2;
                const anchor = index < 5 ? 'start' : index > data.length - 6 ? 'end' : 'middle';
                const lx = anchor === 'start' ? x : anchor === 'end' ? x + width : cx;
                const r = Math.min(4, width / 2, height);
                return (
                  <g>
                    {height > 0 && (
                      <path
                        d={`M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`}
                        fill={color}
                        fillOpacity={active === null || active === index ? 1 : 0.35}
                      />
                    )}
                    {isPeak && (
                      <text x={lx} y={y - 10} textAnchor={anchor} fontSize={12} fontWeight={600} fill="var(--color-ink)" pointerEvents="none">
                        {name ? (name.length > 26 ? name.slice(0, 25) + '…' : name) : n(peak[metric])}
                      </text>
                    )}
                  </g>
                );
              }}
            />
          </BarChart>
        </ResponsiveContainer>
        {empty && (
          <div className="absolute inset-0 grid place-items-center">
            <span className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13px] text-muted">No emails sent in the last 30 days</span>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>Emails per day, last 30 days</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Campaign</th>
            <th>Sent</th>
            <th>Delivered</th>
            <th>Clicks</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>{d.campaigns.map((c) => c.name).join(', ')}</td>
              <td>{d.sent}</td>
              <td>{d.delivered}</td>
              <td>{d.clicked}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

// ---------------------------------------------------------------- Side column

function Countdown({ at }: { at: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const u = until(at);
  if (u.past) return <span className="text-sm font-semibold text-accent-strong">Starting now</span>;
  const parts = u.d > 0 ? [[u.d, 'days'], [u.h, 'hours']] : [[u.h, 'hours'], [u.m, 'min']];
  return (
    <div className="flex items-end gap-4" aria-label={`Sends in ${parts.map(([v, l]) => `${v} ${l}`).join(' ')}`}>
      {parts.map(([v, l]) => (
        <div key={l} className="flex items-baseline gap-1.5">
          <span className="tnum text-[34px] font-semibold leading-none tracking-[-0.03em]">{v}</span>
          <span className="text-[13px] text-muted">{l}</span>
        </div>
      ))}
    </div>
  );
}

function UpNext({ o }: { o: Overview }) {
  const u = o.upcoming;
  return (
    <Panel className="flex flex-col gap-4 p-5 sm:p-6">
      <PanelHeader title="Up next" action={<Clock3 className="h-[18px] w-[18px] text-muted" aria-hidden />} />
      {u ? (
        <>
          <Countdown at={u.scheduledAt} />
          <Link to={`/campaigns/${u.id}/edit`} className="group flex items-center gap-3 rounded-[12px] border border-line-soft bg-sunken px-3.5 py-3 hover:border-line">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-semibold">{u.name}</span>
              <span className="tnum text-xs text-muted">
                {dateTime(u.scheduledAt)}, {n(u.recipients)} recipients
              </span>
            </span>
            <ChevronRight className="h-4 w-4 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm leading-relaxed text-muted">Nothing scheduled. Plan a campaign and it will go out at the time you pick, even if nobody is online.</p>
          <LinkButton to="/campaigns/new" size="sm">
            Schedule a campaign
          </LinkButton>
        </div>
      )}
    </Panel>
  );
}

function Health({ o }: { o: Overview }) {
  const h = o.health;
  const early = h.sample < 200;
  return (
    <Panel className="flex flex-col gap-5 p-5 sm:p-6">
      <PanelHeader
        title="Sending health"
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

function Audience({ o }: { o: Overview }) {
  const a = o.audience;
  return (
    <Panel className="flex flex-col gap-5 p-5 sm:p-6">
      <PanelHeader title="Audience" action={<Link to="/contacts" className="text-[13px] font-semibold text-accent hover:text-accent-strong">View contacts</Link>} />
      <div className="flex items-baseline gap-2">
        <span className="tnum text-[34px] font-semibold leading-none tracking-[-0.03em]">{n(a.subscribed)}</span>
        <span className="text-[13px] text-muted">can receive email</span>
      </div>
      <ProgressBar value={a.subscribed} max={Math.max(a.total, 1)} label="Subscribed share of contacts" />
      <dl className="grid grid-cols-2 gap-3 text-[13px]">
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted">All contacts</dt>
          <dd className="tnum font-semibold">{n(a.total)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted">Unsubscribed or bounced</dt>
          <dd className="tnum font-semibold">{n(a.suppressed)}</dd>
        </div>
      </dl>
    </Panel>
  );
}

// ---------------------------------------------------------------- Recent campaigns

function RecentCampaigns({ o }: { o: Overview }) {
  return (
    <Panel className="flex flex-col">
      <PanelHeader
        className="px-5 pb-3 pt-5 sm:px-6 sm:pt-6"
        title="Recent campaigns"
        action={<Link to="/campaigns" className="text-[13px] font-semibold text-accent hover:text-accent-strong">All campaigns</Link>}
      />
      {o.recentCampaigns.length === 0 ? (
        <p className="px-6 pb-8 pt-2 text-sm text-muted">Your campaigns will be listed here.</p>
      ) : (
        <ul className="flex flex-col px-2 pb-2 sm:px-3 sm:pb-3">
          {o.recentCampaigns.map((c) => {
            const finished = c.status === 'SENT' || c.status === 'SENDING';
            return (
              <li key={c.id}>
                <Link to={campaignHref(c)} className="grid grid-cols-[minmax(0,1fr)] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-[12px] px-3 py-3 hover:bg-hover sm:grid-cols-[minmax(0,1fr)_120px_88px_88px]">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-semibold">{c.name}</span>
                    <span className="text-xs text-muted">
                      {c.status === 'SCHEDULED' && c.scheduledAt ? `Sends ${dateTime(c.scheduledAt)}` : c.startedAt ? `Sent ${date(c.startedAt)}` : `Edited ${date(c.updatedAt)}`}
                    </span>
                  </span>
                  <span className="justify-self-end sm:justify-self-start">
                    <CampaignStatusBadge status={c.status} />
                  </span>
                  <span className="hidden flex-col sm:flex">
                    <span className="tnum text-sm font-semibold">{finished ? pct(c.rates.delivery) : '—'}</span>
                    <span className="text-[11px] text-muted">delivered</span>
                  </span>
                  <span className="hidden flex-col sm:flex">
                    <span className="tnum text-sm font-semibold">{finished ? pct(c.rates.click) : '—'}</span>
                    <span className="text-[11px] text-muted">clicked</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
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
      title: 'Bring in your contacts',
      body: 'Upload a CSV or Excel export. Columns are matched for you.',
      to: '/contacts?import=1',
      cta: 'Import',
      icon: <Upload />,
    },
    {
      done: o.recentCampaigns.some((c) => c.status !== 'DRAFT'),
      title: 'Send your first campaign',
      body: 'Start from a template, send yourself a test, then schedule it.',
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
      <ol className="grid md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className={cn('flex flex-col gap-3 p-5 sm:p-6', i > 0 && 'border-t border-line-soft md:border-l md:border-t-0', i === nextIdx && 'bg-accent-soft/40')}>
            <span
              className={cn(
                'grid h-8 w-8 place-items-center rounded-full text-[13px] font-semibold',
                s.done ? 'bg-accent text-white' : i === nextIdx ? 'bg-ink text-white' : 'bg-line-soft text-muted',
              )}
              aria-hidden
            >
              {s.done ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
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
  const domainsPending = o.sending.domains.filter((d) => !d.readyToSend);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em]">{o.greeting}</h1>
          <p className="text-sm text-muted">
            {date(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        {o.sending.defaultSender && (
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-2">
            <ShieldCheck className="h-4 w-4 text-accent" aria-hidden />
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
      <Kpis o={o} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <ActivityChart o={o} />
          <RecentCampaigns o={o} />
        </div>
        <div className="flex flex-col gap-6">
          <UpNext o={o} />
          <Health o={o} />
          <Audience o={o} />
        </div>
      </div>
    </>
  );
}


import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  Globe,
  LayoutDashboard,
  Link2,
  Mail,
  Megaphone,
  MessageCircle,
  Plus,
  Send,
  Smartphone,
  TriangleAlert,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { Link, Navigate, NavLink, useParams, useSearchParams } from 'react-router-dom';
import { Segmented } from '@/components/ui/controls';
import { EmptyState, Panel, ProgressBar, Skeleton } from '@/components/ui/display';
import { useWhatsApp, WhatsAppSettings } from '@/components/whatsapp/settings';
import { api } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/cn';
import { dateTime, n, pct } from '@/lib/format';
import { CountUp, useMounted } from '@/lib/motion';
import { useSession } from '@/lib/session';
import type { Communication } from '@/lib/types';
import { AutomationsPage } from './automations';
import { CampaignsPage } from './campaigns';
import { WorkingForYou } from './overview';
import { Domains, Senders } from './settings';
import { TemplatesPage } from './templates';

/**
 * The two master tabs. Everything about email lives under Email, everything about WhatsApp
 * under WhatsApp: the numbers, sending to many, automatic messages, designs and setup, as
 * tabs in one place, so nobody has to hunt through the sidebar or Settings.
 */

type Channel = 'EMAIL' | 'WHATSAPP';
type Hub = {
  channel: Channel;
  thisMonth: {
    sent: number;
    sentChange: number | null;
    delivered: number;
    deliveryRate: number;
    opened: number;
    openRate: number;
    clicked: number;
    clickRate: number;
    failed: number;
    bySource: { broadcast: number; automatic: number; direct: number };
  };
  last14Days: { day: string; broadcast: number; automatic: number; direct: number }[];
  broadcasts: { drafts: number; scheduled: number; next: { id: string; name: string; scheduledAt: string } | null };
  automations: { on: number; off: number };
  reachable: number;
  email: { quota: { used: number; limit: number }; sendersReady: number; defaultSender: string | null } | null;
  activity: Communication['activity'];
};

const THEME = {
  EMAIL: {
    name: 'Email',
    icon: Mail,
    band: 'bg-[linear-gradient(120deg,#3b31b8_0%,#4A3FD1_45%,#7a6cf5_100%)]',
    solid: '#4A3FD1',
    soft: 'bg-accent-soft text-accent',
    pill: 'bg-accent-soft text-accent-strong',
    bar: 'bg-accent',
    blurb: 'Broadcasts, automatic emails, designs and your sending address, all in one place.',
  },
  WHATSAPP: {
    name: 'WhatsApp',
    icon: MessageCircle,
    band: 'bg-[linear-gradient(120deg,#07603f_0%,#0e9466_50%,#25c48a_100%)]',
    solid: '#0e9466',
    soft: 'bg-success-soft text-success',
    pill: 'bg-success-soft text-success-strong',
    bar: 'bg-success',
    blurb: 'Broadcasts, automatic messages and your linked number, all in one place.',
  },
} as const;

type TabDef = { id: string; label: string; icon: LucideIcon; show?: boolean; count?: number };

function useHub(channel: Channel) {
  return useQuery({ queryKey: ['channel', channel], queryFn: () => api.get<Hub>(`/api/channels/${channel.toLowerCase()}`), refetchInterval: 60_000 });
}

// ---------------------------------------------------------------- the frame: coloured band + tabs

function HubFrame({ channel, tabs, tab, action, stats, children }: { channel: Channel; tabs: TabDef[]; tab: string; action: ReactNode; stats: ReactNode; children: ReactNode }) {
  const t = THEME[channel];
  const Icon = t.icon;
  const base = channel === 'EMAIL' ? '/email' : '/whatsapp';
  return (
    <div className="flex flex-col gap-5">
      <section className={cn('relative overflow-hidden rounded-[24px] px-5 pb-5 pt-6 text-white shadow-[0_18px_40px_-24px_rgb(20_10_80/0.6)] sm:px-7 sm:pt-7', t.band)}>
        <Icon aria-hidden className="hub-drift pointer-events-none absolute -right-6 -top-8 h-48 w-48 rotate-[-14deg] text-white/[0.09] sm:h-60 sm:w-60" strokeWidth={1.2} />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-white/15 ring-1 ring-white/25 backdrop-blur-sm">
              <Icon className="h-7 w-7" />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="text-[28px] font-extrabold leading-none tracking-[-0.03em]">{t.name}</h1>
              <p className="max-w-[56ch] text-[14px] leading-snug text-white/80">{t.blurb}</p>
            </div>
          </div>
          {action}
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">{stats}</div>
      </section>

      <nav aria-label={`${t.name} sections`} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {tabs
          .filter((x) => x.show !== false)
          .map(({ id, label, icon: TabIcon, count }) => {
            const active = tab === id;
            return (
              <NavLink
                key={id}
                to={id === 'home' ? base : `${base}/${id}`}
                end
                className={cn(
                  'group inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-[background,color,border-color,box-shadow,transform] duration-200 active:scale-[0.97]',
                  active ? cn('border-transparent shadow-[var(--shadow-lift)]', t.pill) : 'border-line bg-surface text-ink-2 hover:border-[#cfcde6] hover:text-ink',
                )}
              >
                <TabIcon className={cn('h-4 w-4 transition-transform duration-300 group-hover:-rotate-6', active ? '' : 'text-muted')} />
                {label}
                {!!count && <span className={cn('tnum rounded-full px-1.5 text-[11px]', active ? 'bg-white/70' : 'bg-line-soft text-ink-2')}>{count}</span>}
              </NavLink>
            );
          })}
      </nav>

      <div key={tab} className="hub-in flex flex-col gap-5">
        {children}
      </div>
    </div>
  );
}

function BandStat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] font-medium text-white/70">{label}</span>
      <span className="tnum text-[26px] font-extrabold leading-none tracking-[-0.03em]">{value}</span>
      {note && <span className="truncate text-[12px] text-white/75">{note}</span>}
    </div>
  );
}

function BandButton({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="group inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-ink shadow-[0_8px_20px_-8px_rgb(0_0_0/0.45)] transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.97]"
    >
      <Plus className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" strokeWidth={2.6} />
      {children}
    </Link>
  );
}

function bandStats(h: Hub | undefined, channel: Channel) {
  const m = h?.thisMonth;
  const change = m?.sentChange;
  return (
    <>
      <BandStat label="Sent this month" value={m ? <CountUp value={m.sent} /> : '–'} note={change === null || change === undefined ? 'First month' : `${change >= 0 ? '+' : ''}${change}% vs last month`} />
      <BandStat label="Delivered" value={m ? pct(m.deliveryRate) : '–'} note={m ? `${n(m.delivered)} reached` : undefined} />
      <BandStat label={channel === 'EMAIL' ? 'Opened' : 'Read'} value={m ? pct(m.openRate) : '–'} note={m ? `${n(m.opened)} ${channel === 'EMAIL' ? 'opened' : 'read'}` : undefined} />
      <BandStat label="Customers you can reach" value={h ? <CountUp value={h.reachable} /> : '–'} note={channel === 'EMAIL' ? 'Subscribed to email' : 'Agreed to WhatsApp'} />
    </>
  );
}

// ---------------------------------------------------------------- Overview tab pieces

function ActionCard({ to, icon: Icon, title, note, tone }: { to: string; icon: LucideIcon; title: string; note: string; tone: string }) {
  return (
    <Link to={to} className="group relative flex flex-col gap-3 overflow-hidden rounded-[18px] border border-line bg-surface p-4 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-transparent hover:shadow-[var(--shadow-lift)]">
      <span className={cn('grid h-11 w-11 place-items-center rounded-[14px] transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6', tone)}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-[15px] font-semibold">
          {title}
          <ArrowRight className="h-3.5 w-3.5 -translate-x-1 opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
        </span>
        <span className="text-[13px] leading-snug text-muted">{note}</span>
      </span>
    </Link>
  );
}

const SOURCE_STYLE = {
  broadcast: { label: 'Broadcasts', cls: '' },
  automatic: { label: 'Automatic', cls: 'bg-warm-chart' },
  direct: { label: 'Sent by your team', cls: 'bg-[#b9b3f4]' },
} as const;

function Last14({ h }: { h: Hub }) {
  const mounted = useMounted();
  const t = THEME[h.channel];
  const max = Math.max(1, ...h.last14Days.map((d) => d.broadcast + d.automatic + d.direct));
  const total = h.last14Days.reduce((a, d) => a + d.broadcast + d.automatic + d.direct, 0);
  return (
    <Panel className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Last 14 days</h2>
        <span className="tnum text-[13px] text-muted">{n(total)} sent</span>
      </div>
      <div className="flex h-40 items-end gap-1.5" role="img" aria-label={`Messages sent each day for the last 14 days, ${n(total)} in all`}>
        {h.last14Days.map((d, i) => {
          const sum = d.broadcast + d.automatic + d.direct;
          const today = i === h.last14Days.length - 1;
          return (
            <div key={d.day} className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${new Date(d.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}: ${sum} sent`}>
              <div
                className="flex w-full max-w-[28px] flex-col-reverse overflow-hidden rounded-[7px] bg-line-soft transition-[height] duration-700 ease-out"
                style={{ height: mounted ? `${Math.max(sum ? 6 : 3, (sum / max) * 100)}%` : '3%', transitionDelay: `${i * 30}ms` }}
              >
                {(['broadcast', 'automatic', 'direct'] as const).map((k) =>
                  d[k] ? <span key={k} className={cn('block w-full', k === 'broadcast' ? t.bar : SOURCE_STYLE[k].cls)} style={{ height: `${(d[k] / sum) * 100}%` }} /> : null,
                )}
              </div>
              <span className={cn('text-[10px]', today ? 'font-bold text-ink' : 'text-faint')}>{today ? 'Today' : new Date(d.day).getDate()}</span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted">
        {(['broadcast', 'automatic', 'direct'] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={cn('h-2.5 w-2.5 rounded-full', k === 'broadcast' ? t.bar : SOURCE_STYLE[k].cls)} />
            {SOURCE_STYLE[k].label} <b className="tnum text-ink-2">{n(h.thisMonth.bySource[k])}</b>
          </span>
        ))}
        <span className="ml-auto">this month</span>
      </div>
    </Panel>
  );
}

function ComingUp({ h, base }: { h: Hub; base: string }) {
  const rows: { icon: ReactNode; label: ReactNode; to: string }[] = [];
  if (h.broadcasts.next) rows.push({ icon: <CalendarClock />, label: <>Next: <b>{h.broadcasts.next.name}</b>, {dateTime(h.broadcasts.next.scheduledAt)}</>, to: `/campaigns/${h.broadcasts.next.id}/edit` });
  if (h.broadcasts.drafts) rows.push({ icon: <FileText />, label: <><b>{h.broadcasts.drafts}</b> draft{h.broadcasts.drafts > 1 ? 's' : ''} waiting to be sent</>, to: `${base}/broadcasts?tab=DRAFT` });
  if (h.channel === 'EMAIL' || h.automations.on + h.automations.off > 0)
    rows.push({ icon: <Clock3 />, label: h.automations.on ? <><b>{h.automations.on}</b> automatic {h.channel === 'EMAIL' ? 'email' : 'message'}{h.automations.on > 1 ? 's' : ''} switched on</> : <>No automatic {h.channel === 'EMAIL' ? 'emails' : 'messages'} on yet</>, to: `${base}/automatic` });
  return (
    <Panel className="flex flex-col gap-1 p-2">
      <h2 className="px-3 pb-1 pt-3 text-[15px] font-semibold">Coming up</h2>
      {rows.length === 0 ? (
        <p className="px-3 pb-3 text-[13px] text-muted">Nothing scheduled. Broadcasts you schedule show up here.</p>
      ) : (
        rows.map((r, i) => (
          <Link key={i} to={r.to} className="flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-[13px] text-ink-2 hover:bg-hover [&_svg]:h-4 [&_svg]:w-4">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-sunken text-muted">{r.icon}</span>
            <span className="min-w-0 flex-1">{r.label}</span>
            <ArrowRight className="text-faint" />
          </Link>
        ))
      )}
    </Panel>
  );
}

function EmailReady({ h }: { h: Hub }) {
  const { user } = useSession();
  const e = h.email!;
  const ok = e.sendersReady > 0;
  return (
    <Panel className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <span className={cn('grid h-9 w-9 place-items-center rounded-[11px]', ok ? 'bg-success-soft text-success' : 'bg-warm-soft text-warm')}>{ok ? <CheckCircle2 className="h-5 w-5" /> : <TriangleAlert className="h-5 w-5" />}</span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold">{ok ? 'Ready to send' : 'Add a sending address'}</span>
          <span className="truncate text-[13px] text-muted">{ok ? `From ${e.defaultSender}` : 'Emails need your agency’s address to go out from.'}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="font-medium text-ink-2">Emails this month</span>
          <span className="tnum text-muted">
            {n(e.quota.used)} / {n(e.quota.limit)}
          </span>
        </div>
        <ProgressBar value={e.quota.used} max={e.quota.limit} label="Emails used this month" tone={e.quota.used / Math.max(1, e.quota.limit) > 0.9 ? 'warm' : 'accent'} />
      </div>
      {!ok && user.role !== 'MEMBER' && (
        <Link to="/email/setup" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:text-accent-strong">
          Set up sending <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
      {!ok && user.role === 'MEMBER' && <p className="text-[13px] text-muted">Ask your agency owner to set up the sending address.</p>}
    </Panel>
  );
}

function WhatsAppReady() {
  const q = useWhatsApp();
  const wa = q.data;
  if (!wa) return <Skeleton className="h-36 rounded-[var(--radius-panel)]" />;
  const linked = wa.status === 'CONNECTED';
  const limit = wa.trialPerDay ? Math.min(wa.dailyLimit, wa.trialPerDay) : wa.dailyLimit;
  return (
    <Panel className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <span className={cn('relative grid h-9 w-9 place-items-center rounded-[11px]', linked ? 'bg-success-soft text-success' : 'bg-warm-soft text-warm')}>
          <Smartphone className="h-5 w-5" />
          {linked && <span className="dispatch-live absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-surface" />}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold">{linked ? 'Number linked' : 'Number not linked'}</span>
          <span className="truncate text-[13px] text-muted">{linked ? (wa.displayName ? `${wa.displayName}, ${wa.phone}` : wa.phone) : 'Messages wait until you link it again.'}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="font-medium text-ink-2">Sent in the last 24 hours</span>
          <span className="tnum text-muted">
            {n(wa.sentLast24h)} / {n(limit)}
          </span>
        </div>
        <ProgressBar value={wa.sentLast24h} max={limit} label="WhatsApp messages in the last 24 hours" tone={wa.sentLast24h / Math.max(1, limit) > 0.9 ? 'warm' : 'accent'} />
      </div>
      {!linked && (
        <Link to="/whatsapp/setup" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-success hover:text-success-strong">
          Link your number <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </Panel>
  );
}

function OverviewTab({ h, channel }: { h: Hub | undefined; channel: Channel }) {
  const base = channel === 'EMAIL' ? '/email' : '/whatsapp';
  const actions =
    channel === 'EMAIL'
      ? [
          { to: '/campaigns/new', icon: Megaphone, title: 'Send a broadcast', note: 'One email to many customers, now or later', tone: 'bg-accent-soft text-accent' },
          { to: '/automations/new?recipe=birthday', icon: Clock3, title: 'Automatic email', note: 'Birthdays, anniversaries, trip dates', tone: 'bg-highlight-soft text-warm' },
          { to: '/email/templates', icon: FileText, title: 'Email designs', note: 'Reusable templates for offers and updates', tone: 'bg-plum-soft text-plum-ink' },
          { to: '/contacts?add=1', icon: UserPlus, title: 'Add customers', note: 'One by one or from a spreadsheet', tone: 'bg-blue-soft text-blue-ink' },
        ]
      : [
          { to: '/campaigns/new?channel=WHATSAPP', icon: Megaphone, title: 'Send a broadcast', note: 'One WhatsApp message to many customers', tone: 'bg-success-soft text-success' },
          { to: '/automations/new?channel=WHATSAPP&recipe=birthday', icon: Clock3, title: 'Automatic message', note: 'Birthday wishes and date reminders on WhatsApp', tone: 'bg-highlight-soft text-warm' },
          { to: '/contacts?add=1', icon: UserPlus, title: 'Add customers', note: 'One by one or from a spreadsheet', tone: 'bg-blue-soft text-blue-ink' },
          { to: '/whatsapp/setup', icon: Link2, title: 'Linked number', note: 'Link or change your agency’s WhatsApp', tone: 'bg-plum-soft text-plum-ink' },
        ];
  return (
    <>
      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        {actions.map((a) => (
          <ActionCard key={a.title} {...a} />
        ))}
      </div>
      {!h ? (
        <Skeleton className="h-72 rounded-[var(--radius-panel)]" />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
            <Last14 h={h} />
            <WorkingForYou items={h.activity} title={channel === 'EMAIL' ? 'Latest emails' : 'Latest WhatsApp messages'} note="Newest first, from broadcasts, automatic messages and your team." />
          </div>
          <div className="stagger flex flex-col gap-5">
            {channel === 'EMAIL' ? <EmailReady h={h} /> : <WhatsAppReady />}
            <ComingUp h={h} base={base} />
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- the two pages

export function EmailHubPage() {
  const { tab = 'home' } = useParams();
  const { user } = useSession();
  const h = useHub('EMAIL');
  const admin = user.role !== 'MEMBER';
  const tabs: TabDef[] = [
    { id: 'home', label: 'Overview', icon: LayoutDashboard },
    { id: 'broadcasts', label: 'Broadcasts', icon: Megaphone, count: h.data ? h.data.broadcasts.drafts + h.data.broadcasts.scheduled : undefined },
    { id: 'automatic', label: 'Automatic emails', icon: Clock3, count: h.data?.automations.on },
    { id: 'templates', label: 'Designs', icon: FileText },
    { id: 'setup', label: 'Sending setup', icon: Send, show: admin },
  ];
  if (!tabs.some((t) => t.id === tab && t.show !== false)) return <Navigate to="/email" replace />;
  return (
    <HubFrame channel="EMAIL" tab={tab} tabs={tabs} action={<BandButton to="/campaigns/new">New email broadcast</BandButton>} stats={bandStats(h.data, 'EMAIL')}>
      {tab === 'home' && <OverviewTab h={h.data} channel="EMAIL" />}
      {tab === 'broadcasts' && <CampaignsPage channel="EMAIL" embedded />}
      {tab === 'automatic' && <AutomationsPage channel="EMAIL" embedded />}
      {tab === 'templates' && <TemplatesPage embedded />}
      {tab === 'setup' && <EmailSetup />}
    </HubFrame>
  );
}

function EmailSetup() {
  const [params, setParams] = useSearchParams();
  const part = params.get('part') === 'domains' ? 'domains' : 'senders';
  const setPart = (p: 'senders' | 'domains') => setParams(p === 'domains' ? { part: p } : {}, { replace: true });
  return (
    <>
      <Segmented
        label="Sending setup"
        value={part}
        onChange={setPart}
        options={[
          { value: 'senders', label: 'Sending addresses' },
          { value: 'domains', label: 'Domains' },
        ]}
      />
      {part === 'senders' ? <Senders /> : <Domains />}
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Globe className="h-3.5 w-3.5" /> Customers see your agency’s name and address on every email, never {BRAND.name}.
      </p>
    </>
  );
}

export function WhatsAppHubPage() {
  const { tab = 'home' } = useParams();
  const { tenant } = useSession();
  const h = useHub('WHATSAPP');
  const tabs: TabDef[] = [
    { id: 'home', label: 'Overview', icon: LayoutDashboard },
    { id: 'broadcasts', label: 'Broadcasts', icon: Megaphone, count: h.data ? h.data.broadcasts.drafts + h.data.broadcasts.scheduled : undefined },
    { id: 'automatic', label: 'Automatic messages', icon: Clock3, count: h.data?.automations.on },
    { id: 'setup', label: 'Linked number', icon: Smartphone },
  ];
  if (!tabs.some((t) => t.id === tab)) return <Navigate to="/whatsapp" replace />;
  if (!tenant.features?.whatsapp) {
    return (
      <HubFrame channel="WHATSAPP" tab="home" tabs={[tabs[0]!]} action={null} stats={bandStats(undefined, 'WHATSAPP')}>
        <Panel>
          <EmptyState
            icon={<MessageCircle />}
            title="WhatsApp isn’t switched on for your account"
            action={
              <a href={`mailto:${BRAND.supportEmail}?subject=${encodeURIComponent('WhatsApp for my agency')}`} className="font-semibold text-accent hover:text-accent-strong">
                Ask us to switch it on
              </a>
            }
          >
            It’s included in the free trial. After the trial, we switch it on for your agency on request.
          </EmptyState>
        </Panel>
      </HubFrame>
    );
  }
  return (
    <HubFrame channel="WHATSAPP" tab={tab} tabs={tabs} action={<BandButton to="/campaigns/new?channel=WHATSAPP">New WhatsApp broadcast</BandButton>} stats={bandStats(h.data, 'WHATSAPP')}>
      {tab === 'home' && <OverviewTab h={h.data} channel="WHATSAPP" />}
      {tab === 'broadcasts' && <CampaignsPage channel="WHATSAPP" embedded />}
      {tab === 'automatic' && <AutomationsPage channel="WHATSAPP" embedded />}
      {tab === 'setup' && <WhatsAppSettings heading={false} />}
    </HubFrame>
  );
}

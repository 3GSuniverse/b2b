import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, Columns3, FileText, List, MessageSquarePlus, Package as PackageIcon, Plane, PlaneTakeoff, Plus, Search, Tag, Users, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, LinkButton } from '@/components/ui/button';
import { Segmented, Tabs } from '@/components/ui/controls';
import { Avatar, type ChipTone, EmptyState, IconChip, PageHeader, Panel, Skeleton } from '@/components/ui/display';
import { Input } from '@/components/ui/field';
import { PaymentChip, STATUS, travellers, TripStatusBadge } from '@/components/trips/shared';
import { NewTripSheet } from '@/components/trips/trip-form';
import { GroupDialog } from '@/components/groups/dialogs';
import { api, qs } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dateRange, inr, inrShort, n } from '@/lib/format';
import type { Contact, GroupSummary, TripStats, TripStatus, TripSummary } from '@/lib/types';
import { CountUp } from '@/lib/motion';
import { usePlanAllows } from '@/components/plan-lock';
import { isTravelBusiness, tx } from '../lib/words';

type View = 'board' | 'list';
type ListTab = 'OPEN' | 'overdue' | 'due' | 'COMPLETED' | 'CLOSED' | 'ALL';
interface Page {
  trips: TripSummary[];
  page: number;
  total: number;
  pages: number;
}

const VIEW_KEY = 'trips.view';
function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board';
  } catch {
    return 'board';
  }
}

function useStats() {
  return useQuery({ queryKey: ['trips', 'stats'], queryFn: () => api.get<{ stats: TripStats }>('/api/trips/stats').then((r) => r.stats) });
}

// ---------------------------------------------------------------- Numbers

function StatsStrip({ onShowOverdue }: { onShowOverdue: () => void }) {
  const q = useStats();
  const s = q.data;
  const tiles = s
    ? [
        { label: 'New enquiries', icon: <MessageSquarePlus />, chip: 'indigo' as ChipTone, value: <CountUp value={s.counts.ENQUIRY} />, note: 'Waiting for a quote' },
        { label: 'Quoted', icon: <FileText />, chip: 'blue' as ChipTone, value: <CountUp value={s.counts.QUOTED} />, note: s.pipelineValue ? `${inr(s.pipelineValue)} waiting on a yes` : 'Nothing waiting' },
        { label: 'Leaving this week', icon: <PlaneTakeoff />, chip: 'saffron' as ChipTone, value: <CountUp value={s.departingThisWeek} />, note: `${n(s.counts.BOOKED)} booked in total` },
        {
          label: 'Overdue payments',
          icon: <AlertCircle />,
          chip: (s.overdue > 0 ? 'red' : 'green') as ChipTone,
          value: <CountUp value={s.overdue} format={inr} step={100} />,
          note: s.overdueTrips ? tx(`On ${s.overdueTrips} trip${s.overdueTrips > 1 ? 's' : ''} · see them`) : s.dueThisWeek ? `${inr(s.dueThisWeek)} due this week` : 'Nobody is late',
          tone: s.overdue > 0 ? 'danger' : undefined,
          onClick: s.overdueTrips ? onShowOverdue : undefined,
        },
        { label: 'Collected this month', icon: <Wallet />, chip: 'green' as ChipTone, value: <CountUp value={s.collectedThisMonth} format={inr} step={100} />, note: 'Payments recorded' },
      ]
    : [];
  return (
    // Hairlines between tiles come from the 1px gap showing the panel's line colour through
    <Panel className="grid grid-cols-2 gap-px overflow-hidden bg-line-soft sm:grid-cols-3 xl:grid-cols-5">
      {!s &&
        Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex flex-col gap-3 bg-surface p-5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      {tiles.map((t, i) => {
        const body = (
          <>
            <span className="flex items-center gap-2.5 text-[13px] font-semibold text-muted">
              <IconChip icon={t.icon} tone={t.chip} className="h-7 w-7 rounded-[9px] [&>svg]:h-3.5 [&>svg]:w-3.5" />
              {t.label}
            </span>
            <span className={cn('tnum text-[26px] font-bold leading-none tracking-[-0.03em]', t.tone === 'danger' && 'text-danger')}>{t.value}</span>
            <span className={cn('text-xs', t.tone === 'danger' ? 'font-medium text-danger' : 'text-muted')}>{t.note}</span>
          </>
        );
        const cls = cn('flex min-w-0 flex-col gap-2 bg-surface p-5 text-left', i === 4 && 'col-span-2 xl:col-span-1'); // last tile fills the row, so no empty cell shows
        return t.onClick ? (
          <button key={t.label} type="button" onClick={t.onClick} className={cn(cls, 'hover:bg-sunken')}>
            {body}
          </button>
        ) : (
          <div key={t.label} className={cls}>
            {body}
          </div>
        );
      })}
    </Panel>
  );
}

// ---------------------------------------------------------------- Group departures

function GroupStrip() {
  const q = useQuery({ queryKey: ['groups'], queryFn: () => api.get<{ groups: GroupSummary[] }>('/api/groups').then((r) => r.groups) });
  const groups = (q.data ?? []).filter((g) => g.status === 'BOOKED');
  if (!groups.length) return null;
  return (
    <section className="flex flex-col gap-3" aria-label="Group departures">
      <h2 className="text-[15px] font-semibold tracking-tight">Group departures</h2>
      <div className="stagger -mx-4 flex snap-x gap-4 overflow-x-auto scroll-px-4 px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0">
        {groups.map((g) => {
          const pct = g.capacity ? Math.min(100, (g.seatsTaken / g.capacity) * 100) : null;
          return (
            <Link key={g.id} to={`/groups/${g.id}`} className="flex w-[80vw] max-w-[360px] shrink-0 snap-start flex-col gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 lift lg:w-auto lg:max-w-none">
              <div className="flex items-start justify-between gap-2">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold">{g.title}</span>
                  <span className="truncate text-xs text-muted">{dateRange(g.startDate, g.endDate) ?? 'Dates not set'}</span>
                </span>
                <Users className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="tnum text-[13px]">
                  <span className="font-semibold">{g.seatsTaken}</span>
                  <span className="text-muted">{g.capacity ? ` of ${g.capacity} seats` : ' seats'} · {g.families} famil{g.families === 1 ? 'y' : 'ies'}</span>
                </span>
                {pct !== null && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
                    <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-warm' : 'bg-accent')} style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-line-soft pt-2.5 text-xs">
                <span className="tnum text-muted">
                  {inrShort(g.collected)} of {inrShort(g.expected)} in
                </span>
                {g.overdue > 0 && <span className="tnum font-semibold text-danger">{inrShort(g.overdue)} overdue</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Board

const COLUMNS: { status: TripStatus; empty: string }[] = [
  { status: 'ENQUIRY', empty: 'New enquiries land here.' },
  { status: 'QUOTED', empty: 'Drag an enquiry here once you’ve sent the price.' },
  { status: 'BOOKED', empty: tx("Confirmed trips. Recording a payment moves a trip here.") },
];

function TripCard({ t, onDragStart, dragging }: { t: TripSummary; onDragStart: (e: DragEvent, t: TripSummary) => void; dragging: boolean }) {
  const range = dateRange(t.startDate, t.endDate);
  const value = t.price || t.budget;
  return (
    <li
      draggable
      onDragStart={(e) => onDragStart(e, t)}
      className={cn(
        'group relative flex cursor-grab flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-3.5 shadow-[0_1px_0_rgb(23_21_59/0.03)] lift active:cursor-grabbing',
        dragging && 'opacity-40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link to={`/trips/${t.id}`} className="min-w-0 text-sm font-semibold leading-snug after:absolute after:inset-0 after:content-[''] hover:underline" draggable={false}>
          {t.title}
        </Link>
        <span className="tnum shrink-0 text-xs text-faint">#{t.number}</span>
      </div>
      <div className="flex items-center gap-2 text-[13px] text-ink-2">
        <Avatar name={t.customer.name} size={22} />
        <span className="truncate">{t.customer.name}</span>
      </div>
      {t.package && t.package.name !== t.title && (
        <span className="inline-flex items-center gap-1 self-start rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold text-accent-strong">
          <PackageIcon className="h-3 w-3" aria-hidden />
          {t.package.name}
        </span>
      )}
      {(range || t.adults + t.children > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {range && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              {range}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" aria-hidden />
            {t.adults + t.children}
          </span>
        </div>
      )}
      {(value || t.money.paid > 0 || t.money.nextDue) && (
        <div className="flex items-center justify-between gap-2 border-t border-line-soft pt-2.5">
          <span className="tnum text-[13px] font-semibold">
            {t.price ? inrShort(t.price) : t.budget ? <span className="font-normal text-muted">Budget {inrShort(t.budget)}</span> : null}
          </span>
          <PaymentChip trip={t} compact />
        </div>
      )}
    </li>
  );
}

function Board({ onNew }: { onNew: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['trips', 'board'], queryFn: () => api.get<Page>('/api/trips?status=OPEN&pageSize=200') });
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<TripStatus | null>(null);

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TripStatus }) => api.patch(`/api/trips/${id}`, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['trips', 'board'] });
      const prev = qc.getQueryData<Page>(['trips', 'board']);
      if (prev) qc.setQueryData<Page>(['trips', 'board'], { ...prev, trips: prev.trips.map((t) => (t.id === id ? { ...t, status } : t)) });
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['trips', 'board'], ctx.prev);
      toast.error(e.message);
    },
    onSuccess: (_d, { status }) => toast.success(`Moved to ${STATUS[status].label}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['trips'] }),
  });

  const trips = q.data?.trips ?? [];
  const onDragStart = (e: DragEvent, t: TripSummary) => {
    e.dataTransfer.setData('text/plain', t.id);
    e.dataTransfer.effectAllowed = 'move';
    setDragId(t.id);
  };
  const drop = (status: TripStatus) => (e: DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const t = trips.find((x) => x.id === id);
    setOver(null);
    setDragId(null);
    if (t && t.status !== status) move.mutate({ id, status });
  };

  if (q.isPending) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNS.map((c) => (
          <Skeleton key={c.status} className="h-80 rounded-[var(--radius-panel)]" />
        ))}
      </div>
    );
  }
  return (
    <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0">
      {COLUMNS.map(({ status, empty }) => {
        const items = trips
          .filter((t) => t.status === status)
          .sort((a, b) => (status === 'BOOKED' ? (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999') : b.createdAt.localeCompare(a.createdAt)));
        const value = items.reduce((a, t) => a + (t.price || t.budget || 0), 0);
        return (
          <section
            key={status}
            aria-label={STATUS[status].label}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(status);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
            }}
            onDrop={drop(status)}
            onDragEnd={() => {
              setDragId(null);
              setOver(null);
            }}
            className={cn(
              'flex w-[85vw] max-w-[380px] shrink-0 snap-start flex-col gap-3 rounded-[var(--radius-panel)] border bg-sunken p-3 transition-colors lg:w-auto lg:max-w-none',
              over === status && dragId ? 'border-accent bg-accent-soft/50' : 'border-line',
            )}
          >
            <header className="flex items-center justify-between gap-2 px-1 pt-1">
              <div className="flex items-center gap-2">
                <TripStatusBadge status={status} />
                <span className="tnum text-[13px] font-semibold text-ink-2">{items.length}</span>
              </div>
              {value > 0 && <span className="tnum text-xs text-muted">{inrShort(value)}</span>}
            </header>
            <ul className="stagger flex min-h-24 flex-col gap-2.5">
              {items.map((t) => (
                <TripCard key={t.id} t={t} onDragStart={onDragStart} dragging={dragId === t.id} />
              ))}
              {!items.length && <li className="rounded-[12px] border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">{tx(empty)}</li>}
            </ul>
            {status === 'ENQUIRY' && (
              <button type="button" onClick={onNew} className="flex h-9 items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-medium text-muted hover:bg-hover hover:text-ink">
                <Plus className="h-4 w-4" aria-hidden />
                Add enquiry
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- List

function TripList({ tab, setTab }: { tab: ListTab; setTab: (t: ListTab) => void }) {
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setSearch(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);
  useEffect(() => setPage(1), [tab, search]);
  const params = tab === 'overdue' || tab === 'due' ? { payments: tab } : tab === 'ALL' ? {} : { status: tab };
  const q = useQuery({
    queryKey: ['trips', 'list', tab, search, page],
    queryFn: () => api.get<Page>(`/api/trips${qs({ ...params, search, page, pageSize: 25 })}`),
    placeholderData: keepPreviousData,
  });
  const rows = q.data?.trips ?? [];
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-2 sm:px-6">
        <div className="min-w-0 max-w-full overflow-x-auto">
          <Tabs<ListTab>
            label={tx("Filter trips")}
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'OPEN', label: 'Open' },
              { value: 'overdue', label: 'Payments overdue' },
              { value: 'due', label: 'Payments due' },
              { value: 'COMPLETED', label: 'Completed' },
              { value: 'CLOSED', label: 'Closed' },
              { value: 'ALL', label: 'All' },
            ]}
          />
        </div>
        <div className="mb-2 w-full sm:w-64">
          <Input aria-label={tx("Search trips")} leading={<Search className="h-4 w-4" />} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Name, place, phone or #" />
        </div>
      </div>
      <ul className={cn('stagger flex flex-col border-t border-line-soft transition-opacity', q.isPlaceholderData && 'opacity-60')}>
        {q.isPending &&
          Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="border-t border-line-soft px-6 py-4 first:border-0">
              <Skeleton className="h-10" />
            </li>
          ))}
        {!q.isPending && !rows.length && (
          <li className="px-6 py-14 text-center text-sm text-muted">{search ? tx(`No trips match “${search}”.`) : tab === 'overdue' ? 'Nobody is late with a payment.' : 'Nothing here yet.'}</li>
        )}
        {rows.map((t) => (
          <li key={t.id} className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1.5 border-t border-line-soft px-5 py-3.5 first:border-0 hover:bg-sunken sm:px-6 lg:grid-cols-[56px_minmax(0,1fr)_170px_110px_150px]">
            <span className="tnum hidden text-[13px] text-faint lg:block">#{t.number}</span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <Link to={`/trips/${t.id}`} className="truncate text-sm font-semibold after:absolute after:inset-0 after:content-[''] hover:underline">
                {t.title}
              </Link>
              <span className="truncate text-[13px] text-muted">
                {t.customer.name} · {travellers(t)}
                {t.package ? tx(` · ${t.package.name}`) : ''}
              </span>
            </div>
            <div className="justify-self-end lg:hidden">
              <TripStatusBadge status={t.status} />
            </div>
            <span className="tnum hidden text-[13px] text-ink-2 lg:block">{dateRange(t.startDate, t.endDate) ?? <span className="text-faint">Dates not set</span>}</span>
            <span className="hidden lg:block">
              <TripStatusBadge status={t.status} />
            </span>
            <div className="col-span-2 flex items-center justify-between gap-3 lg:col-span-1 lg:flex-col lg:items-end lg:gap-0.5">
              <span className="tnum text-[13px] font-semibold">{t.price ? inr(t.price) : <span className="font-normal text-faint">No price yet</span>}</span>
              <PaymentChip trip={t} />
            </div>
          </li>
        ))}
      </ul>
      {(q.data?.pages ?? 1) > 1 && (
        <div className="flex items-center justify-between border-t border-line-soft px-5 py-3 text-[13px] text-muted sm:px-6">
          <span className="tnum">
            Page {q.data!.page} of {q.data!.pages} · {n(q.data!.total)} {tx("trips")}
          </span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" disabled={page >= q.data!.pages} onClick={() => setPage(page + 1)} aria-label="Next page">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- Page

export function TripsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [view, setViewState] = useState<View>(() => (params.get('tab') ? 'list' : savedView()));
  const tab = (params.get('tab') as ListTab | null) ?? 'OPEN';
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [newGroup, setNewGroup] = useState(false);
  const groupsAllowed = usePlanAllows('groups');
  const stats = useStats();
  // Arriving from a contact ("Add an enquiry for them")
  const fromContact = params.get('contact');
  const prefill = useQuery({
    queryKey: ['contact', fromContact],
    queryFn: () => api.get<{ contact: Contact }>(`/api/contacts/${fromContact}`).then((r) => r.contact),
    enabled: !!fromContact,
  });
  const pc = prefill.data;
  const picked = useMemo(
    () => (pc ? { id: pc.id, name: [pc.firstName, pc.lastName].filter(Boolean).join(' ') || pc.email || pc.phone || 'Contact', phone: pc.phone, email: pc.email } : null),
    [pc],
  );

  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
    if (v === 'board') setParams({}, { replace: true });
  };
  const setTab = (t: ListTab) => setParams(t === 'OPEN' ? {} : { tab: t }, { replace: true });
  const empty = stats.data && Object.values(stats.data.counts).every((c) => c === 0);

  return (
    <>
      <PageHeader
        title={tx("Trips")}
        description={tx("Every enquiry, quote, booking and payment, from the first call to the trip home.")}
        actions={
          <>
            <LinkButton to="/trips/packages">
              <PackageIcon className="h-4 w-4" />
              {tx("Packages")}
            </LinkButton>
            {isTravelBusiness() && (
              <LinkButton to="/trips/prices">
                <Tag className="h-4 w-4" />
                Price list
              </LinkButton>
            )}
            {groupsAllowed && isTravelBusiness() && (
              <Button onClick={() => setNewGroup(true)}>
                <Users className="h-4 w-4" />
                New group
              </Button>
            )}
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              New enquiry
            </Button>
          </>
        }
      />

      {empty ? (
        <Panel>
          <EmptyState
            icon={<Plane />}
            title="Add your first enquiry"
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                New enquiry
              </Button>
            }
          >
            {tx("When someone calls or messages about a trip, note it here. Follow it through quote and booking, schedule the advance and balance, and record payments as they come in. Reminders and receipts go out from here too.")}
          </EmptyState>
        </Panel>
      ) : (
        <>
          <StatsStrip
            onShowOverdue={() => {
              setViewState('list');
              setTab('overdue');
            }}
          />
          <GroupStrip />
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold tracking-tight">{view === 'board' ? tx('Open trips') : tx('All trips')}</h2>
            <Segmented<View>
              size="sm"
              label="View"
              value={view}
              onChange={setView}
              options={[
                {
                  value: 'board',
                  label: (
                    <span className="flex items-center gap-1.5">
                      <Columns3 className="h-3.5 w-3.5" aria-hidden />
                      Board
                    </span>
                  ),
                },
                {
                  value: 'list',
                  label: (
                    <span className="flex items-center gap-1.5">
                      <List className="h-3.5 w-3.5" aria-hidden />
                      List
                    </span>
                  ),
                },
              ]}
            />
          </div>
          {view === 'board' ? <Board onNew={() => setCreating(true)} /> : <TripList tab={tab} setTab={setTab} />}
        </>
      )}

      <GroupDialog
        open={newGroup}
        onClose={() => setNewGroup(false)}
        onSaved={(g) => {
          setNewGroup(false);
          qc.invalidateQueries({ queryKey: ['groups'] });
          nav(`/groups/${g.id}`);
        }}
      />
      <NewTripSheet
        open={creating && (!fromContact || !!picked)}
        contact={picked}
        onClose={() => {
          setCreating(false);
          if (fromContact || params.get('new')) setParams({}, { replace: true });
        }}
        onCreated={(t) => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ['trips'] });
          nav(`/trips/${t.id}`);
        }}
      />
    </>
  );
}

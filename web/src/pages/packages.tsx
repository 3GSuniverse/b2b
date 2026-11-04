import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Archive, CalendarDays, MoreHorizontal, Package as PackageIcon, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader, Panel, Skeleton } from '@/components/ui/display';
import { Menu, MenuItem } from '@/components/ui/overlay';
import { PackageSheet, usePackages } from '@/components/packages/package-sheet';
import { TripStatusBadge } from '@/components/trips/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dateRange, inr, inrShort } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { PackageDetail } from '@/lib/types';

const back = (
  <Link to="/trips" className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-muted hover:text-ink">
    <ArrowLeft className="h-4 w-4" aria-hidden />
    Trips
  </Link>
);
const length = (nights: number) => (nights ? `${nights}N/${nights + 1}D` : 'Day trip');

export function PackagesPage() {
  const nav = useNavigate();
  const q = usePackages();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        back={back}
        title="Packages"
        description="The trips you sell again and again. Choose one on an enquiry and the price, dates and quote fill in, and you can see who took each one."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New package
          </Button>
        }
      />
      {q.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-48 rounded-[var(--radius-panel)]" />
          ))}
        </div>
      ) : !q.data?.length ? (
        <Panel>
          <EmptyState icon={<PackageIcon />} title="Add your first package" action={<Button variant="primary" onClick={() => setCreating(true)}>New package</Button>}>
            “Kerala 4N/5D”, “Char Dham 11 days”, “Goa honeymoon”: the trips you sell most. Set the price per adult and per child once; every booking of it is counted here.
          </EmptyState>
        </Panel>
      ) : (
        <div className="stagger grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((p) => (
            <Link key={p.id} to={`/trips/packages/${p.id}`} className="flex flex-col gap-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5 lift">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted">
                  {[p.destination, length(p.nights)].filter(Boolean).join(' · ')}
                </span>
                <span className="text-[16px] font-semibold tracking-tight">{p.name}</span>
                {p.summary && <span className="line-clamp-2 text-[13px] text-muted">{p.summary}</span>}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="tnum text-xl font-semibold tracking-[-0.02em]">{inr(p.pricePerAdult)}</span>
                <span className="text-xs text-muted">per adult</span>
                {p.marginPerPerson !== null && <span className="tnum ml-auto text-xs font-medium text-accent-strong">+{inr(p.marginPerPerson)} margin</span>}
              </div>
              <div className="grid grid-cols-3 gap-2 border-t border-line-soft pt-3 text-[13px]">
                <span className="flex flex-col">
                  <span className="tnum font-semibold">{p.stats.bookings}</span>
                  <span className="text-xs text-muted">booked</span>
                </span>
                <span className="flex flex-col">
                  <span className="tnum font-semibold">{p.stats.travellers}</span>
                  <span className="text-xs text-muted">travellers</span>
                </span>
                <span className="flex flex-col">
                  <span className="tnum font-semibold">{inrShort(p.stats.value)}</span>
                  <span className="text-xs text-muted">sold</span>
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
      <PackageSheet
        pkg={null}
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(p) => {
          setCreating(false);
          nav(`/trips/packages/${p.id}`);
        }}
      />
    </>
  );
}

export function PackagePage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { user } = useSession();
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['package', id], queryFn: () => api.get<{ package: PackageDetail }>(`/api/packages/${id}`).then((r) => r.package) });
  const archive = useMutation({
    mutationFn: () => api.del(`/api/packages/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['packages'] });
      toast.success('Package archived. Its bookings stay as they are.');
      nav('/trips/packages');
    },
  });
  const p = q.data;
  if (!p) return <Skeleton className="h-96 rounded-[var(--radius-panel)]" />;
  const s = p.stats;
  const tiles = [
    { label: 'Booked', value: String(s.bookings), note: s.enquiries ? `${s.enquiries} more asking` : 'Booked or travelled' },
    { label: 'Travellers', value: String(s.travellers), note: 'On those bookings' },
    { label: 'Sold', value: inr(s.value), note: `${inr(s.received)} received` },
    { label: 'Margin', value: s.margin !== null ? inr(s.margin) : '—', note: s.cost !== null ? `after ${inr(s.cost)} costs` : 'Add your cost per person to see it', tone: s.margin !== null && s.margin < 0 ? 'danger' : 'accent' },
  ];

  return (
    <>
      <PageHeader
        back={
          <Link to="/trips/packages" className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-muted hover:text-ink">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Packages
          </Link>
        }
        title={p.name}
        description={[p.destination, length(p.nights), `${inr(p.pricePerAdult)} per adult`, p.pricePerChild !== null && `${inr(p.pricePerChild)} per child`].filter(Boolean).join(' · ')}
        actions={
          <>
            <Button onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
            {user.role !== 'MEMBER' && (
              <Menu trigger={<Button aria-label="More options"><MoreHorizontal className="h-4 w-4" /></Button>}>
                <MenuItem icon={<Archive />} onSelect={() => archive.mutate()}>
                  Archive package
                </MenuItem>
              </Menu>
            )}
          </>
        }
      />

      <Panel className="grid grid-cols-2 gap-px overflow-hidden bg-line-soft lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="flex flex-col gap-2 bg-surface p-5">
            <span className="text-[13px] font-medium text-muted">{t.label}</span>
            <span className={cn('tnum text-[26px] font-semibold leading-none tracking-[-0.03em]', t.label === 'Margin' && s.margin !== null && (t.tone === 'danger' ? 'text-danger' : 'text-accent-strong'))}>{t.value}</span>
            <span className="text-xs text-muted">{t.note}</span>
          </div>
        ))}
      </Panel>

      <Panel className="overflow-hidden">
        <h2 className="px-5 pb-3 pt-5 text-[15px] font-semibold tracking-tight sm:px-6">Who took it</h2>
        {!p.trips.length ? (
          <p className="border-t border-line-soft px-6 py-10 text-center text-sm text-muted">Nobody yet. Choose this package on an enquiry and it shows up here.</p>
        ) : (
          <ul className="stagger border-t border-line-soft">
            {p.trips.map((t) => (
              <li key={t.id} className={cn('relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-1 border-t border-line-soft px-5 py-3.5 first:border-0 hover:bg-sunken sm:px-6 lg:grid-cols-[minmax(0,1fr)_190px_110px_200px]', (t.status === 'LOST' || t.status === 'CANCELLED') && 'opacity-55')}>
                <span className="flex min-w-0 flex-col">
                  <Link to={`/trips/${t.id}`} className="truncate text-sm font-semibold after:absolute after:inset-0 after:content-[''] hover:underline">
                    {t.customer}
                  </Link>
                  <span className="truncate text-xs text-muted">
                    #{t.number} · {t.adults} adult{t.adults === 1 ? '' : 's'}
                    {t.children ? `, ${t.children} child${t.children === 1 ? '' : 'ren'}` : ''}
                    {t.groupId ? ' · in a group' : ''}
                  </span>
                </span>
                <span className="hidden items-center gap-1.5 text-[13px] text-muted lg:flex">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                  {dateRange(t.startDate, t.endDate) ?? 'Dates not set'}
                </span>
                <span className="justify-self-end lg:justify-self-start">
                  <TripStatusBadge status={t.status} />
                </span>
                <span className="tnum col-span-2 flex items-baseline justify-between gap-2 text-[13px] lg:col-span-1 lg:flex-col lg:items-end lg:gap-0">
                  <span className="font-semibold">{inr(t.price)}</span>
                  <span className={cn('text-xs', t.overdue > 0 ? 'font-semibold text-danger' : 'text-muted')}>
                    {t.overdue > 0 ? `${inr(t.overdue)} overdue` : t.price > 0 && t.balance <= 0 ? 'Fully paid' : `${inr(t.paid)} received`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {(p.days.length > 0 || p.inclusions.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Panel className="flex flex-col gap-3 p-5 sm:p-6">
            <h2 className="text-[15px] font-semibold tracking-tight">Day by day</h2>
            {p.days.length ? (
              <ol className="stagger flex flex-col gap-3">
                {p.days.map((d, i) => (
                  <li key={i} className="grid grid-cols-[40px_minmax(0,1fr)] gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-accent-soft text-center text-[11px] font-bold leading-tight text-accent-strong">
                      Day
                      <br />
                      {i + 1}
                    </span>
                    <span className="flex flex-col">
                      <span className="text-sm font-semibold">{d.title || `Day ${i + 1}`}</span>
                      {d.description && <span className="text-[13px] leading-relaxed text-ink-2">{d.description}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[13px] text-muted">No day plan yet.</p>
            )}
          </Panel>
          <Panel className="flex flex-col gap-4 p-5">
            {[['Included', p.inclusions], ['Not included', p.exclusions]].map(([title, xs]) => (
              <div key={title as string} className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold">{title as string}</h3>
                <ul className="list-disc pl-5 text-[13px] text-ink-2">
                  {(xs as string[]).map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
          </Panel>
        </div>
      )}

      <PackageSheet
        pkg={p}
        open={editing}
        onClose={() => setEditing(false)}
        onSaved={(x) => {
          setEditing(false);
          qc.setQueryData(['package', id], x);
        }}
      />
    </>
  );
}

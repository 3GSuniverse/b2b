import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BedDouble, MessageCircle, MoreHorizontal, Pencil, Plus, Printer, Send, Users } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, LinkButton } from '@/components/ui/button';
import { Tabs } from '@/components/ui/controls';
import { Badge, EmptyState, Panel, Skeleton } from '@/components/ui/display';
import { Menu, MenuItem } from '@/components/ui/overlay';
import { AddFamilyDialog, BroadcastDialog, GroupDialog } from '@/components/groups/dialogs';
import { FOOD, GENDER, ID_LABEL, TravellersSheet } from '@/components/groups/travellers';
import { waShare } from '@/components/trips/payments';
import { TripStatusBadge } from '@/components/trips/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dateRange, inr, shortDate, tripLength } from '@/lib/format';
import type { GroupDetail, Traveller } from '@/lib/types';

type Tab = 'families' | 'travellers';

/** Room or seat, edited in place: saves the family's list when you leave the box. */
function InlineCell({ value, onSave, label }: { value: string | null; onSave: (v: string) => void; label: string }) {
  const [v, setV] = useState(value ?? '');
  return (
    <input
      aria-label={label}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== (value ?? '') && onSave(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="h-8 w-full min-w-0 rounded-[8px] border border-transparent bg-transparent px-2 text-[13px] hover:border-line focus:border-accent focus:bg-surface focus:outline-none"
      placeholder="—"
    />
  );
}

export function GroupPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('families');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const backToMessage = useRef(false);
  const [messaging, setMessaging] = useState(false);
  const [travellersOf, setTravellersOf] = useState<{ id: string; seats: number } | null>(null);
  const q = useQuery({ queryKey: ['group', id], queryFn: () => api.get<{ group: GroupDetail }>(`/api/groups/${id}`).then((r) => r.group) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['group', id] });
    qc.invalidateQueries({ queryKey: ['groups'] });
    qc.invalidateQueries({ queryKey: ['trips'] });
  };
  const assign = useMutation({
    mutationFn: () => api.post<{ group: GroupDetail }>(`/api/groups/${id}/assign`),
    onSuccess: ({ group }) => {
      qc.setQueryData(['group', id], group);
      toast.success('Rooms and seats assigned', { description: 'Two to a room within each family. Anything you’d set stays as it was.' });
    },
  });
  const status = useMutation({
    mutationFn: (s: 'BOOKED' | 'CANCELLED' | 'COMPLETED') => api.patch<{ group: GroupDetail }>(`/api/groups/${id}`, { status: s }),
    onSuccess: ({ group }) => {
      qc.setQueryData(['group', id], group);
      refresh();
    },
  });
  // Saving one traveller's room or seat: the family's list goes back with that one change
  const saveCell = useMutation({
    mutationFn: ({ tripId, list }: { tripId: string; list: Traveller[] }) =>
      api.put(`/api/trips/${tripId}/travellers`, { travellers: list.map((t) => ({ id: t.id, name: t.name, age: t.age, gender: t.gender, phone: t.phone, idType: t.idType, food: t.food, needs: t.needs, emergencyName: t.emergencyName, emergencyPhone: t.emergencyPhone, room: t.room, seat: t.seat })) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['group', id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const g = q.data;
  if (!g) return <Skeleton className="h-96 rounded-[var(--radius-panel)]" />;
  const active = g.bookings.filter((b) => b.status !== 'LOST' && b.status !== 'CANCELLED');
  const travellers = active.flatMap((b) => b.travellers.map((t) => ({ ...t, family: b })));
  const missing = active.reduce((a, b) => a + b.detailsMissing, 0);
  const pct = g.capacity ? Math.min(100, (g.seatsTaken / g.capacity) * 100) : null;

  return (
    <>
      <header className="flex flex-col gap-4">
        <Link to="/trips" className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Trips
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em]">
              {g.title}
              <span className="tnum ml-2.5 text-xl font-medium text-faint">#{g.number}</span>
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
              <Badge tone={g.status === 'CANCELLED' ? 'red' : g.status === 'COMPLETED' ? 'grey' : 'green'} dot>
                {g.status === 'CANCELLED' ? 'Cancelled' : g.status === 'COMPLETED' ? 'Completed' : 'Group departure'}
              </Badge>
              {[g.destination, dateRange(g.startDate, g.endDate), tripLength(g.startDate, g.endDate), g.perPersonPrice && `${inr(g.perPersonPrice)} per person`].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setMessaging(true)} disabled={!active.length}>
              <Send className="h-4 w-4" />
              Message everyone
            </Button>
            <Button variant="primary" onClick={() => setAdding(true)} disabled={g.status === 'CANCELLED'}>
              <Plus className="h-4 w-4" />
              Add a family
            </Button>
            <Menu
              trigger={
                <Button aria-label="More options">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              }
            >
              <MenuItem icon={<Pencil />} onSelect={() => setEditing(true)}>
                Edit departure
              </MenuItem>
              {g.status === 'BOOKED' && <MenuItem onSelect={() => status.mutate('COMPLETED')}>Mark as completed</MenuItem>}
              {g.status === 'BOOKED' ? (
                <MenuItem danger onSelect={() => status.mutate('CANCELLED')}>
                  Cancel departure
                </MenuItem>
              ) : (
                <MenuItem onSelect={() => status.mutate('BOOKED')}>Reopen</MenuItem>
              )}
            </Menu>
          </div>
        </div>
      </header>

      <Panel className="grid grid-cols-2 gap-px overflow-hidden bg-line-soft lg:grid-cols-4">
        <div className="flex flex-col gap-2 bg-surface p-5">
          <span className="text-[13px] font-medium text-muted">Seats</span>
          <span className="tnum text-[26px] font-semibold leading-none tracking-[-0.03em]">
            {g.seatsTaken}
            {g.capacity ? <span className="text-lg font-medium text-faint"> / {g.capacity}</span> : null}
          </span>
          {pct !== null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
              <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-warm' : 'bg-accent')} style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 bg-surface p-5">
          <span className="text-[13px] font-medium text-muted">Families</span>
          <span className="tnum text-[26px] font-semibold leading-none tracking-[-0.03em]">{g.families}</span>
          <span className="text-xs text-muted">{missing ? `${missing} traveller${missing === 1 ? '' : 's'} without details` : travellers.length ? 'Everyone’s details are in' : ' '}</span>
        </div>
        <div className="flex flex-col gap-2 bg-surface p-5">
          <span className="text-[13px] font-medium text-muted">Collected</span>
          <span className="tnum text-[26px] font-semibold leading-none tracking-[-0.03em]">{inr(g.collected)}</span>
          <span className="tnum text-xs text-muted">of {inr(g.expected)}</span>
        </div>
        <div className="flex flex-col gap-2 bg-surface p-5">
          <span className="text-[13px] font-medium text-muted">Overdue</span>
          <span className={cn('tnum text-[26px] font-semibold leading-none tracking-[-0.03em]', g.overdue > 0 && 'text-danger')}>{inr(g.overdue)}</span>
          <span className="text-xs text-muted">Reminders go out by themselves</span>
        </div>
      </Panel>

      {!g.bookings.length ? (
        <Panel>
          <EmptyState icon={<Users />} title="Add the first family" action={<Button variant="primary" onClick={() => setAdding(true)}>Add a family</Button>}>
            Each family books its seats and pays on its own, with their own reminders and receipts. You see everyone here.
          </EmptyState>
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-2 sm:px-6">
            <Tabs<Tab>
              label="View"
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'families', label: 'Families', count: active.length },
                { value: 'travellers', label: 'Travellers', count: travellers.length },
              ]}
            />
            {tab === 'travellers' && (
              <div className="mb-2 flex gap-2">
                <Button size="sm" loading={assign.isPending} onClick={() => assign.mutate()}>
                  <BedDouble className="h-4 w-4" />
                  Assign rooms and seats
                </Button>
                <LinkButton size="sm" to={`/groups/${g.id}/manifest`} target="_blank">
                  <Printer className="h-4 w-4" />
                  Passenger list
                </LinkButton>
              </div>
            )}
          </div>
          {tab === 'families' ? (
            <ul className="stagger border-t border-line-soft">
              {g.bookings.map((b) => (
                <li key={b.id} className={cn('relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-1.5 border-t border-line-soft px-5 py-3.5 first:border-0 sm:px-6 lg:grid-cols-[minmax(0,1fr)_70px_110px_190px_240px]', (b.status === 'LOST' || b.status === 'CANCELLED') && 'opacity-55')}>
                  <span className="flex min-w-0 flex-col">
                    <Link to={`/trips/${b.id}`} className="truncate text-sm font-semibold hover:underline">
                      {b.customer.name}
                    </Link>
                    <span className="truncate text-xs text-muted">
                      #{b.number} · {b.adults} adult{b.adults === 1 ? '' : 's'}
                      {b.children ? `, ${b.children} child${b.children === 1 ? '' : 'ren'}` : ''}
                    </span>
                  </span>
                  <span className="tnum hidden text-[13px] text-muted lg:block">{b.seats} seats</span>
                  <span className="justify-self-end lg:justify-self-start">
                    <TripStatusBadge status={b.status} />
                  </span>
                  <span className="tnum flex flex-col text-[13px] lg:items-start">
                    <span className="font-semibold">
                      {inr(b.paid)} <span className="font-normal text-muted">of {inr(b.price)}</span>
                    </span>
                    {b.overdue > 0 ? <span className="text-xs font-semibold text-danger">{inr(b.overdue)} overdue</span> : b.nextDue ? <span className="text-xs text-muted">{inr(b.nextDue.amount)} due {shortDate(b.nextDue.dueDate)}</span> : b.price > 0 && b.balance <= 0 ? <span className="text-xs text-accent-strong">Fully paid</span> : null}
                  </span>
                  <span className="flex items-center justify-end gap-2 text-[13px]">
                    {b.detailsMissing > 0 ? (
                      <>
                        <span className="whitespace-nowrap text-xs text-warm-strong">{b.detailsMissing} to fill in</span>
                        {b.customer.phone && (
                          <TravellerFormLink tripId={b.id} phone={b.customer.phone} name={b.customer.name} title={g.title} />
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-accent-strong">Details in</span>
                    )}
                    <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-hover hover:text-ink" onClick={() => setTravellersOf({ id: b.id, seats: b.seats })}>
                      Edit
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : travellers.length ? (
            <div className="overflow-x-auto border-t border-line-soft">
              <table className="w-full min-w-[820px] text-left text-[13px]">
                <thead className="text-xs text-muted">
                  <tr className="border-b border-line-soft">
                    <th className="px-5 py-2.5 font-medium sm:px-6">Traveller</th>
                    <th className="px-2 py-2.5 font-medium">Family</th>
                    <th className="px-2 py-2.5 font-medium">ID</th>
                    <th className="px-2 py-2.5 font-medium">Food</th>
                    <th className="px-2 py-2.5 font-medium">Needs</th>
                    <th className="w-28 px-2 py-2.5 font-medium">Room</th>
                    <th className="w-28 px-2 py-2.5 pr-5 font-medium sm:pr-6">Seat</th>
                  </tr>
                </thead>
                <tbody>
                  {travellers.map((t) => (
                    <tr key={t.id} className="border-b border-line-soft last:border-0">
                      <td className="px-5 py-2 sm:px-6">
                        <span className="font-medium">{t.name}</span>
                        <span className="text-muted">{t.age !== null ? ` · ${t.age}` : ''}{t.gender ? ` ${GENDER[t.gender]}` : ''}</span>
                      </td>
                      <td className="px-2 py-2 text-muted">{t.family.customer.name}</td>
                      <td className="px-2 py-2 text-muted">{t.idType ? `${ID_LABEL[t.idType]} ••${t.idLast4 ?? ''}` : <span className="text-warm-strong">Missing</span>}</td>
                      <td className="px-2 py-2 text-muted">{t.food ? FOOD[t.food] : ''}</td>
                      <td className="max-w-[180px] truncate px-2 py-2 text-muted" title={t.needs ?? ''}>{t.needs}</td>
                      <td className="px-1 py-1">
                        <InlineCell key={`${t.id}-r-${t.room}`} label={`Room for ${t.name}`} value={t.room} onSave={(v) => saveCell.mutate({ tripId: t.tripId, list: t.family.travellers.map((x) => (x.id === t.id ? { ...x, room: v || null } : x)) })} />
                      </td>
                      <td className="px-1 py-1 pr-4">
                        <InlineCell key={`${t.id}-s-${t.seat}`} label={`Seat for ${t.name}`} value={t.seat} onSave={(v) => saveCell.mutate({ tripId: t.tripId, list: t.family.travellers.map((x) => (x.id === t.id ? { ...x, seat: v || null } : x)) })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="border-t border-line-soft px-6 py-10 text-center text-sm text-muted">No traveller details yet. Send each family their form from the Families tab.</p>
          )}
        </Panel>
      )}

      <GroupDialog
        open={editing}
        group={g}
        onClose={() => setEditing(false)}
        onSaved={(x) => {
          setEditing(false);
          qc.setQueryData(['group', id], x);
          refresh();
        }}
      />
      <AddFamilyDialog
        group={g}
        open={adding}
        onClose={() => {
          setAdding(false);
          if (backToMessage.current) setMessaging(true);
          backToMessage.current = false;
        }}
        onSaved={() => {
          setAdding(false);
          refresh();
          // Came from "Message everyone": go back to the message, now including the new family
          if (backToMessage.current) setMessaging(true);
          backToMessage.current = false;
        }}
      />
      <BroadcastDialog
        group={g}
        open={messaging}
        onClose={() => setMessaging(false)}
        onAddFamily={
          g.status === 'CANCELLED'
            ? undefined
            : () => {
                backToMessage.current = true;
                setMessaging(false);
                setAdding(true);
              }
        }
      />
      {travellersOf && <TravellersSheet tripId={travellersOf.id} seats={travellersOf.seats} open onClose={() => { setTravellersOf(null); refresh(); }} />}
    </>
  );
}

/** WhatsApp the family their details form (the link comes with the trip). */
function TravellerFormLink({ tripId, phone, name, title }: { tripId: string; phone: string; name: string; title: string }) {
  const q = useQuery({ queryKey: ['trip-link', tripId], queryFn: () => api.get<{ trip: { travellersUrl: string } }>(`/api/trips/${tripId}`).then((r) => r.trip.travellersUrl), staleTime: Infinity });
  if (!q.data) return null;
  return (
    <a
      href={waShare(phone, `Hi ${name.split(' ')[0]}, please fill in the traveller details for ${title} here (names as on the ID): ${q.data}`)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-[8px] bg-[#128c4a] px-2 text-xs font-semibold text-white hover:bg-[#0f7a40]"
      aria-label={`Send ${name} the details form on WhatsApp`}
    >
      <MessageCircle className="h-3 w-3" aria-hidden />
      Send form
    </a>
  );
}


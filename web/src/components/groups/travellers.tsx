import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Panel, PanelHeader, Skeleton } from '@/components/ui/display';
import { Field, Input, NativeSelect } from '@/components/ui/field';
import { Sheet } from '@/components/ui/overlay';
import { waShare } from '@/components/trips/payments';
import { api, ApiError } from '@/lib/api';
import { phone as fmtPhone } from '@/lib/format';
import type { Traveller, TripDetail } from '@/lib/types';

export const ID_LABEL: Record<string, string> = { AADHAAR: 'Aadhaar', PASSPORT: 'Passport', VOTER_ID: 'Voter ID', DRIVING_LICENCE: 'Driving licence', PAN: 'PAN', OTHER: 'ID' };
export const FOOD: Record<string, string> = { VEG: 'Veg', NON_VEG: 'Non-veg', JAIN: 'Jain', OTHER: 'Other' };
export const GENDER: Record<string, string> = { F: 'F', M: 'M', O: 'Other' };

export function useTravellers(tripId: string) {
  return useQuery({ queryKey: ['travellers', tripId], queryFn: () => api.get<{ travellers: Traveller[] }>(`/api/trips/${tripId}/travellers`).then((r) => r.travellers) });
}

type Row = Partial<Traveller> & { idNumber?: string; key: number };
let k = 0;

/** Edit a booking's travellers (the agent's side of the same list the family can fill in). */
export function TravellersSheet({ tripId, seats, open, onClose }: { tripId: string; seats: number; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useTravellers(tripId);
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (!open || !q.data) return;
    const have: Row[] = q.data.map((t) => ({ ...t, key: ++k }));
    while (have.length < seats) have.push({ key: ++k, name: '' });
    setRows(have);
  }, [open, q.data, seats]);
  const save = useMutation({
    mutationFn: () =>
      api.put<{ travellers: Traveller[] }>(`/api/trips/${tripId}/travellers`, {
        travellers: rows
          .filter((r) => r.name?.trim())
          .map((r) => ({ id: r.id, name: r.name, age: r.age ?? null, gender: r.gender ?? null, phone: r.phone || null, idType: r.idType || null, idNumber: r.idNumber || null, food: r.food || null, needs: r.needs || null, room: r.room || null, seat: r.seat || null })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['travellers', tripId] });
      qc.invalidateQueries({ queryKey: ['group'] });
      toast.success('Travellers saved');
      onClose();
    },
  });
  const err = (i: number, f: string) => (save.error instanceof ApiError ? save.error.field(`${i}.${f}`) : undefined);
  const set = (key: number, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Travellers"
      description="Names as on their ID, for tickets and check-in. ID numbers are stored encrypted; only the last 4 digits are shown after saving."
      width="max-w-[640px]"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save travellers
          </Button>
        </>
      }
    >
      {!q.data ? (
        <Skeleton className="h-60" />
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((r, i) => (
            <fieldset key={r.key} className="grid grid-cols-2 gap-3 rounded-[14px] border border-line p-4 sm:grid-cols-6">
              <legend className="px-1 text-[13px] font-semibold">Traveller {i + 1}</legend>
              <Field label="Full name" className="col-span-2 sm:col-span-4" error={err(i, 'name')}>
                {(p) => <Input {...p} value={r.name ?? ''} onChange={(e) => set(r.key, { name: e.target.value })} />}
              </Field>
              <Field label="Age">{(p) => <Input {...p} type="number" min={0} max={120} value={r.age ?? ''} onChange={(e) => set(r.key, { age: e.target.value ? Number(e.target.value) : null })} />}</Field>
              <Field label="Gender">
                {(p) => (
                  <NativeSelect {...p} value={r.gender ?? ''} onChange={(e) => set(r.key, { gender: (e.target.value || null) as Row['gender'] })}>
                    <option value="" />
                    <option value="F">Female</option>
                    <option value="M">Male</option>
                    <option value="O">Other</option>
                  </NativeSelect>
                )}
              </Field>
              <Field label="ID type" className="sm:col-span-2">
                {(p) => (
                  <NativeSelect {...p} value={r.idType ?? ''} onChange={(e) => set(r.key, { idType: e.target.value || null })}>
                    <option value="" />
                    {Object.entries(ID_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {v === 'OTHER' ? 'Other' : l}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label="ID number" className="sm:col-span-2" hint={r.idLast4 ? `On file, ending ${r.idLast4}` : undefined} error={err(i, 'idNumber')}>
                {(p) => <Input {...p} autoComplete="off" value={r.idNumber ?? ''} onChange={(e) => set(r.key, { idNumber: e.target.value })} placeholder={r.idLast4 ? 'Leave empty to keep' : ''} />}
              </Field>
              <Field label="Food" className="sm:col-span-2">
                {(p) => (
                  <NativeSelect {...p} value={r.food ?? ''} onChange={(e) => set(r.key, { food: e.target.value || null })}>
                    <option value="" />
                    {Object.entries(FOOD).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label="Needs" className="col-span-2 sm:col-span-4">
                {(p) => <Input {...p} value={r.needs ?? ''} onChange={(e) => set(r.key, { needs: e.target.value })} placeholder="Lower berth, wheelchair…" />}
              </Field>
              <Field label="Room" className="sm:col-span-1">{(p) => <Input {...p} value={r.room ?? ''} onChange={(e) => set(r.key, { room: e.target.value })} />}</Field>
              <Field label="Seat" className="sm:col-span-1">{(p) => <Input {...p} value={r.seat ?? ''} onChange={(e) => set(r.key, { seat: e.target.value })} />}</Field>
              <div className="col-span-2 flex justify-end sm:col-span-6">
                <Button size="sm" variant="danger-ghost" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </Button>
              </div>
            </fieldset>
          ))}
          <Button size="sm" variant="ghost" className="self-start" onClick={() => setRows([...rows, { key: ++k, name: '' }])}>
            <Plus className="h-4 w-4" />
            Add a traveller
          </Button>
        </div>
      )}
    </Sheet>
  );
}

/** On the trip page: who's travelling, and a link the family can fill in themselves. */
export function TravellersPanel({ trip }: { trip: TripDetail }) {
  const q = useTravellers(trip.id);
  const [editing, setEditing] = useState(false);
  const seats = trip.adults + trip.children;
  const list = q.data ?? [];
  const missing = Math.max(0, seats - list.length);
  const first = trip.customer.name.split(' ')[0];
  return (
    <Panel className="flex flex-col gap-4 p-5">
      <PanelHeader
        title="Travellers"
        action={
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        }
      />
      {q.isPending ? (
        <Skeleton className="h-16" />
      ) : list.length ? (
        <ul className="flex flex-col gap-2 text-[13px]">
          {list.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{t.name}</span>
                <span className="truncate text-xs text-muted">
                  {[t.age !== null && `${t.age}${t.gender ? ` ${GENDER[t.gender]}` : ''}`, t.idType && `${ID_LABEL[t.idType]} ••${t.idLast4 ?? ''}`, t.food && FOOD[t.food], t.needs].filter(Boolean).join(' · ') || 'No details yet'}
                </span>
              </span>
              {(t.room || t.seat) && <span className="shrink-0 text-xs text-muted">{[t.room, t.seat].filter(Boolean).join(' · ')}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">No details yet. Send the family the form, or fill it in yourself.</p>
      )}
      {missing > 0 && (
        <div className="flex flex-col gap-2 rounded-[12px] bg-sunken p-3">
          <span className="flex items-center gap-2 text-[13px]">
            <ClipboardList className="h-4 w-4 text-muted" aria-hidden />
            {missing} of {seats} still to fill in
          </span>
          <a
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[9px] bg-[#128c4a] px-3 text-[13px] font-semibold text-white hover:bg-[#0f7a40]"
            href={waShare(trip.customer.phone, `Hi ${first}, please fill in the traveller details for your ${trip.title} here (names as on the ID): ${trip.travellersUrl}`)}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle className="h-3.5 w-3.5" aria-hidden />
            Send them the form
          </a>
        </div>
      )}
      {list.some((t) => t.emergencyPhone) && (
        <p className="text-xs text-muted">
          Emergency contact: {list.find((t) => t.emergencyPhone)!.emergencyName ?? ''} {fmtPhone(list.find((t) => t.emergencyPhone)!.emergencyPhone)}
        </p>
      )}
      <TravellersSheet tripId={trip.id} seats={seats} open={editing} onClose={() => setEditing(false)} />
    </Panel>
  );
}

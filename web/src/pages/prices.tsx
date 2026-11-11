import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BedDouble, Car, MoreHorizontal, Plus, Search, Tag, Ticket, TrainFront } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader, Panel, Skeleton } from '@/components/ui/display';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/field';
import { Menu, MenuItem, Sheet } from '@/components/ui/overlay';
import { KINDS, UNITS } from '@/components/quotes/shared';
import { sanitizeRupees } from '@/components/trips/shared';
import { api, ApiError, qs } from '@/lib/api';
import { inr, rupeesInput } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { RateItem, RateKind, RateUnit } from '@/lib/types';
import { tx } from '../lib/words';

const ICON: Record<RateKind, ReactNode> = {
  HOTEL: <BedDouble className="h-4 w-4" />,
  TRANSPORT: <Car className="h-4 w-4" />,
  ACTIVITY: <Ticket className="h-4 w-4" />,
  TRAVEL: <TrainFront className="h-4 w-4" />,
  OTHER: <Tag className="h-4 w-4" />,
};
const DEFAULT_UNIT: Record<RateKind, RateUnit> = { HOTEL: 'PER_NIGHT', TRANSPORT: 'PER_DAY', ACTIVITY: 'PER_PERSON', TRAVEL: 'PER_PERSON', OTHER: 'PER_GROUP' };

export function useRates(destination?: string) {
  return useQuery({ queryKey: ['rates', destination ?? ''], queryFn: () => api.get<{ rates: RateItem[] }>(`/api/rates${qs({ destination })}`).then((r) => r.rates) });
}

function RateSheet({ rate, open, onClose }: { rate: RateItem | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ kind: 'HOTEL' as RateKind, name: '', destination: '', unit: 'PER_NIGHT' as RateUnit, price: '', cost: '', notes: '' });
  useEffect(() => {
    if (!open) return;
    setF(
      rate
        ? { kind: rate.kind, name: rate.name, destination: rate.destination ?? '', unit: rate.unit, price: rupeesInput(rate.price), cost: rupeesInput(rate.cost), notes: rate.notes ?? '' }
        : { kind: 'HOTEL', name: '', destination: '', unit: 'PER_NIGHT', price: '', cost: '', notes: '' },
    );
  }, [open, rate]);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, destination: f.destination || null, cost: f.cost || null, notes: f.notes || null, price: f.price || 'x' };
      return rate ? api.patch(`/api/rates/${rate.id}`, body) : api.post('/api/rates', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rates'] });
      toast.success(rate ? 'Price saved' : 'Added to your price list');
      onClose();
    },
  });
  const err = (k: string) => (save.error instanceof ApiError ? save.error.field(k) : undefined);
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={rate ? 'Edit price' : 'Add a price'}
      description="What you charge customers. Quotes copy the price when you add it, so changing it later never changes a quote you’ve sent."
      width="max-w-[520px]"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {rate ? 'Save' : 'Add price'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Type">
            {(p) => (
              <NativeSelect {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as RateKind, unit: DEFAULT_UNIT[e.target.value as RateKind] })}>
                {Object.entries(KINDS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Charged">
            {(p) => (
              <NativeSelect {...p} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as RateUnit })}>
                {Object.entries(UNITS).map(([k, u]) => (
                  <option key={k} value={k}>
                    {u.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>
        <Field label="Name" error={err('name')}>
          {(p) => <Input {...p} autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.kind === 'HOTEL' ? 'Houseboat, deluxe room' : f.kind === 'TRANSPORT' ? 'Innova Crysta with driver' : 'Kathakali show'} />}
        </Field>
        <Field label={tx("Destination")} hint="Where it applies. Quotes for that place show it first." error={err('destination')}>
          {(p) => <Input {...p} value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} placeholder="Kerala" />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Price to customer" error={err('price')}>
            {(p) => <Input {...p} inputMode="decimal" leading={<span className="text-sm">₹</span>} value={f.price} onChange={(e) => setF({ ...f, price: sanitizeRupees(e.target.value) })} placeholder="9,500" />}
          </Field>
          <Field label="Your cost" hint="Private. Shows your margin on quotes." error={err('cost')}>
            {(p) => <Input {...p} inputMode="decimal" leading={<span className="text-sm">₹</span>} value={f.cost} onChange={(e) => setF({ ...f, cost: sanitizeRupees(e.target.value) })} placeholder="7,000" />}
          </Field>
        </div>
        <Field label="Notes" error={err('notes')}>
          {(p) => <Textarea {...p} rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Peak season Dec 20 – Jan 5: +20%" />}
        </Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

export function PricesPage() {
  const qc = useQueryClient();
  const { user } = useSession();
  const q = useRates();
  const [term, setTerm] = useState('');
  const [editing, setEditing] = useState<RateItem | null>(null);
  const [open, setOpen] = useState(false);
  const archive = useMutation({
    mutationFn: (r: RateItem) => api.del(`/api/rates/${r.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rates'] });
      toast.success('Removed from your price list');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const groups = useMemo(() => {
    const t = term.trim().toLowerCase();
    const rows = (q.data ?? []).filter((r) => !t || r.name.toLowerCase().includes(t) || (r.destination ?? '').toLowerCase().includes(t));
    const m = new Map<string, RateItem[]>();
    for (const r of rows) m.set(r.destination || 'Anywhere', [...(m.get(r.destination || 'Anywhere') ?? []), r]);
    return [...m.entries()];
  }, [q.data, term]);

  return (
    <>
      <PageHeader
        back={
          <Link to="/trips" className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-muted hover:text-ink">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {tx("Trips")}
          </Link>
        }
        title="Price list"
        description="Your hotels, vehicles and activities with what you charge. Quotes pick from here, and so does Draft with AI, so prices are always yours."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Add a price
          </Button>
        }
      />
      {q.isPending ? (
        <Skeleton className="h-72 rounded-[var(--radius-panel)]" />
      ) : !q.data?.length ? (
        <Panel>
          <EmptyState icon={<Tag />} title="Add the prices you quote most" action={<Button variant="primary" onClick={() => setOpen(true)}>Add a price</Button>}>
            A houseboat night, a car for the day, a darshan ticket. Once they’re here, a quote takes minutes instead of an hour on the calculator.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <div className="w-full sm:w-72">
            <Input aria-label="Search prices" leading={<Search className="h-4 w-4" />} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search name or place" />
          </div>
          {groups.map(([dest, rows]) => (
            <Panel key={dest} className="overflow-hidden">
              <h2 className="border-b border-line-soft px-5 py-3 text-[13px] font-semibold sm:px-6">{dest}</h2>
              <ul className="stagger">
                {rows.map((r) => (
                  <li key={r.id} className="grid grid-cols-[32px_minmax(0,1fr)_auto_32px] items-center gap-x-3 border-t border-line-soft px-5 py-3 first:border-0 sm:grid-cols-[32px_minmax(0,1fr)_170px_110px_110px_32px] sm:px-6">
                    <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-sunken text-muted" title={KINDS[r.kind]}>
                      {ICON[r.kind]}
                    </span>
                    <button type="button" className="flex min-w-0 flex-col text-left" onClick={() => { setEditing(r); setOpen(true); }}>
                      <span className="truncate text-sm font-medium hover:underline">{r.name}</span>
                      <span className="truncate text-xs text-muted sm:hidden">{UNITS[r.unit].label}</span>
                      {r.notes && <span className="hidden truncate text-xs text-muted sm:block">{r.notes}</span>}
                    </button>
                    <span className="hidden text-[13px] text-muted sm:block">{UNITS[r.unit].label}</span>
                    <span className="tnum text-right text-sm font-semibold">{inr(r.price)}</span>
                    <span className="tnum hidden text-right text-xs text-muted sm:block">{r.cost !== null ? `cost ${inr(r.cost)}` : ''}</span>
                    {user.role !== 'MEMBER' ? (
                      <Menu trigger={<button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-hover" aria-label={`Options for ${r.name}`}><MoreHorizontal className="h-4 w-4" /></button>}>
                        <MenuItem onSelect={() => { setEditing(r); setOpen(true); }}>Edit</MenuItem>
                        <MenuItem danger onSelect={() => archive.mutate(r)}>Remove</MenuItem>
                      </Menu>
                    ) : (
                      <span />
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </>
      )}
      <RateSheet rate={editing} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

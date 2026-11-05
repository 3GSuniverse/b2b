import { useMutation, useQuery } from '@tanstack/react-query';
import { Mail, Phone, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Segmented, Switch } from '@/components/ui/controls';
import { Avatar } from '@/components/ui/display';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/field';
import { Sheet } from '@/components/ui/overlay';
import { api, ApiError, qs } from '@/lib/api';
import { inr, phone as fmtPhone, rupeesInput } from '@/lib/format';
import { PackageSelect, usePackages } from '@/components/packages/package-sheet';
import type { Contact, TripDetail, TripSource } from '@/lib/types';
import { SOURCES, sanitizeRupees, useTeam } from './shared';

type Picked = { id: string; name: string; phone: string | null; email: string | null };

function contactName(c: Contact) {
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || fmtPhone(c.phone) || 'Contact';
}

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function ContactPicker({ value, onChange, error }: { value: Picked | null; onChange: (c: Picked | null) => void; error?: string }) {
  const [term, setTerm] = useState('');
  const search = useDebounced(term);
  const q = useQuery({
    queryKey: ['contacts', 'pick', search],
    queryFn: () => api.get<{ contacts: Contact[] }>(`/api/contacts${qs({ search, pageSize: 6 })}`),
    enabled: search.trim().length >= 2,
  });
  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-[12px] border border-line bg-sunken px-3 py-2.5">
        <Avatar name={value.name} email={value.email} size={32} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">{value.name}</span>
          <span className="truncate text-xs text-muted">{[fmtPhone(value.phone), value.email].filter(Boolean).join(' · ')}</span>
        </div>
        <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-ink" aria-label="Choose someone else" onClick={() => onChange(null)}>
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }
  const results = q.data?.contacts ?? [];
  return (
    <Field label="Find a customer" hint="Search by name, phone or email." error={error}>
      {(p) => (
        <div className="flex flex-col gap-1.5">
          <Input {...p} autoFocus leading={<Search className="h-4 w-4" />} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Lakshmi, 98480…" />
          {search.trim().length >= 2 && (
            <ul className="flex flex-col overflow-hidden rounded-[12px] border border-line" role="listbox" aria-label="Matching customers">
              {q.isPending && <li className="px-3 py-2.5 text-[13px] text-muted">Searching…</li>}
              {!q.isPending && !results.length && <li className="px-3 py-2.5 text-[13px] text-muted">No one matches “{search}”.</li>}
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="flex w-full items-center gap-3 border-t border-line-soft px-3 py-2 text-left first:border-0 hover:bg-hover"
                    onClick={() => onChange({ id: c.id, name: contactName(c), phone: c.phone, email: c.email })}
                  >
                    <Avatar name={contactName(c)} email={c.email} size={28} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] font-semibold">{contactName(c)}</span>
                      <span className="truncate text-xs text-muted">{[fmtPhone(c.phone), c.email].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
}

interface TripFields {
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  adults: string;
  children: string;
  budget: string;
  price: string;
  source: TripSource | '';
  notes: string;
  assignedToId: string;
  packageId: string;
}

function TripFieldsForm({ f, setF, err, showPrice }: { f: TripFields; setF: (f: TripFields) => void; err: (k: string) => string | undefined; showPrice: boolean }) {
  const team = useTeam();
  const packages = usePackages();
  const picked = packages.data?.find((p) => p.id === f.packageId);
  return (
    <>
      {(packages.data?.length ?? 0) > 0 && (
        <Field
          label="Package"
          hint={picked ? `${picked.nights}N/${picked.nights + 1}D · ${inr(picked.pricePerAdult)} per adult${picked.pricePerChild !== null ? `, ${inr(picked.pricePerChild)} per child` : ''}. The price and return date fill in.` : 'Or leave it as a custom trip.'}
          error={err('packageId')}
        >
          {(p) => (
            <PackageSelect
              {...p}
              value={f.packageId}
              onChange={(id, pkg) => {
                const adults = Number(f.adults || 0);
                const children = Number(f.children || 0);
                setF({
                  ...f,
                  packageId: id,
                  destination: f.destination || pkg?.destination || '',
                  endDate: pkg && f.startDate && !f.endDate ? addDaysIso(f.startDate, pkg.nights) : f.endDate,
                  // In the edit form the price box is shown: fill it with the package price for this party
                  price: pkg ? rupeesInput(adults * pkg.pricePerAdult + children * (pkg.pricePerChild ?? pkg.pricePerAdult)) : f.price,
                });
              }}
            />
          )}
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Destination" error={err('destination')}>
          {(p) => <Input {...p} value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} placeholder="Kashmir" />}
        </Field>
        <Field label="Trip name" hint={f.title ? undefined : `Leave empty for “${f.destination ? `${f.destination} trip` : 'Trip for …'}”`} error={err('title')}>
          {(p) => <Input {...p} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Family trip, Dec" />}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Leaving on" error={err('startDate')}>
          {(p) => <Input {...p} type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value, endDate: f.endDate && f.endDate < e.target.value ? '' : f.endDate })} />}
        </Field>
        <Field label="Back on" error={err('endDate')}>
          {(p) => <Input {...p} type="date" min={f.startDate || undefined} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Adults" error={err('adults')}>
          {(p) => <Input {...p} type="number" min={0} max={500} inputMode="numeric" value={f.adults} onChange={(e) => setF({ ...f, adults: e.target.value })} />}
        </Field>
        <Field label="Children" error={err('children')}>
          {(p) => <Input {...p} type="number" min={0} max={500} inputMode="numeric" value={f.children} onChange={(e) => setF({ ...f, children: e.target.value })} />}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Their budget" hint="What the customer said they can spend." error={err('budget')}>
          {(p) => <Input {...p} inputMode="decimal" leading={<span className="text-sm">₹</span>} value={f.budget} onChange={(e) => setF({ ...f, budget: sanitizeRupees(e.target.value) })} placeholder="80,000" />}
        </Field>
        {showPrice ? (
          <Field label="Agreed price" hint="The total the customer pays." error={err('price')}>
            {(p) => <Input {...p} inputMode="decimal" leading={<span className="text-sm">₹</span>} value={f.price} onChange={(e) => setF({ ...f, price: sanitizeRupees(e.target.value) })} placeholder="76,500" />}
          </Field>
        ) : (
          <Field label="How they reached you" error={err('source')}>
            {(p) => (
              <NativeSelect {...p} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value as TripSource | '' })}>
                <option value="">Not recorded</option>
                {Object.entries(SOURCES).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        )}
      </div>
      {showPrice && (
        <Field label="How they reached you" error={err('source')}>
          {(p) => (
            <NativeSelect {...p} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value as TripSource | '' })}>
              <option value="">Not recorded</option>
              {Object.entries(SOURCES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      )}
      {(team.data?.length ?? 0) > 1 && (
        <Field label="Handled by" error={err('assignedToId')}>
          {(p) => (
            <NativeSelect {...p} value={f.assignedToId} onChange={(e) => setF({ ...f, assignedToId: e.target.value })}>
              {team.data!.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      )}
      <Field label="Notes" hint="Hotel preferences, food, anything to remember." error={err('notes')}>
        {(p) => <Textarea {...p} rows={4} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Wants a houseboat night. Senior citizen in the group." />}
      </Field>
    </>
  );
}

const nonEmpty = (v: string) => (v.trim() ? v.trim() : null);
function addDaysIso(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fieldsPayload(f: TripFields) {
  return {
    title: nonEmpty(f.title) ?? undefined,
    destination: nonEmpty(f.destination),
    startDate: f.startDate || null,
    endDate: f.endDate || null,
    adults: f.adults === '' ? undefined : Number(f.adults),
    children: f.children === '' ? undefined : Number(f.children),
    budget: f.budget.trim() || null,
    source: f.source || null,
    notes: nonEmpty(f.notes),
    packageId: f.packageId || null,
    ...(f.assignedToId ? { assignedToId: f.assignedToId } : {}),
  };
}

const BLANK: TripFields = { title: '', destination: '', startDate: '', endDate: '', adults: '2', children: '0', budget: '', price: '', source: '', notes: '', assignedToId: '', packageId: '' };

/** "New enquiry": a customer (new or from Contacts) and what they asked for. */
export function NewTripSheet({ open, onClose, onCreated, contact }: { open: boolean; onClose: () => void; onCreated: (t: TripDetail) => void; contact?: Picked | null }) {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [cust, setCust] = useState({ name: '', phone: '', email: '', whatsappOptIn: false });
  const [f, setF] = useState<TripFields>(BLANK);
  useEffect(() => {
    if (!open) return;
    setMode(contact ? 'existing' : 'new');
    setPicked(contact ?? null);
    setCust({ name: '', phone: '', email: '', whatsappOptIn: false });
    setF(BLANK);
  }, [open, contact]);

  const m = useMutation({
    mutationFn: () =>
      api.post<{ trip: TripDetail }>('/api/trips', {
        customer:
          mode === 'existing'
            ? { contactId: picked?.id ?? '' }
            : { name: cust.name, phone: cust.phone || undefined, email: cust.email || undefined, whatsappOptIn: cust.whatsappOptIn },
        ...fieldsPayload(f),
      }),
    onSuccess: ({ trip }) => {
      toast.success(`Enquiry #${trip.number} added`);
      onCreated(trip);
    },
  });
  const err = (k: string) => (m.error instanceof ApiError ? m.error.field(k) : undefined);
  const general = m.error && !(m.error instanceof ApiError && m.error.details?.fields) ? m.error.message : null;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="New enquiry"
      description="Who asked, and what they’re looking for. You can add the price and payments after."
      width="max-w-[560px]"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Add enquiry
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        {general && (
          <div role="alert" className="rounded-[12px] border border-[#f4c7c2] bg-danger-soft px-4 py-3 text-sm text-danger">
            {general}
          </div>
        )}
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[13px] font-semibold">Customer</h3>
            <Segmented
              size="sm"
              label="Customer"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'new', label: 'New customer' },
                { value: 'existing', label: 'From customers' },
              ]}
            />
          </div>
          {mode === 'existing' ? (
            <ContactPicker value={picked} onChange={setPicked} error={err('customer.contactId')} />
          ) : (
            <>
              <Field label="Name" error={err('customer.name')}>
                {(p) => <Input {...p} autoFocus value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} placeholder="Lakshmi Prasad" />}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Phone" error={err('customer.phone')}>
                  {(p) => <Input {...p} inputMode="tel" leading={<Phone className="h-4 w-4" />} value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} placeholder="98480 22338" />}
                </Field>
                <Field label="Email" error={err('customer.email')}>
                  {(p) => <Input {...p} type="email" leading={<Mail className="h-4 w-4" />} value={cust.email} onChange={(e) => setCust({ ...cust, email: e.target.value })} placeholder="Optional" />}
                </Field>
              </div>
              <label className="flex items-center justify-between gap-4 rounded-[12px] bg-sunken px-4 py-3 text-sm">
                <span className="flex flex-col">
                  <span className="font-medium">Agreed to WhatsApp messages</span>
                  <span className="text-xs text-muted">Offers and updates on WhatsApp. If they’re already a customer, nothing else about them changes.</span>
                </span>
                <Switch label="Agreed to WhatsApp messages" checked={cust.whatsappOptIn} disabled={!cust.phone} onCheckedChange={(v) => setCust({ ...cust, whatsappOptIn: v })} />
              </label>
            </>
          )}
        </section>
        <div className="h-px bg-line-soft" />
        <section className="flex flex-col gap-4">
          <h3 className="text-[13px] font-semibold">The trip</h3>
          <TripFieldsForm f={f} setF={setF} err={err} showPrice={false} />
        </section>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/** Edit an existing trip's details. */
export function EditTripSheet({ trip, open, onClose, onSaved }: { trip: TripDetail; open: boolean; onClose: () => void; onSaved: (t: TripDetail) => void }) {
  const [f, setF] = useState<TripFields>(BLANK);
  useEffect(() => {
    if (!open) return;
    setF({
      title: trip.title,
      destination: trip.destination ?? '',
      startDate: trip.startDate ?? '',
      endDate: trip.endDate ?? '',
      adults: String(trip.adults),
      children: String(trip.children),
      budget: rupeesInput(trip.budget),
      price: rupeesInput(trip.price),
      source: trip.source ?? '',
      notes: trip.notes ?? '',
      assignedToId: trip.assignedTo?.id ?? '',
      packageId: trip.package?.id ?? '',
    });
  }, [open, trip]);
  const m = useMutation({
    mutationFn: () => api.patch<{ trip: TripDetail }>(`/api/trips/${trip.id}`, { ...fieldsPayload(f), title: f.title.trim() || trip.title, price: f.price.trim() || '0' }),
    onSuccess: ({ trip: t }) => {
      toast.success('Trip saved');
      onSaved(t);
    },
  });
  const err = (k: string) => (m.error instanceof ApiError ? m.error.field(k) : undefined);
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={`Edit #${trip.number}`}
      width="max-w-[560px]"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Save changes
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <TripFieldsForm f={f} setF={setF} err={err} showPrice />
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

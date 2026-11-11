import { useMutation } from '@tanstack/react-query';
import { Mail, Phone, UserPlus } from 'lucide-react';
import { AttachmentPicker, MAX_EMAIL_BYTES } from '@/components/attachments/attachments';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/controls';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/field';
import { Dialog } from '@/components/ui/overlay';
import { sanitizeRupees } from '@/components/trips/shared';
import { PackageSelect } from '@/components/packages/package-sheet';
import { api, ApiError } from '@/lib/api';
import { inr, rupeesInput } from '@/lib/format';
import type { Attachment, GroupDetail } from '@/lib/types';
import { takeoff } from '@/lib/celebrate';
import { tx } from '../../lib/words';

const errOf = (e: unknown, k: string) => (e instanceof ApiError ? e.field(k) : undefined);

/** New departure, or edit one. */
export function GroupDialog({ open, onClose, onSaved, group }: { open: boolean; onClose: () => void; onSaved: (g: GroupDetail) => void; group?: GroupDetail | null }) {
  const [f, setF] = useState({ title: '', destination: '', startDate: '', endDate: '', capacity: '', perPersonPrice: '', notes: '', packageId: '' });
  useEffect(() => {
    if (!open) return;
    setF(
      group
        ? { title: group.title, destination: group.destination ?? '', startDate: group.startDate ?? '', endDate: group.endDate ?? '', capacity: group.capacity ? String(group.capacity) : '', perPersonPrice: rupeesInput(group.perPersonPrice), notes: group.notes ?? '', packageId: group.packageId ?? '' }
        : { title: '', destination: '', startDate: '', endDate: '', capacity: '', perPersonPrice: '', notes: '', packageId: '' },
    );
  }, [open, group]);
  const m = useMutation({
    mutationFn: () => {
      const body = { title: f.title, destination: f.destination || null, startDate: f.startDate || null, endDate: f.endDate || null, capacity: f.capacity ? Number(f.capacity) : null, perPersonPrice: f.perPersonPrice || null, notes: f.notes || null, packageId: f.packageId || null };
      return group ? api.patch<{ group: GroupDetail }>(`/api/groups/${group.id}`, body) : api.post<{ group: GroupDetail }>('/api/groups', body);
    },
    onSuccess: ({ group: g }) => {
      toast.success(group ? 'Departure saved' : 'Departure created');
      onSaved(g);
    },
  });
  const err = (k: string) => errOf(m.error, k);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={group ? 'Edit departure' : 'New group departure'}
      description={group ? tx('New dates and destination apply to every family’s booking.') : 'A yatra or group tour with fixed dates. Families book seats on it, and each family pays and gets reminders on their own.'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            {group ? 'Save' : 'Create departure'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" error={err('title')}>
          {(p) => <Input {...p} autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Char Dham Yatra, May 2027" />}
        </Field>
        <Field label={tx("Package")} hint={tx("Optional. Fills in the destination, return date and price per person.")} error={err('packageId')}>
          {(p) => (
            <PackageSelect
              {...p}
              value={f.packageId}
              onChange={(id, pkg) =>
                setF({ ...f, packageId: id, title: f.title || pkg?.name || '', destination: f.destination || pkg?.destination || '', perPersonPrice: pkg ? rupeesInput(pkg.pricePerAdult) : f.perPersonPrice })
              }
            />
          )}
        </Field>
        <Field label={tx("Destination")} error={err('destination')}>
          {(p) => <Input {...p} value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} placeholder="Uttarakhand" />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Leaving on" error={err('startDate')}>
            {(p) => <Input {...p} type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />}
          </Field>
          <Field label="Back on" error={err('endDate')}>
            {(p) => <Input {...p} type="date" min={f.startDate || undefined} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Seats" hint="Leave empty for no limit." error={err('capacity')}>
            {(p) => <Input {...p} type="number" min={1} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} placeholder="45" />}
          </Field>
          <Field label="Price per person" error={err('perPersonPrice')}>
            {(p) => <Input {...p} inputMode="decimal" leading={<span className="text-sm">₹</span>} value={f.perPersonPrice} onChange={(e) => setF({ ...f, perPersonPrice: sanitizeRupees(e.target.value) })} placeholder="45,000" />}
          </Field>
        </div>
        <Field label="Notes" error={err('notes')}>
          {(p) => <Textarea {...p} rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Bus from Secunderabad. Helicopter for Kedarnath booked separately." />}
        </Field>
      </div>
    </Dialog>
  );
}

/** A family books seats on the departure. */
export function AddFamilyDialog({ group, open, onClose, onSaved }: { group: GroupDetail; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', adults: '2', children: '0', status: 'BOOKED' as 'BOOKED' | 'ENQUIRY' });
  useEffect(() => {
    if (open) setF({ name: '', phone: '', email: '', adults: '2', children: '0', status: 'BOOKED' });
  }, [open]);
  const seats = Number(f.adults || 0) + Number(f.children || 0);
  const left = group.capacity ? group.capacity - group.seatsTaken : null;
  const m = useMutation({
    mutationFn: () => api.post(`/api/groups/${group.id}/bookings`, { customer: { name: f.name, phone: f.phone || undefined, email: f.email || undefined }, adults: Number(f.adults), children: Number(f.children || 0), status: f.status }),
    onSuccess: () => {
      toast.success(`${f.name.split(' ')[0] || 'Family'} added to ${group.title}`);
      onSaved();
    },
  });
  const err = (k: string) => errOf(m.error, k);
  const general = m.error && !(m.error instanceof ApiError && m.error.details?.fields) ? m.error.message : null;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Add a family"
      description={left !== null ? `${left} seat${left === 1 ? '' : 's'} left.` : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Add{group.perPersonPrice && seats ? ` · ${inr(group.perPersonPrice * seats)}` : ''}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {general && <p className="rounded-[12px] bg-danger-soft px-4 py-3 text-sm text-danger">{general}</p>}
        <Field label="Who’s booking" error={err('customer.name')}>
          {(p) => <Input {...p} autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Kavya Kumar" />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" error={err('customer.phone')}>
            {(p) => <Input {...p} inputMode="tel" leading={<Phone className="h-4 w-4" />} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}
          </Field>
          <Field label="Email" error={err('customer.email')}>
            {(p) => <Input {...p} type="email" leading={<Mail className="h-4 w-4" />} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Optional" />}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Adults" error={err('adults')}>
            {(p) => <Input {...p} type="number" min={1} value={f.adults} onChange={(e) => setF({ ...f, adults: e.target.value })} />}
          </Field>
          <Field label="Children" error={err('children')}>
            {(p) => <Input {...p} type="number" min={0} value={f.children} onChange={(e) => setF({ ...f, children: e.target.value })} />}
          </Field>
        </div>
        <Segmented
          label="Status"
          value={f.status}
          onChange={(v) => setF({ ...f, status: v })}
          options={[
            { value: 'BOOKED', label: 'Confirmed' },
            { value: 'ENQUIRY', label: 'Just asking' },
          ]}
        />
      </div>
    </Dialog>
  );
}

const PRESETS = [
  'Reminder: the bus leaves at 5:30 AM on {date} from Secunderabad station, gate 2. Please be there by 5:00.',
  tx('Please carry an original photo ID for every traveller, warm clothes, and any medicines you need.'),
  'Weather update: roads are clear and we’re on schedule. See you soon!',
];

/** One message to every family on the departure, with files if needed (bus timings, the hotel list). */
export function BroadcastDialog({ group, open, onClose, onAddFamily }: { group: GroupDetail; open: boolean; onClose: () => void; onAddFamily?: () => void }) {
  // Kept while the dialog is closed to add a family, cleared once the message goes
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [channel, setChannel] = useState<'AUTO' | 'WHATSAPP' | 'EMAIL'>('AUTO');
  const families = group.bookings.filter((b) => b.status === 'BOOKED' || b.status === 'QUOTED').length;
  const tooBigForEmail = files.reduce((a, f) => a + f.size, 0) > MAX_EMAIL_BYTES;
  const m = useMutation({
    mutationFn: () => api.post<{ whatsapp: number; email: number; skipped: string[] }>(`/api/groups/${group.id}/broadcast`, { text, channel, attachments: files.map((f) => f.id) }),
    onSuccess: (r) => {
      const n = r.whatsapp + r.email;
      if (n > 0) takeoff();
      toast.success(`Sent to ${n} famil${n === 1 ? 'y' : 'ies'}`, { description: r.skipped.length ? `Couldn’t reach ${r.skipped.join(', ')}. Call them.` : undefined, duration: r.skipped.length ? 12_000 : 4000 });
      setText('');
      setFiles([]);
      onClose();
    },
  });
  const date = group.startDate ? new Date(`${group.startDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'the day';
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Message everyone"
      description={`Goes to the person who booked, for each of the ${families} confirmed famil${families === 1 ? 'y' : 'ies'}.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={(!text.trim() && !files.length) || !families || (channel === 'EMAIL' && tooBigForEmail)} onClick={() => m.mutate()}>
            Send to {families} famil{families === 1 ? 'y' : 'ies'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Message" error={errOf(m.error, 'text') ?? (m.error && !(m.error instanceof ApiError && m.error.details?.fields) ? m.error.message : undefined)}>
          {(p) => <Textarea {...p} autoFocus rows={5} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((x) => (
            <button key={x} type="button" onClick={() => setText(x.replace('{date}', date))} className="rounded-full border border-line px-2.5 py-1 text-left text-xs text-ink-2 hover:bg-hover">
              {x.length > 48 ? `${x.slice(0, 46)}…` : x}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold">Files</span>
          <AttachmentPicker channel={channel === 'AUTO' ? 'BOTH' : channel} value={files} onChange={setFiles} />
          {channel === 'AUTO' && tooBigForEmail && <p className="text-xs text-muted">Families without WhatsApp can’t get files this large by email; they’ll be listed so you can call them.</p>}
        </div>
        <Field label="Send by">
          {(p) => (
            <NativeSelect {...p} value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
              <option value="AUTO">WhatsApp if linked, else email</option>
              <option value="WHATSAPP">WhatsApp only</option>
              <option value="EMAIL">Email only</option>
            </NativeSelect>
          )}
        </Field>
        {onAddFamily && (
          <button type="button" onClick={onAddFamily} className="group flex items-center gap-3 rounded-[12px] border border-dashed border-line px-3.5 py-2.5 text-left hover:border-accent/50 hover:bg-accent-soft/30">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent transition-transform group-hover:scale-110">
              <UserPlus className="h-4 w-4" />
            </span>
            <span className="flex flex-col">
              <span className="text-[13px] font-semibold">Someone missing? Add a family</span>
              <span className="text-xs text-muted">Your message stays here; it goes to them too.</span>
            </span>
          </button>
        )}
      </div>
    </Dialog>
  );
}

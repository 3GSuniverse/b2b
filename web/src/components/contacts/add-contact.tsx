import { useMutation } from '@tanstack/react-query';
import { Mail, Phone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox, Switch } from '@/components/ui/controls';
import { Field, Input } from '@/components/ui/field';
import { Sheet } from '@/components/ui/overlay';
import { api, ApiError } from '@/lib/api';
import type { Contact, ContactList } from '@/lib/types';
import { AttributeInput, useFields } from './contact-sheet';

const EMPTY = { email: '', phone: '', firstName: '', lastName: '', consentNote: '', whatsappOptIn: false, listIds: [] as string[], attributes: {} as Record<string, unknown> };

export function AddContactSheet({ open, onClose, lists, onCreated }: { open: boolean; onClose: () => void; lists: ContactList[]; onCreated: (c: Contact) => void }) {
  const [f, setF] = useState(EMPTY);
  const fields = useFields();
  useEffect(() => {
    if (open) setF(EMPTY);
  }, [open]);

  const m = useMutation({
    mutationFn: () =>
      api.post<{ contact: Contact }>('/api/contacts', {
        ...f,
        email: f.email || undefined,
        phone: f.phone || undefined,
        firstName: f.firstName || undefined,
        lastName: f.lastName || undefined,
        consentNote: f.consentNote || undefined,
        attributes: Object.fromEntries(Object.entries(f.attributes).filter(([, v]) => v !== null && v !== '')),
      }),
    onSuccess: ({ contact }) => {
      toast.success('Customer added');
      onCreated(contact);
    },
  });
  const err = (k: string) => (m.error instanceof ApiError ? m.error.field(k) : undefined);
  const general = m.error && !(m.error instanceof ApiError && m.error.details?.fields) ? m.error.message : null;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Add a customer"
      description="For one or two people. For more, import a CSV."
      width="max-w-[520px]"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Add contact
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
        <div className="grid grid-cols-2 gap-4">
          <Field label="First name" error={err('firstName')}>
            {(p) => <Input {...p} autoFocus value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />}
          </Field>
          <Field label="Last name" error={err('lastName')}>
            {(p) => <Input {...p} value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />}
          </Field>
        </div>
        <Field label="Email" error={err('email')}>
          {(p) => <Input {...p} type="email" leading={<Mail className="h-4 w-4" />} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@example.com" />}
        </Field>
        <Field label="Phone" hint="Optional. Indian numbers get +91 automatically." error={err('phone')}>
          {(p) => <Input {...p} inputMode="tel" leading={<Phone className="h-4 w-4" />} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="98480 22338" />}
        </Field>

        {(fields.data?.fields.length ?? 0) > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.data!.fields.map((cf) => (
              <Field key={cf.id} label={cf.label} error={err(cf.key)}>
                {(p) => <AttributeInput {...p} field={cf} value={f.attributes[cf.key]} onChange={(v) => setF({ ...f, attributes: { ...f.attributes, [cf.key]: v } })} />}
              </Field>
            ))}
          </div>
        )}

        {lists.length > 0 && (
          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-2 text-[13px] font-semibold">Add to lists</legend>
            {lists.map((l) => (
              <label key={l.id} className="flex cursor-pointer items-center gap-3 text-sm">
                <Checkbox
                  label={l.name}
                  checked={f.listIds.includes(l.id)}
                  onCheckedChange={(v) => setF({ ...f, listIds: v ? [...f.listIds, l.id] : f.listIds.filter((x) => x !== l.id) })}
                />
                {l.name}
              </label>
            ))}
          </fieldset>
        )}

        <Field label="How did they agree to hear from you?" hint="Kept as their consent record, for example “Booking form, Goa trip, Oct 2026”." error={err('consentNote')}>
          {(p) => <Input {...p} value={f.consentNote} onChange={(e) => setF({ ...f, consentNote: e.target.value })} />}
        </Field>
        <label className="flex items-center justify-between gap-4 rounded-[12px] bg-sunken px-4 py-3 text-sm">
          <span className="flex flex-col">
            <span className="font-medium">Also agreed to WhatsApp messages</span>
            <span className="text-xs text-muted">Needs a phone number.</span>
          </span>
          <Switch label="Also agreed to WhatsApp messages" checked={f.whatsappOptIn} disabled={!f.phone} onCheckedChange={(v) => setF({ ...f, whatsappOptIn: v })} />
        </label>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

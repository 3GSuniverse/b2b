import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, MessageCircle, Phone, ShieldAlert, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/controls';
import { Avatar, Badge, CopyButton, Skeleton } from '@/components/ui/display';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Dialog, Sheet } from '@/components/ui/overlay';
import { api, ApiError } from '@/lib/api';
import { date, dateTime, phone as formatPhone } from '@/lib/format';
import { SubscriptionBadge } from '@/lib/status';
import type { Contact, ContactList, CustomField } from '@/lib/types';

export function useFields() {
  return useQuery({ queryKey: ['fields'], queryFn: () => api.get<{ fields: CustomField[] }>('/api/fields'), staleTime: 60_000 });
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-line-soft pt-6 first:border-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-muted">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Input that matches a custom field's type. Dates use the native picker. */
export function AttributeInput({ field, value, onChange, id, ...aria }: { field: CustomField; value: unknown; onChange: (v: string | boolean | null) => void; id: string }) {
  if (field.type === 'BOOLEAN') {
    return <Switch label={field.label} checked={value === true || value === 'true'} onCheckedChange={onChange} />;
  }
  return (
    <Input
      id={id}
      {...aria}
      type={field.type === 'DATE' ? 'date' : field.type === 'NUMBER' ? 'number' : 'text'}
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
    />
  );
}

interface Draft {
  firstName: string;
  lastName: string;
  phone: string;
  attributes: Record<string, unknown>;
  whatsappOptIn: boolean;
}

const toDraft = (c: Contact): Draft => ({
  firstName: c.firstName ?? '',
  lastName: c.lastName ?? '',
  phone: formatPhone(c.phone),
  attributes: { ...c.attributes },
  whatsappOptIn: c.whatsappStatus === 'SUBSCRIBED',
});

export function ContactSheet({ id, onClose, onChanged, lists }: { id: string | null; onClose: () => void; onChanged: () => void; lists: ContactList[] }) {
  const qc = useQueryClient();
  const fields = useFields();
  const q = useQuery({ queryKey: ['contact', id], queryFn: () => api.get<{ contact: Contact }>(`/api/contacts/${id}`), enabled: !!id });
  const c = q.data?.contact;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [resub, setResub] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (c) setDraft(toDraft(c));
  }, [c]);
  useEffect(() => {
    if (!id) {
      setDraft(null);
      setResub(null);
    }
  }, [id]);

  const after = (contact: Contact) => {
    qc.setQueryData(['contact', id], { contact });
    onChanged();
  };
  const save = useMutation({
    mutationFn: (d: Draft) =>
      api.patch<{ contact: Contact }>(`/api/contacts/${id}`, {
        firstName: d.firstName || null,
        lastName: d.lastName || null,
        phone: d.phone || null,
        attributes: Object.fromEntries((fields.data?.fields ?? []).map((f) => [f.key, d.attributes[f.key] ?? null])),
        whatsappOptIn: d.whatsappOptIn,
      }),
    onSuccess: (r) => {
      after(r.contact);
      toast.success('Contact saved');
    },
  });
  const setStatus = useMutation({
    mutationFn: (body: { emailStatus: 'SUBSCRIBED' | 'UNSUBSCRIBED'; resubscribeReason?: string }) => api.patch<{ contact: Contact }>(`/api/contacts/${id}`, body),
    onSuccess: (r, body) => {
      after(r.contact);
      setResub(null);
      toast.success(body.emailStatus === 'SUBSCRIBED' ? 'Subscribed again' : 'Unsubscribed. They won’t get any more emails.');
    },
    onError: (e: Error) => {
      if (!(e instanceof ApiError && e.field('resubscribeReason'))) toast.error(e.message);
    },
  });
  const del = useMutation({
    mutationFn: () => api.del(`/api/contacts/${id}`),
    onSuccess: () => {
      toast.success('Contact deleted');
      setConfirmDelete(false);
      onChanged();
      onClose();
    },
    onError: (e: Error) => toast.error(e instanceof ApiError && e.status === 403 ? 'Only admins can delete contacts.' : e.message),
  });

  const dirty = !!c && !!draft && JSON.stringify(toDraft(c)) !== JSON.stringify(draft);
  const name = c ? [c.firstName, c.lastName].filter(Boolean).join(' ') : '';
  const err = (f: string) => (save.error instanceof ApiError ? save.error.field(f) : undefined);
  const knownKeys = new Set(fields.data?.fields.map((f) => f.key));
  const extra = c ? Object.entries(c.attributes).filter(([k]) => !knownKeys.has(k)) : [];

  return (
    <>
      <Sheet
        open={!!id}
        onOpenChange={(o) => !o && onClose()}
        width="max-w-[520px]"
        title={
          c ? (
            <span className="flex items-center gap-3">
              <Avatar name={name} email={c.email} size={40} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{name || c.email || c.phone}</span>
                <span className="truncate text-[13px] font-normal text-muted">Added {date(c.createdAt, { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              </span>
            </span>
          ) : (
            'Contact'
          )
        }
        footer={
          c && (
            <>
              <Button variant="danger-ghost" className="mr-auto" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
              <Button onClick={() => setDraft(toDraft(c))} disabled={!dirty}>
                Discard
              </Button>
              <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => draft && save.mutate(draft)}>
                Save changes
              </Button>
            </>
          )
        }
      >
        {!c || !draft ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <Section title="Email">
              <div className="flex flex-col gap-3 rounded-[14px] border border-line p-4">
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.email ?? 'No email address'}</span>
                  {c.email && <CopyButton value={c.email} />}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-3">
                  <SubscriptionBadge status={c.emailStatus} />
                  {c.emailStatus === 'SUBSCRIBED' && (
                    <Button size="sm" variant="ghost" loading={setStatus.isPending} onClick={() => setStatus.mutate({ emailStatus: 'UNSUBSCRIBED' })}>
                      Unsubscribe
                    </Button>
                  )}
                  {c.emailStatus === 'UNSUBSCRIBED' && resub === null && (
                    <Button size="sm" variant="ghost" onClick={() => setResub('')}>
                      Subscribe again
                    </Button>
                  )}
                </div>
                {(c.emailStatus === 'BOUNCED' || c.emailStatus === 'COMPLAINED') && (
                  <p className="flex gap-2 text-[13px] leading-relaxed text-muted">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warm" aria-hidden />
                    {c.emailStatus === 'BOUNCED'
                      ? 'This address doesn’t accept mail, so it’s blocked for good. If they gave you a new address, add it as a new contact.'
                      : 'This person marked your email as spam. They’re blocked for good to protect your domain’s reputation.'}
                  </p>
                )}
                {resub !== null && (
                  <div className="flex flex-col gap-3 border-t border-line-soft pt-3">
                    <Field
                      label="How did they ask to be subscribed again?"
                      hint="Kept on record. Only re-subscribe people who asked you to."
                      error={setStatus.error instanceof ApiError ? setStatus.error.field('resubscribeReason') : undefined}
                    >
                      {(p) => <Textarea {...p} className="min-h-20" placeholder="Called the office on 3 Nov and asked for offers again" value={resub} onChange={(e) => setResub(e.target.value)} />}
                    </Field>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setResub(null)}>
                        Cancel
                      </Button>
                      <Button size="sm" variant="primary" loading={setStatus.isPending} onClick={() => setStatus.mutate({ emailStatus: 'SUBSCRIBED', resubscribeReason: resub })}>
                        Subscribe again
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Section>

            <Section title="Details">
              <div className="grid grid-cols-2 gap-4">
                <Field label="First name" error={err('firstName')}>
                  {(p) => <Input {...p} value={draft.firstName} onChange={(e) => setDraft({ ...draft, firstName: e.target.value })} />}
                </Field>
                <Field label="Last name" error={err('lastName')}>
                  {(p) => <Input {...p} value={draft.lastName} onChange={(e) => setDraft({ ...draft, lastName: e.target.value })} />}
                </Field>
              </div>
              <Field label="Phone" hint="Indian numbers get +91 automatically." error={err('phone')}>
                {(p) => <Input {...p} leading={<Phone className="h-4 w-4" />} inputMode="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />}
              </Field>
              <div className="flex items-center justify-between gap-4 rounded-[12px] bg-sunken px-4 py-3">
                <span className="flex items-center gap-3 text-sm">
                  <MessageCircle className="h-4 w-4 text-muted" aria-hidden />
                  <span className="flex flex-col">
                    <span className="font-medium">Agreed to WhatsApp messages</span>
                    <span className="text-xs text-muted">Separate from email. Used when WhatsApp arrives.</span>
                  </span>
                </span>
                <Switch label="Agreed to WhatsApp messages" checked={draft.whatsappOptIn} disabled={!draft.phone} onCheckedChange={(v) => setDraft({ ...draft, whatsappOptIn: v })} />
              </div>
            </Section>

            {(fields.data?.fields.length ?? 0) > 0 && (
              <Section title="More about them">
                <div className="grid gap-4 sm:grid-cols-2">
                  {fields.data!.fields.map((f) => (
                    <Field key={f.id} label={f.label} error={err(f.key)}>
                      {(p) => <AttributeInput {...p} field={f} value={draft.attributes[f.key]} onChange={(v) => setDraft({ ...draft, attributes: { ...draft.attributes, [f.key]: v } })} />}
                    </Field>
                  ))}
                </div>
                {extra.length > 0 && (
                  <dl className="grid gap-2 text-[13px]">
                    {extra.map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-3">
                        <dt className="text-muted">{k}</dt>
                        <dd className="font-medium">{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </Section>
            )}

            <Section title="Lists">
              {c.lists.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {c.lists.map((l) => (
                    <Badge key={l.id} tone="grey">
                      {l.name}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">{lists.length ? 'Not in any list. Select them in the table to add them to one.' : 'No lists yet.'}</p>
              )}
            </Section>

            <Section title="Consent record">
              <dl className="grid gap-2 text-[13px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">How they agreed</dt>
                  <dd className="text-right font-medium">{c.consentSource ?? 'Not recorded'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">When</dt>
                  <dd className="font-medium">{c.consentAt ? dateTime(c.consentAt) : 'Not recorded'}</dd>
                </div>
              </dl>
            </Section>
          </div>
        )}
      </Sheet>

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this contact?"
        description="Their details and history are erased. If they unsubscribed or bounced, they stay blocked so they can't be emailed by mistake."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Keep</Button>
            <Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>
              Delete permanently
            </Button>
          </>
        }
      />
    </>
  );
}

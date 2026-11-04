import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CreditCard, KeyRound, MessageCircle, Phone, QrCode, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/controls';
import { Badge, CopyButton, Panel, PanelHeader, Skeleton } from '@/components/ui/display';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/field';
import { Dialog } from '@/components/ui/overlay';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { phone as fmtPhone } from '@/lib/format';
import { useSession } from '@/lib/session';

export interface PaymentSettings {
  upiId: string | null;
  upiName: string | null;
  contactPhone: string | null;
  remindersEnabled: boolean;
  daysBefore: number;
  overdueReminder: boolean;
  channel: 'AUTO' | 'WHATSAPP' | 'EMAIL';
  beforeText: string;
  overdueText: string;
  defaults: { beforeText: string; overdueText: string };
  tags: string[];
  razorpay: { connected: boolean; keyId: string | null; webhookSet: boolean };
}

export function usePaymentSettings() {
  return useQuery({ queryKey: ['payment-settings'], queryFn: () => api.get<{ settings: PaymentSettings }>('/api/payments/settings').then((r) => r.settings) });
}

export const TAG_LABEL: Record<string, string> = {
  destination: 'Destination',
  start_date: 'Start date',
  return_date: 'Return date',
  review_link: 'Review link',
  quote_link: 'Quote link',
  first_name: 'First name',
  full_name: 'Full name',
  amount: 'Amount due',
  due_label: 'Instalment',
  due_date: 'Due date',
  trip: 'Trip name',
  trip_number: 'Trip number',
  balance: 'Balance',
  pay_link: 'Pay link',
  company_name: 'Your company',
};

function sample(company: string): Record<string, string> {
  return {
    first_name: 'Lakshmi',
    full_name: 'Lakshmi Prasad',
    amount: '₹45,000',
    due_label: 'balance',
    due_date: '5 Dec 2026',
    trip: 'Kashmir family trip',
    trip_number: '#12',
    balance: '₹45,000',
    pay_link: `${location.origin}/p/…`,
    company_name: company,
  };
}

function fill(text: string, vars: Record<string, string>) {
  return text.replace(/\{([a-z_]+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** A reminder's wording, with tags you can click in and a preview as the customer sees it. */
export function ReminderText({ label, value, onChange, fallback, tags, error, company, vars }: { label: string; value: string; onChange: (v: string) => void; fallback: string; tags: string[]; error?: string; company: string; vars?: Record<string, string> }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const insert = (tag: string) => {
    const el = ref.current;
    const token = `{${tag}}`;
    if (!el) return onChange(value + token);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex flex-col gap-2">
        <Field
          label={label}
          error={error}
          aside={
            value !== fallback && (
              <button type="button" className="inline-flex items-center gap-1 font-medium text-accent hover:underline" onClick={() => onChange(fallback)}>
                <RotateCcw className="h-3 w-3" aria-hidden />
                Our wording
              </button>
            )
          }
        >
          {(p) => (
            <Textarea
              {...p}
              ref={ref}
              rows={7}
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-1.5" aria-label="Insert a detail">
          {tags.map((t) => (
            <button key={t} type="button" onClick={() => insert(t)} className="rounded-full border border-line px-2.5 py-0.5 text-xs font-medium text-ink-2 hover:bg-hover">
              {TAG_LABEL[t] ?? t}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">What they’ll see</span>
        <div className="rounded-[14px] bg-[#e9e3d8] p-3">
          <div className="ml-auto max-w-full whitespace-pre-wrap break-words rounded-[10px] rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-[13px] leading-relaxed text-[#111b21] shadow-[0_1px_0_rgb(0_0_0/0.08)]">
            {fill(value, { ...sample(company), ...vars })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Online payments through the agency's own Razorpay account. Keys are write-only from here. */
function RazorpayPanel({ s, canEdit }: { s: PaymentSettings; canEdit: boolean }) {
  const qc = useQueryClient();
  const { tenant } = useSession();
  const [f, setF] = useState({ keyId: '', keySecret: '', webhookSecret: '' });
  const [disconnecting, setDisconnecting] = useState(false);
  const webhookUrl = `${location.origin}/webhooks/razorpay/${tenant.id}`;
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<{ settings: PaymentSettings }>('/api/payments/settings', body),
    onSuccess: ({ settings }, body) => {
      qc.setQueryData(['payment-settings'], settings);
      setF({ keyId: '', keySecret: '', webhookSecret: '' });
      setDisconnecting(false);
      toast.success(body.razorpayKeyId === null ? 'Razorpay disconnected' : 'Razorpay saved');
    },
  });
  const err = (k: string) => (save.error instanceof ApiError ? save.error.field(k) : undefined);
  const rz = s.razorpay;
  return (
    <Panel className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <PanelHeader
          title="Online payments (optional)"
          description="Connect your own Razorpay account and customers can also pay by card or net banking. Payments are recorded and receipted by themselves. Money goes to your Razorpay account; Razorpay charges its usual fee."
        />
        {rz.connected && (
          <Badge tone="green" dot>
            Connected
          </Badge>
        )}
      </div>
      {rz.connected ? (
        <div className="flex flex-col gap-4">
          <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted">Key ID</dt>
              <dd className="font-mono text-[13px]">{rz.keyId}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted">Automatic recording</dt>
              <dd className={cn('flex items-center gap-1.5', rz.webhookSet ? 'text-accent-strong' : 'text-warm-strong')}>
                {rz.webhookSet ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : null}
                {rz.webhookSet ? 'On' : 'Add the webhook secret below'}
              </dd>
            </div>
          </dl>
          {!rz.webhookSet && canEdit && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field label="Webhook secret" className="flex-1" error={err('razorpayWebhookSecret')}>
                {(p) => <Input {...p} type="password" autoComplete="off" value={f.webhookSecret} onChange={(e) => setF({ ...f, webhookSecret: e.target.value })} />}
              </Field>
              <Button variant="primary" disabled={!f.webhookSecret} loading={save.isPending} onClick={() => save.mutate({ razorpayWebhookSecret: f.webhookSecret })}>
                Save secret
              </Button>
            </div>
          )}
          <WebhookUrl url={webhookUrl} />
          {canEdit && (
            <Button size="sm" variant="danger-ghost" className="self-start" onClick={() => setDisconnecting(true)}>
              Disconnect Razorpay
            </Button>
          )}
        </div>
      ) : canEdit ? (
        <div className="flex flex-col gap-4">
          <ol className="flex flex-col gap-2 text-[13px] text-ink-2">
            <li>1. In the Razorpay Dashboard, open <b>Account &amp; Settings → API Keys</b> and generate a key. Copy the Key ID and Key Secret here.</li>
            <li>2. Open <b>Webhooks → Add New Webhook</b>. Paste the address below, make up a secret, tick <b>payment_link.paid</b>, and save. Put the same secret here.</li>
          </ol>
          <WebhookUrl url={webhookUrl} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Key ID" error={err('razorpayKeyId')}>
              {(p) => <Input {...p} leading={<KeyRound className="h-4 w-4" />} value={f.keyId} onChange={(e) => setF({ ...f, keyId: e.target.value.trim() })} placeholder="rzp_live_…" spellCheck={false} autoCapitalize="none" />}
            </Field>
            <Field label="Key secret" error={err('razorpayKeySecret')}>
              {(p) => <Input {...p} type="password" autoComplete="off" value={f.keySecret} onChange={(e) => setF({ ...f, keySecret: e.target.value })} />}
            </Field>
          </div>
          <Field label="Webhook secret" hint="The secret you made up for the webhook in step 2." error={err('razorpayWebhookSecret')}>
            {(p) => <Input {...p} type="password" autoComplete="off" value={f.webhookSecret} onChange={(e) => setF({ ...f, webhookSecret: e.target.value })} />}
          </Field>
          <Button
            variant="primary"
            className="self-start"
            disabled={!f.keyId || !f.keySecret}
            loading={save.isPending}
            onClick={() => save.mutate({ razorpayKeyId: f.keyId, razorpayKeySecret: f.keySecret, ...(f.webhookSecret ? { razorpayWebhookSecret: f.webhookSecret } : {}) })}
          >
            <CreditCard className="h-4 w-4" />
            Connect Razorpay
          </Button>
          <p className="text-xs text-muted">Keys are stored encrypted and are never shown again, not even to admins.</p>
        </div>
      ) : (
        <p className="text-[13px] text-muted">Not connected. An admin can connect it.</p>
      )}
      <Dialog
        open={disconnecting}
        onOpenChange={setDisconnecting}
        title="Disconnect Razorpay?"
        description="Customers can no longer pay online, and the keys are deleted. UPI payments keep working."
        footer={
          <>
            <Button onClick={() => setDisconnecting(false)}>Keep it</Button>
            <Button variant="danger" loading={save.isPending} onClick={() => save.mutate({ razorpayKeyId: null })}>
              Disconnect
            </Button>
          </>
        }
      />
    </Panel>
  );
}

function WebhookUrl({ url }: { url: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[12px] bg-sunken px-3.5 py-2.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs text-muted">Webhook address</span>
        <span className="truncate font-mono text-[13px]">{url}</span>
      </span>
      <CopyButton value={url} />
    </div>
  );
}

type Draft = Pick<PaymentSettings, 'upiId' | 'upiName' | 'contactPhone' | 'remindersEnabled' | 'daysBefore' | 'overdueReminder' | 'channel' | 'beforeText' | 'overdueText'>;

export function PaymentSettingsPanel() {
  const qc = useQueryClient();
  const { tenant, user } = useSession();
  const canEdit = user.role !== 'MEMBER';
  const q = usePaymentSettings();
  const [d, setD] = useState<Draft | null>(null);
  useEffect(() => {
    if (q.data && !d) setD(pick(q.data));
  }, [q.data, d]);
  const save = useMutation({
    mutationFn: () =>
      api.patch<{ settings: PaymentSettings }>('/api/payments/settings', {
        ...d,
        upiId: d!.upiId?.trim() || null,
        upiName: d!.upiName?.trim() || null,
        contactPhone: d!.contactPhone?.trim() || null,
      }),
    onSuccess: ({ settings }) => {
      qc.setQueryData(['payment-settings'], settings);
      setD(pick(settings));
      toast.success('Payment settings saved');
    },
  });
  if (!q.data || !d) return <Skeleton className="h-96 rounded-[var(--radius-panel)]" />;
  const s = q.data;
  const err = (k: string) => (save.error instanceof ApiError ? save.error.field(k) : undefined);
  const dirty = JSON.stringify(d) !== JSON.stringify(pick(s));

  return (
    <div className="flex flex-col gap-5">
      <PanelHeader title="Payments" description="How customers pay you, and the reminders they get before each payment is due." />

      <Panel className="flex flex-col gap-5 p-5 sm:p-6">
        <PanelHeader
          title="How customers pay"
          description="Each trip has a page for the customer with what’s due, a UPI QR code and a button that opens their UPI app. Money goes straight to your account; there’s no fee from us."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your UPI ID" hint="From GPay, PhonePe or your bank app, e.g. kurukshetra@okhdfcbank" error={err('upiId')}>
            {(p) => <Input {...p} disabled={!canEdit} leading={<QrCode className="h-4 w-4" />} value={d.upiId ?? ''} onChange={(e) => setD({ ...d, upiId: e.target.value })} placeholder="name@bank" autoCapitalize="none" spellCheck={false} />}
          </Field>
          <Field label="Name shown in UPI apps" hint={`Leave empty to use “${tenant.name}”.`} error={err('upiName')}>
            {(p) => <Input {...p} disabled={!canEdit} value={d.upiName ?? ''} onChange={(e) => setD({ ...d, upiName: e.target.value })} placeholder={tenant.name} />}
          </Field>
        </div>
        <Field label="WhatsApp number for payment questions" hint="Customers tap it to send you the UPI reference after paying. Shown on their trip page." error={err('contactPhone')}>
          {(p) => <Input {...p} disabled={!canEdit} inputMode="tel" leading={<Phone className="h-4 w-4" />} value={d.contactPhone ? fmtPhone(d.contactPhone) : ''} onChange={(e) => setD({ ...d, contactPhone: e.target.value })} placeholder="98480 22338" />}
        </Field>
        {!d.upiId && <p className="rounded-[12px] bg-warm-soft px-4 py-3 text-[13px] text-warm-strong">Without a UPI ID, the customer’s page shows what’s due and asks them to contact you to pay.</p>}
      </Panel>

      <Panel className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <PanelHeader title="Payment reminders" description="Sent at 10 am to customers with a booked trip, once per instalment. Payments you record stop them automatically." />
          <Switch label="Send payment reminders" checked={d.remindersEnabled} disabled={!canEdit} onCheckedChange={(v) => setD({ ...d, remindersEnabled: v })} />
        </div>
        <div className={cn('flex flex-col gap-5', !d.remindersEnabled && 'pointer-events-none opacity-50')} aria-disabled={!d.remindersEnabled}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Days before each due date" error={err('daysBefore')}>
              {(p) => <Input {...p} disabled={!canEdit} type="number" min={1} max={15} value={d.daysBefore} onChange={(e) => setD({ ...d, daysBefore: Number(e.target.value) })} />}
            </Field>
            <Field label="Send by" error={err('channel')}>
              {(p) => (
                <NativeSelect {...p} disabled={!canEdit} value={d.channel} onChange={(e) => setD({ ...d, channel: e.target.value as Draft['channel'] })}>
                  <option value="AUTO">WhatsApp if linked, else email</option>
                  <option value="WHATSAPP">WhatsApp only</option>
                  <option value="EMAIL">Email only</option>
                </NativeSelect>
              )}
            </Field>
          </div>
          <label className="flex items-center justify-between gap-4 rounded-[12px] bg-sunken px-4 py-3 text-sm">
            <span className="flex flex-col">
              <span className="font-medium">Also remind them the day after a missed payment</span>
              <span className="text-xs text-muted">One message, never repeated.</span>
            </span>
            <Switch label="Remind the day after a missed payment" checked={d.overdueReminder} disabled={!canEdit} onCheckedChange={(v) => setD({ ...d, overdueReminder: v })} />
          </label>
          <ReminderText label="Before a payment is due" value={d.beforeText} onChange={(v) => setD({ ...d, beforeText: v })} fallback={s.defaults.beforeText} tags={s.tags} error={err('beforeText')} company={tenant.name} />
          {d.overdueReminder && (
            <ReminderText label="After a missed payment" value={d.overdueText} onChange={(v) => setD({ ...d, overdueText: v })} fallback={s.defaults.overdueText} tags={s.tags} error={err('overdueText')} company={tenant.name} />
          )}
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
            <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            These are messages about a customer’s own booking, so they go out even if the customer opted out of offers. Anyone who replied STOP on WhatsApp, or whose email bounced, isn’t sent them.
          </p>
        </div>
      </Panel>

      <RazorpayPanel s={s} canEdit={canEdit} />

      {canEdit && (
        <div className="sticky bottom-4 z-10 flex justify-end">
          <div className={cn('flex items-center gap-3 rounded-[14px] border border-line bg-surface p-2 pl-4 shadow-[var(--shadow-pop)] transition-opacity', dirty ? 'opacity-100' : 'pointer-events-none opacity-0')}>
            <span className="text-[13px] text-muted">Unsaved changes</span>
            <Button size="sm" onClick={() => setD(pick(s))}>
              Discard
            </Button>
            <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              Save changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function pick(s: PaymentSettings): Draft {
  return { upiId: s.upiId, upiName: s.upiName, contactPhone: s.contactPhone, remindersEnabled: s.remindersEnabled, daysBefore: s.daysBefore, overdueReminder: s.overdueReminder, channel: s.channel, beforeText: s.beforeText, overdueText: s.overdueText };
}

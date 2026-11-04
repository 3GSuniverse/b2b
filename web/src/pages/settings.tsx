import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Wallet, Plane, KeyRound, CheckCircle2, Circle, Globe, Mail, MessageCircle, MoreHorizontal, Plus, RefreshCw, Send, Star, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/controls';
import { Badge, CopyButton, EmptyState, PageHeader, Panel, PanelHeader, ProgressBar, Skeleton } from '@/components/ui/display';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/field';
import { Dialog, Menu, MenuItem, MenuSeparator } from '@/components/ui/overlay';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ago, n } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { DnsRecord, Domain, Mailbox, Sender } from '@/lib/types';
import { WhatsAppSettings } from '@/components/whatsapp/settings';
import { PaymentSettingsPanel } from '@/components/trips/payment-settings';
import { TripMessagesSettings } from '@/components/trips/trip-messages-settings';
import { ApiKeysSettings } from '@/components/api-keys';

const SECTIONS = [
  { id: 'senders', label: 'Sending addresses', icon: Send },
  { id: 'domains', label: 'Domains', icon: Globe },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { id: 'payments', label: 'Payments', icon: Wallet },
  { id: 'trip-messages', label: 'Trip messages', icon: Plane },
  { id: 'company', label: 'Company', icon: Building2 },
  { id: 'api-keys', label: 'API keys', icon: KeyRound },
] as const;
type Section = (typeof SECTIONS)[number]['id'];

const errOf = (e: unknown, f: string) => (e instanceof ApiError ? e.field(f) : undefined);

// ================================================================= Domains

const PURPOSE: Record<DnsRecord['purpose'], string> = {
  ownership: 'Proves your company owns the domain',
  dkim: 'Signs your emails so inboxes trust them',
  mail_from_mx: 'Receives bounce reports',
  mail_from_spf: 'Allows Amazon SES to send for you',
  dmarc: 'Recommended: tells inboxes what to do with fakes',
};

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      {ok ? <CheckCircle2 className="h-4 w-4 text-accent" /> : <Circle className="h-4 w-4 text-faint" />}
      <span className={ok ? 'text-ink' : 'text-muted'}>{label}</span>
    </span>
  );
}

function DomainCard({ d, onDelete }: { d: Domain; onDelete: () => void }) {
  const qc = useQueryClient();
  const check = useMutation({
    mutationFn: () => api.post<{ domain: Domain }>(`/api/domains/${d.id}/check`),
    onSuccess: ({ domain }) => {
      qc.invalidateQueries({ queryKey: ['domains'] });
      qc.invalidateQueries({ queryKey: ['senders'] });
      if (domain.readyToSend) toast.success(`${domain.domain} is verified. You can send from it now.`);
      else toast(`Still waiting for ${domain.records.filter((r) => r.required && !r.found).length} record(s)`, { description: 'DNS changes can take a few minutes, sometimes an hour.' });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const missing = d.records.filter((r) => r.required && !r.found).length;
  const [open, setOpen] = useState(!d.readyToSend);
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-4 px-5 py-4 sm:px-6">
        <span className={cn('grid h-10 w-10 place-items-center rounded-[12px]', d.readyToSend ? 'bg-accent-soft text-accent' : 'bg-warm-soft text-warm')}>
          <Globe className="h-5 w-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-semibold">{d.domain}</span>
          <span className="text-[13px] text-muted">
            {d.readyToSend ? `Verified ${d.verifiedAt ? ago(d.verifiedAt) : ''}` : d.status === 'failed' ? 'Verification failed. Check the records below.' : `Waiting for ${missing} DNS record${missing === 1 ? '' : 's'}. We check every few minutes.`}
          </span>
        </div>
        <Badge tone={d.readyToSend ? 'green' : d.status === 'failed' ? 'red' : 'orange'} dot>
          {d.readyToSend ? 'Ready to send' : d.status === 'failed' ? 'Failed' : 'Waiting for DNS'}
        </Badge>
        <div className="flex items-center gap-1">
          <Button size="sm" variant={d.readyToSend ? 'ghost' : 'secondary'} loading={check.isPending} onClick={() => check.mutate()}>
            {!check.isPending && <RefreshCw className="h-3.5 w-3.5" />}
            Check now
          </Button>
          <Menu
            trigger={
              <button type="button" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink" aria-label={`Options for ${d.domain}`}>
                <MoreHorizontal className="h-4 w-4" />
              </button>
            }
          >
            <MenuItem onSelect={() => setOpen((o) => !o)}>{open ? 'Hide DNS records' : 'Show DNS records'}</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash2 />} danger onSelect={onDelete}>
              Remove domain
            </MenuItem>
          </Menu>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line-soft bg-sunken px-5 py-3 sm:px-6">
        <StatusDot ok={d.checks.ownership === 'VERIFIED'} label="Ownership" />
        <StatusDot ok={d.checks.domain === 'VERIFIED'} label="Domain" />
        <StatusDot ok={d.checks.dkim === 'VERIFIED'} label="DKIM signing" />
        <StatusDot ok={d.checks.mailFrom === 'VERIFIED'} label="Bounce handling" />
        <button type="button" onClick={() => setOpen((o) => !o)} className="ml-auto text-[13px] font-semibold text-accent hover:text-accent-strong">
          {open ? 'Hide records' : 'Show records'}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-4 border-t border-line-soft px-5 py-5 sm:px-6">
          <p className="text-[13px] leading-relaxed text-muted">
            Add these records where your domain’s DNS is managed (Cloudflare, GoDaddy, Hostinger…). In Cloudflare, set CNAME records to <strong className="font-semibold text-ink">DNS only</strong> (grey cloud).
            Some providers add your domain automatically: if so, paste only the part before <span className="font-medium text-ink">.{d.domain}</span> as the name.
          </p>
          <div className="overflow-x-auto rounded-[12px] border border-line">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="bg-sunken text-xs text-muted">
                <tr>
                  <th className="w-16 px-4 py-2.5 font-semibold">Type</th>
                  <th className="px-4 py-2.5 font-semibold">Name</th>
                  <th className="px-4 py-2.5 font-semibold">Value</th>
                  <th className="w-28 px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {d.records.map((r, i) => (
                  <tr key={i} className="border-t border-line-soft align-top">
                    <td className="px-4 py-3">
                      <Badge tone="grey" className="px-2">
                        {r.type}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 break-all font-medium">{r.name}</span>
                        <CopyButton value={r.name} label="Copy" />
                      </div>
                      <span className="mt-1 block text-xs text-muted">{PURPOSE[r.purpose]}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 break-all text-ink-2">
                          {r.priority !== undefined && <span className="mr-1 text-muted">Priority {r.priority}:</span>}
                          {r.value}
                        </span>
                        <CopyButton value={r.value} label="Copy" />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {r.found ? (
                        <Badge tone="green" dot>
                          Found
                        </Badge>
                      ) : r.required ? (
                        <Badge tone="orange" dot>
                          Not yet
                        </Badge>
                      ) : (
                        <Badge tone="grey">Optional</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}

function Domains() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['domains'],
    queryFn: () => api.get<{ domains: Domain[] }>('/api/domains'),
    refetchInterval: (query) => (query.state.data?.domains.some((d) => !d.readyToSend) ? 30_000 : false),
  });
  const [adding, setAdding] = useState(false);
  const [domain, setDomain] = useState('');
  const [removing, setRemoving] = useState<Domain | null>(null);
  const add = useMutation({
    mutationFn: () => api.post<{ domain: Domain }>('/api/domains', { domain }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['domains'] });
      setAdding(false);
      setDomain('');
      toast.success('Domain added. Now add the DNS records shown.');
    },
  });
  const remove = useMutation({
    mutationFn: (d: Domain) => api.del(`/api/domains/${d.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['domains'] });
      qc.invalidateQueries({ queryKey: ['senders'] });
      setRemoving(null);
      toast.success('Domain removed');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex flex-col gap-5">
      <PanelHeader
        title="Domains"
        description="Verify your company’s domain once. Then every email goes out from your own address, signed so Gmail and Yahoo trust it."
        action={
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Add domain
          </Button>
        }
      />
      {q.isPending ? (
        <Skeleton className="h-40 rounded-[var(--radius-panel)]" />
      ) : q.data?.domains.length ? (
        q.data.domains.map((d) => <DomainCard key={d.id} d={d} onDelete={() => setRemoving(d)} />)
      ) : (
        <Panel>
          <EmptyState icon={<Globe />} title="No domain yet" action={<Button variant="primary" onClick={() => setAdding(true)}>Add your domain</Button>}>
            Use the domain of your website, like kurukshetra-travels.in. If you don’t have one, you can connect a Gmail account instead.
          </EmptyState>
        </Panel>
      )}
      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title="Add your domain"
        description="You’ll get a few DNS records to add. Nothing changes on your website."
        footer={
          <>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button variant="primary" loading={add.isPending} onClick={() => add.mutate()}>
              Add domain
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field label="Domain" hint="Just the domain, without www or https://" error={errOf(add.error, 'domain') ?? (add.error && !(add.error instanceof ApiError && add.error.details?.fields) ? add.error.message : undefined)}>
            {(p) => <Input {...p} autoFocus leading={<Globe className="h-4 w-4" />} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yourcompany.com" />}
          </Field>
        </form>
      </Dialog>
      <Dialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.domain}?`}
        description="Sending addresses on this domain stop working. You can add it again later."
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Keep it</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => removing && remove.mutate(removing)}>
              Remove domain
            </Button>
          </>
        }
      />
    </div>
  );
}

// ================================================================= Senders

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9l3.7-2.8z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
    </svg>
  );
}

function SenderRow({ s, mailbox, onEdit, onRemove }: { s: Sender; mailbox?: Mailbox; onEdit: () => void; onRemove: () => void }) {
  const qc = useQueryClient();
  const makeDefault = useMutation({
    mutationFn: () => api.patch(`/api/senders/${s.id}`, { isDefault: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['senders'] });
      toast.success(`${s.fromEmail} is now the default`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <li className="flex flex-wrap items-center gap-4 px-5 py-4 sm:px-6">
      <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-[12px]', s.kind === 'GMAIL' ? 'border border-line bg-surface' : 'bg-accent-soft text-accent')}>
        {s.kind === 'GMAIL' ? <GoogleMark /> : <Mail className="h-5 w-5" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{s.fromName}</span>
          {s.isDefault && (
            <Badge tone="green" className="px-2 text-[11px]">
              Default
            </Badge>
          )}
        </span>
        <span className="truncate text-[13px] text-muted">
          {s.fromEmail}
          {s.replyTo && `, replies go to ${s.replyTo}`}
        </span>
      </div>
      {mailbox && mailbox.status === 'ACTIVE' && (
        <div className="hidden w-44 flex-col gap-1.5 md:flex">
          <span className="tnum text-xs text-muted">
            {n(mailbox.sentLast24h)} of {n(mailbox.dailyLimit)} sent today
          </span>
          <ProgressBar value={mailbox.sentLast24h} max={mailbox.dailyLimit} label="Gmail daily limit used" tone={mailbox.sentLast24h / mailbox.dailyLimit > 0.85 ? 'warm' : 'accent'} />
        </div>
      )}
      {s.readyToSend ? (
        <Badge tone="green" dot>
          Ready
        </Badge>
      ) : (
        <Badge tone="orange" dot>
          {s.kind === 'GMAIL' ? 'Disconnected' : 'Domain not verified'}
        </Badge>
      )}
      <Menu
        trigger={
          <button type="button" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink" aria-label={`Options for ${s.fromEmail}`}>
            <MoreHorizontal className="h-4 w-4" />
          </button>
        }
      >
        {!s.isDefault && (
          <MenuItem icon={<Star />} onSelect={() => makeDefault.mutate()}>
            Make default
          </MenuItem>
        )}
        <MenuItem onSelect={onEdit}>Edit name and reply-to</MenuItem>
        {s.kind === 'GMAIL' && !s.readyToSend && <MenuItem onSelect={() => (window.location.href = '/api/integrations/gmail/connect')}>Reconnect Gmail</MenuItem>}
        <MenuSeparator />
        <MenuItem icon={<Trash2 />} danger onSelect={onRemove}>
          Remove
        </MenuItem>
      </Menu>
      {mailbox?.status !== 'ACTIVE' && mailbox?.lastError && <p className="basis-full pl-14 text-xs text-warm-strong">{mailbox.lastError}</p>}
    </li>
  );
}

function Senders() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const senders = useQuery({ queryKey: ['senders'], queryFn: () => api.get<{ senders: Sender[] }>('/api/senders') });
  const domains = useQuery({ queryKey: ['domains'], queryFn: () => api.get<{ domains: Domain[] }>('/api/domains') });
  const mailboxes = useQuery({ queryKey: ['mailboxes'], queryFn: () => api.get<{ mailboxes: Mailbox[] }>('/api/mailboxes') });
  const ready = domains.data?.domains.filter((d) => d.readyToSend) ?? [];

  const [form, setForm] = useState<{ id?: string; domainId: string; fromName: string; local: string; replyTo: string; isDefault: boolean } | null>(null);
  const [removing, setRemoving] = useState<Sender | null>(null);

  // Coming back from Google's consent screen
  useEffect(() => {
    const g = params.get('gmail');
    if (!g) return;
    if (g === 'connected') {
      toast.success(`${params.get('email') ?? 'Gmail'} is connected`, { description: 'You can send campaigns from it now.' });
      qc.invalidateQueries({ queryKey: ['senders'] });
      qc.invalidateQueries({ queryKey: ['mailboxes'] });
    } else if (g === 'cancelled') toast('Gmail wasn’t connected', { description: 'You cancelled on Google’s screen.' });
    else toast.error('Couldn’t connect Gmail', { description: params.get('reason') === 'invalid_state' ? 'The sign-in took too long or was opened in another tab. Try again.' : 'Google didn’t allow it. Try again, and tick the permission to send email.' });
    setParams({}, { replace: true });
  }, [params, setParams, qc]);

  const save = useMutation({
    mutationFn: () => {
      const f = form!;
      const domain = domains.data?.domains.find((d) => d.id === f.domainId);
      return f.id
        ? api.patch(`/api/senders/${f.id}`, { fromName: f.fromName, replyTo: f.replyTo || null })
        : api.post('/api/senders', { domainId: f.domainId, fromName: f.fromName, fromEmail: `${f.local.trim()}@${domain?.domain}`, replyTo: f.replyTo || undefined, isDefault: f.isDefault });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['senders'] });
      toast.success(form?.id ? 'Saved' : 'Sending address added');
      setForm(null);
    },
  });
  const remove = useMutation({
    mutationFn: async (s: Sender) => {
      await api.del(`/api/senders/${s.id}`);
      if (s.kind === 'GMAIL' && s.mailbox) await api.del(`/api/mailboxes/${s.mailbox.id}`).catch(() => undefined);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['senders'] });
      qc.invalidateQueries({ queryKey: ['mailboxes'] });
      setRemoving(null);
      toast.success('Removed');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = senders.data?.senders ?? [];
  const mailboxOf = (s: Sender) => mailboxes.data?.mailboxes.find((m) => m.id === s.mailbox?.id);

  return (
    <div className="flex flex-col gap-5">
      <PanelHeader title="Sending addresses" description="Who your emails are from. Customers see this name and address in their inbox, and replies go to you." />

      {senders.isPending ? (
        <Skeleton className="h-32 rounded-[var(--radius-panel)]" />
      ) : list.length > 0 ? (
        <Panel>
          <ul className="divide-y divide-line-soft">
            {list.map((s) => (
              <SenderRow
                key={s.id}
                s={s}
                mailbox={mailboxOf(s)}
                onRemove={() => setRemoving(s)}
                onEdit={() => setForm({ id: s.id, domainId: s.domain?.id ?? '', fromName: s.fromName, local: s.fromEmail.split('@')[0]!, replyTo: s.replyTo ?? '', isDefault: s.isDefault })}
              />
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-accent-soft text-accent">
              <Globe className="h-5 w-5" />
            </span>
            <div className="flex flex-col">
              <span className="text-[15px] font-semibold">Your company domain</span>
              <span className="text-xs text-muted">Recommended for campaigns</span>
            </div>
          </div>
          <ul className="flex flex-col gap-1.5 text-[13px] text-muted">
            <li>Any address, like offers@ or trips@yourcompany.com</li>
            <li>Thousands a day, with bounce and open tracking</li>
            <li>Needs a few DNS records, once</li>
          </ul>
          {ready.length ? (
            <Button variant="primary" className="mt-auto self-start" onClick={() => setForm({ domainId: ready[0]!.id, fromName: '', local: '', replyTo: '', isDefault: list.length === 0 })}>
              Add an address
            </Button>
          ) : (
            <NavLink to="/settings/domains" className="mt-auto self-start text-[13px] font-semibold text-accent hover:text-accent-strong">
              {domains.data?.domains.length ? 'Finish verifying your domain first' : 'Verify your domain first'}
            </NavLink>
          )}
        </Panel>
        <Panel className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[12px] border border-line">
              <GoogleMark />
            </span>
            <div className="flex flex-col">
              <span className="text-[15px] font-semibold">A Gmail or Google Workspace account</span>
              <span className="text-xs text-muted">Quickest to set up</span>
            </div>
          </div>
          <ul className="flex flex-col gap-1.5 text-[13px] text-muted">
            <li>Sends from that account, appears in its Sent folder</li>
            <li>About 400 a day on Gmail, 1,500 on Workspace</li>
            <li>No open or click tracking</li>
          </ul>
          <a href="/api/integrations/gmail/connect" className="mt-auto inline-flex h-11 items-center gap-2.5 self-start rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-semibold hover:bg-sunken">
            <GoogleMark />
            Connect with Google
          </a>
        </Panel>
      </div>

      <Dialog
        open={!!form}
        onOpenChange={(o) => !o && setForm(null)}
        title={form?.id ? 'Edit sending address' : 'Add a sending address'}
        footer={
          <>
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              {form?.id ? 'Save' : 'Add address'}
            </Button>
          </>
        }
      >
        {form && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            {save.error && !(save.error instanceof ApiError && save.error.details?.fields) && <p className="text-sm text-danger">{save.error.message}</p>}
            <Field label="Name people see" hint="Usually your company name." error={errOf(save.error, 'fromName')}>
              {(p) => <Input {...p} autoFocus value={form.fromName} onChange={(e) => setForm({ ...form, fromName: e.target.value })} placeholder="Kurukshetra Travels" />}
            </Field>
            {!form.id && (
              <Field label="Address" error={errOf(save.error, 'fromEmail')}>
                {(p) => (
                  <div className="flex items-center gap-2">
                    <Input {...p} value={form.local} onChange={(e) => setForm({ ...form, local: e.target.value.replace(/[@\s]/g, '') })} placeholder="trips" className="flex-1" />
                    <span className="text-muted">@</span>
                    <NativeSelect aria-label="Domain" value={form.domainId} onChange={(e) => setForm({ ...form, domainId: e.target.value })} className="w-auto">
                      {ready.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.domain}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                )}
              </Field>
            )}
            <Field label="Replies go to" hint="Optional. Leave empty to receive replies at the sending address." error={errOf(save.error, 'replyTo')}>
              {(p) => <Input {...p} type="email" value={form.replyTo} onChange={(e) => setForm({ ...form, replyTo: e.target.value })} placeholder="bookings@yourcompany.com" />}
            </Field>
            {!form.id && (
              <label className="flex items-center justify-between gap-4 text-sm">
                <span>Use for new campaigns by default</span>
                <Switch label="Default address" checked={form.isDefault} onCheckedChange={(v) => setForm({ ...form, isDefault: v })} />
              </label>
            )}
            <button type="submit" hidden />
          </form>
        )}
      </Dialog>
      <Dialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.fromEmail}?`}
        description={removing?.kind === 'GMAIL' ? 'We delete our access to this Gmail account. Campaigns and automations using it stop until you choose another address.' : 'Campaigns and automations using it stop until you choose another address.'}
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Keep it</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => removing && remove.mutate(removing)}>
              Remove
            </Button>
          </>
        }
      />
    </div>
  );
}

// ================================================================= Company

interface Account {
  name: string;
  postalAddress: string | null;
  timezone: string;
  monthlyQuota: number;
}

function Company() {
  const qc = useQueryClient();
  const { user, tenant } = useSession();
  const tenantPlan = tenant.plan;
  const q = useQuery({ queryKey: ['account'], queryFn: () => api.get<{ account: Account }>('/api/account') });
  const [f, setF] = useState<{ name: string; postalAddress: string } | null>(null);
  useEffect(() => {
    if (q.data && !f) setF({ name: q.data.account.name, postalAddress: q.data.account.postalAddress ?? '' });
  }, [q.data, f]);
  const save = useMutation({
    mutationFn: () => api.patch<{ account: Account }>('/api/account', { name: f!.name, postalAddress: f!.postalAddress || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      toast.success('Company details saved');
    },
    onError: (e: Error) => !(e instanceof ApiError && e.details?.fields) && toast.error(e instanceof ApiError && e.status === 403 ? 'Only owners and admins can change these.' : e.message),
  });
  if (!q.data || !f) return <Skeleton className="h-64 rounded-[var(--radius-panel)]" />;
  const a = q.data.account;
  const dirty = f.name !== a.name || f.postalAddress !== (a.postalAddress ?? '');
  return (
    <div className="flex flex-col gap-5">
      <PanelHeader title="Company" description="Shown in the footer of every email you send." />
      {!a.postalAddress && (
        <p className="flex items-start gap-2 rounded-[14px] border border-[#f3c9a8] bg-warm-soft px-4 py-3 text-[13px] text-warm-strong">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          Add your office address. Anti-spam rules expect a real address in marketing emails, and it makes your emails look trustworthy.
        </p>
      )}
      <Panel className="flex flex-col gap-5 p-5 sm:p-6">
        <Field label="Company name" error={errOf(save.error, 'name')}>
          {(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
        </Field>
        <Field label="Office address" hint="One or two lines. Printed small at the bottom of each email." error={errOf(save.error, 'postalAddress')}>
          {(p) => <Textarea {...p} rows={2} className="min-h-0" value={f.postalAddress} onChange={(e) => setF({ ...f, postalAddress: e.target.value })} placeholder="Road No. 12, Banjara Hills, Hyderabad 500034" />}
        </Field>
        <div className="flex justify-end">
          <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </Panel>
      <Panel className="grid grid-cols-[minmax(0,1fr)] gap-4 p-5 text-[13px] sm:grid-cols-3 sm:p-6">
        <div className="flex flex-col gap-1">
          <span className="text-muted">Plan</span>
          <span className="font-semibold">
            {tenantPlan?.plan === 'TRIAL'
              ? tenantPlan.trialEnded
                ? 'Free trial (ended)'
                : `Free trial, ${tenantPlan.daysLeft === 0 ? 'ends today' : `${tenantPlan.daysLeft} days left`}`
              : 'Paid'}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted">Time zone</span>
          <span className="font-semibold">India ({a.timezone})</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted">Emails per month</span>
          <span className="tnum font-semibold">{n(a.monthlyQuota)}</span>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-3 sm:border-t sm:border-line-soft sm:pt-4">
          <span className="text-muted">Signed in as</span>
          <span className="truncate font-semibold">{user.email}</span>
        </div>
      </Panel>
    </div>
  );
}

// ================================================================= Page

export function SettingsPage() {
  const { section } = useParams();
  const { tenant } = useSession();
  const { user } = useSession();
  const sections = SECTIONS.filter((x) => (x.id !== 'whatsapp' || tenant.features?.whatsapp) && (x.id !== 'api-keys' || user.role !== 'MEMBER'));
  if (section === 'account') return <Navigate to="/settings/company" replace />;
  if (!sections.some((s) => s.id === section)) return <Navigate to="/settings/senders" replace />;
  const content: Record<Section, ReactNode> = { senders: <Senders />, domains: <Domains />, whatsapp: <WhatsAppSettings />, payments: <PaymentSettingsPanel />, 'trip-messages': <TripMessagesSettings />, company: <Company />, 'api-keys': <ApiKeysSettings /> };
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Settings" className="flex gap-1 overflow-x-auto lg:sticky lg:top-6 lg:flex-col">
          {sections.map(({ id, label, icon: Icon }) => (
            <NavLink
              key={id}
              to={`/settings/${id}`}
              className={({ isActive }) =>
                cn('flex h-10 shrink-0 items-center gap-2.5 rounded-[10px] px-3 text-sm font-medium', isActive ? 'bg-surface text-ink shadow-[var(--shadow-lift)]' : 'text-ink-2 hover:bg-hover')
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0">{content[section as Section]}</div>
      </div>
    </>
  );
}

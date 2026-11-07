import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  Braces,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ArrowRight,
  Circle,
  Clock3,
  FlaskConical,
  LayoutTemplate,
  MessageCircle,
  Loader2,
  Mail,
  Paperclip,
  Pencil,
  Send,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AudienceEditor, describeAudience, useAudienceCount, useFieldLabel, useLists } from '@/components/campaigns/audience';
import { DesignGallery, type Design } from '@/components/campaigns/design-picker';
import { AttachmentPicker, describeFiles } from '@/components/attachments/attachments';
import { useFields } from '@/components/contacts/contact-sheet';
import { DeviceToggle, EmailPreview, type Device } from '@/components/email/email-frame';
import { EmailThumbnail } from '@/components/email/thumbnail';
import { MergeTagMenu, VisualEditor } from '@/components/email/visual-editor';
import { SendNowButton } from '@/components/campaigns/send-button';
import { Button, LinkButton } from '@/components/ui/button';
import { Badge, PageHeader, Panel, Skeleton } from '@/components/ui/display';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/field';
import { Dialog, Popover } from '@/components/ui/overlay';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dateTime, n } from '@/lib/format';
import { useNavSection } from '@/lib/section';
import { useSession } from '@/lib/session';
import { CampaignStatusBadge } from '@/lib/status';
import { WHATSAPP_STARTER, WhatsAppComposer } from './whatsapp-composer';
import { Segmented } from '@/components/ui/controls';
import { PrettyTags } from '@/lib/tags';
import type { Attachment, Audience, Campaign, CampaignPreview, Check as CheckT, Sender } from '@/lib/types';
import { takeoff } from '@/lib/celebrate';

// ---------------------------------------------------------------- time helpers

/** "+05:30" for a time zone at a given moment. */
export function tzOffset(tz: string, at = new Date()) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(part);
  return m ? `${m[1]}:${m[2] ?? '00'}` : '+00:00';
}
/** "2026-11-04T10:00" in the company's time zone → ISO with offset. */
export const toIso = (local: string, tz: string) => `${local}:00${tzOffset(tz, new Date(local))}`;
/** Date → "YYYY-MM-DDTHH:mm" as the wall clock in a time zone. */
export function toLocalInput(d: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function nextAt(daysAhead: number, hour: number, tz: string, weekday?: number) {
  const now = new Date();
  const local = toLocalInput(now, tz).slice(0, 10);
  const base = new Date(`${local}T12:00:00Z`);
  let add = daysAhead;
  if (weekday !== undefined) add = ((weekday - base.getUTCDay() + 7) % 7) || 7;
  base.setUTCDate(base.getUTCDate() + add);
  return `${base.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00`;
}

// ---------------------------------------------------------------- new campaign

function NewCampaign() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [name, setName] = useState(() => `Campaign ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`);
  const senders = useQuery({ queryKey: ['senders'], queryFn: () => api.get<{ senders: Sender[] }>('/api/senders') });
  const { tenant } = useSession();
  const [channel, setChannel] = useState<'EMAIL' | 'WHATSAPP'>(params.get('channel') === 'WHATSAPP' ? 'WHATSAPP' : 'EMAIL');
  useNavSection(channel === 'WHATSAPP' ? 'whatsapp' : 'email');
  // Started from "Send to a temporary list": the To step opens on the temporary list
  const temporary = params.get('to') === 'temporary';
  const createWa = useMutation({
    mutationFn: () => api.post<{ campaign: Campaign }>('/api/campaigns', { name: name.trim() || 'Untitled broadcast', channel: 'WHATSAPP', text: WHATSAPP_STARTER, ...(temporary && { audience: { mode: 'temporary', addresses: [] } }) }),
    onSuccess: ({ campaign }) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      nav(`/campaigns/${campaign.id}/edit`, { replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const create = useMutation({
    mutationFn: (d: Design) => {
      const def = senders.data?.senders.find((s) => s.isDefault && s.readyToSend) ?? senders.data?.senders.find((s) => s.readyToSend);
      return api.post<{ campaign: Campaign }>('/api/campaigns', {
        name: name.trim() || 'Untitled broadcast',
        senderId: def?.id ?? null,
        ...(temporary && { audience: { mode: 'temporary', addresses: [] } }),
        ...(d.templateId ? { templateId: d.templateId } : { subject: d.subject, previewText: d.previewText, html: d.html }),
      });
    },
    onSuccess: ({ campaign }) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      nav(`/campaigns/${campaign.id}/edit`, { replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <PageHeader
        back={
          <Link to={channel === 'WHATSAPP' ? '/whatsapp/broadcasts' : '/email/broadcasts'} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
            <ArrowLeft className="h-3.5 w-3.5" /> {channel === 'WHATSAPP' ? 'WhatsApp' : 'Email'}: broadcasts
          </Link>
        }
        title={channel === 'WHATSAPP' ? 'New WhatsApp broadcast' : 'New email broadcast'}
        description="Name it, then pick a design to start from. You’ll change the words next."
      />
      <Panel className="flex flex-col gap-5 p-5 sm:p-6">
        <Field label="Broadcast name" hint="Only your team sees this.">
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} className="max-w-md" />}
        </Field>
        {tenant.features?.whatsapp && (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold">Send by</span>
            <Segmented
              label="Channel"
              value={channel}
              onChange={setChannel}
              options={[
                { value: 'EMAIL', label: 'Email' },
                { value: 'WHATSAPP', label: 'WhatsApp' },
              ]}
            />
          </div>
        )}
      </Panel>
      {channel === 'EMAIL' ? (
        <DesignGallery onPick={(d) => create.mutate(d)} busy={create.isPending} />
      ) : (
        <Panel className="flex flex-col items-start gap-4 p-5 sm:p-6">
          <p className="max-w-xl text-sm leading-relaxed text-muted">
            {temporary
              ? 'One message, sent from your linked number to the numbers you paste or upload next. They won’t be saved as customers.'
              : 'A WhatsApp broadcast is one message, sent from your linked number to everyone who agreed to WhatsApp messages.'}{' '}
            We’ll start you with a short example to edit.
          </p>
          <Button variant="primary" loading={createWa.isPending} onClick={() => createWa.mutate()}>
            <MessageCircle className="h-4 w-4" />
            Write the WhatsApp message
          </Button>
        </Panel>
      )}
    </>
  );
}

// ---------------------------------------------------------------- editor pieces

interface Draft {
  name: string;
  senderId: string | null;
  subject: string;
  previewText: string;
  html: string | null;
  audience: Audience | null;
  attachments: Attachment[];
}
const toDraft = (c: Campaign): Draft => ({
  name: c.name,
  senderId: c.sender?.id ?? null,
  subject: c.subject ?? '',
  previewText: c.previewText ?? '',
  html: c.html,
  audience: c.audience,
  attachments: c.attachments ?? [],
});

/**
 * One part of a broadcast, in the order of a letter: 1 From, 2 To, 3 Subject, 4 Message, 5 Attachments.
 * Each shows its number (a tick once done) and, when open, a button to the next part.
 */
export function Step({
  icon,
  number,
  title,
  summary,
  done,
  open,
  onToggle,
  children,
  error,
  next,
}: {
  icon: ReactNode;
  number?: number;
  title: string;
  summary: ReactNode;
  done: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  error?: boolean;
  next?: { label: string; onClick: () => void };
}) {
  return (
    <Panel className={cn('overflow-hidden transition-shadow', open && 'shadow-[var(--shadow-lift)]')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-sunken sm:px-6">
        <span
          className={cn(
            'grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold transition-colors',
            done ? 'bg-accent-soft text-accent' : error ? 'bg-warm-soft text-warm' : open ? 'bg-accent text-on-primary' : 'bg-line-soft text-muted',
          )}
        >
          {done ? <Check className="h-4 w-4" strokeWidth={2.6} /> : (number ?? icon)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
            <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{number !== undefined && icon}</span>
            {title}
          </span>
          <span className="truncate text-sm font-medium text-ink">{summary}</span>
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-line-soft px-5 py-5 sm:px-6">
          {children}
          {next && (
            <div className="mt-5 flex justify-end border-t border-line-soft pt-4">
              <Button size="sm" variant="primary" onClick={next.onClick}>
                {next.label} <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

export function ChecksPanel({ checks, loading }: { checks?: CheckT[]; loading: boolean }) {
  const order = { error: 0, warning: 1, ok: 2 } as const;
  const sorted = [...(checks ?? [])].sort((a, b) => order[a.level] - order[b.level]);
  const errors = sorted.filter((c) => c.level === 'error').length;
  const warnings = sorted.filter((c) => c.level === 'warning').length;
  return (
    <Panel className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Before you send</h2>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted" />
        ) : errors ? (
          <Badge tone="red" dot>
            {errors} to fix
          </Badge>
        ) : warnings ? (
          <Badge tone="orange" dot>
            {warnings} to review
          </Badge>
        ) : (
          <Badge tone="green" dot>
            Ready
          </Badge>
        )}
      </div>
      <ul className="flex flex-col gap-3">
        {sorted.map((c) => (
          <li key={c.id} className="flex gap-3">
            <span className="mt-0.5 shrink-0">
              {c.level === 'ok' ? (
                <CheckCircle2 className="h-4 w-4 text-success" aria-label="OK" />
              ) : c.level === 'warning' ? (
                <TriangleAlert className="h-4 w-4 text-warm" aria-label="Warning" />
              ) : (
                <AlertCircle className="h-4 w-4 text-danger" aria-label="Must fix" />
              )}
            </span>
            <span className="flex flex-col gap-0.5">
              <span className={cn('text-[13px] font-medium leading-snug', c.level === 'ok' && 'text-ink-2')}>{c.title}</span>
              {c.note && <span className="text-xs leading-relaxed text-muted">{c.note}</span>}
            </span>
          </li>
        ))}
        {!checks && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-5" />)}
      </ul>
    </Panel>
  );
}

function DesignEditorDialog({ open, onOpenChange, html, onChange }: { open: boolean; onOpenChange: (o: boolean) => void; html: string; onChange: (h: string) => void }) {
  const fields = useFields();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgb(23_21_59/0.4)] animate-in" />
        <DialogPrimitive.Content className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-[18px] bg-surface shadow-[var(--shadow-pop)] animate-pop focus:outline-none sm:inset-4">
          <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
            <div className="flex flex-col">
              <DialogPrimitive.Title className="text-base font-semibold">Edit design</DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-xs text-muted">Changes save automatically.</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="primary" size="sm">
                Done
              </Button>
            </DialogPrimitive.Close>
          </div>
          {open && <VisualEditor html={html} onChange={onChange} fields={fields.data?.fields ?? []} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SubjectInput({ value, onChange, fields, ...rest }: { value: string; onChange: (v: string) => void; fields: ReturnType<typeof useFields>['data']; id: string; placeholder?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const insert = (tag: string) => {
    const el = ref.current;
    const at = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? at;
    const next = value.slice(0, at) + tag + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + tag.length, at + tag.length);
    });
  };
  return (
    <div className="flex gap-2">
      <Input ref={ref} {...rest} value={value} onChange={(e) => onChange(e.target.value)} className="flex-1" />
      <MergeTagMenu
        fields={fields?.fields ?? []}
        onInsert={insert}
        trigger={
          <Button variant="secondary" size="icon" className="h-11 w-11" aria-label="Insert personalisation">
            <Braces className="h-4 w-4" />
          </Button>
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------- composer

function Composer({ id }: { id: string }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user, tenant } = useSession();
  const tz = tenant.timezone;
  const fields = useFields();
  const lists = useLists();
  const labelOf = useFieldLabel();
  const senders = useQuery({ queryKey: ['senders'], queryFn: () => api.get<{ senders: Sender[] }>('/api/senders') });
  const q = useQuery({ queryKey: ['campaign', id], queryFn: () => api.get<{ campaign: Campaign }>(`/api/campaigns/${id}`) });
  const c = q.data?.campaign;

  const [draft, setDraft] = useState<Draft | null>(null);
  const saved = useRef<Draft | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState<'to' | 'from' | 'subject' | 'content' | 'files' | null>(null);
  const [device, setDevice] = useState<Device>('desktop');
  const [editing, setEditing] = useState(false);
  const [changingDesign, setChangingDesign] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (c && !draft) {
      const d = toDraft(c);
      saved.current = d;
      setDraft(d);
      // Open the first part that still needs something, in letter order
      setOpen(!d.senderId ? 'from' : d.audience?.mode === 'temporary' && !d.audience.addresses?.length ? 'to' : !d.subject ? 'subject' : null);
    }
  }, [c, draft]);

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    if (!draft || !saved.current) return;
    const diff = Object.fromEntries(Object.entries(draft).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(saved.current![k as keyof Draft])));
    if (!Object.keys(diff).length) return;
    setSaveState('saving');
    try {
      const body: Record<string, unknown> = { ...diff };
      if ('attachments' in body) body.attachments = draft.attachments.map((a) => a.id);
      if ('subject' in body) body.subject = draft.subject || null;
      if ('previewText' in body) body.previewText = draft.previewText || null;
      const r = await api.patch<{ campaign: Campaign }>(`/api/campaigns/${id}`, body);
      saved.current = { ...saved.current, ...diff } as Draft;
      qc.setQueryData(['campaign', id], r);
      setSaveState('saved');
      setVersion((v) => v + 1);
    } catch (e) {
      setSaveState('error');
      if (e instanceof ApiError) toast.error(e.message);
    }
  }, [draft, id, qc]);

  useEffect(() => {
    if (!draft) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 700);
    return () => clearTimeout(timer.current);
  }, [draft, save]);

  const preview = useQuery({
    queryKey: ['campaign-preview', id, version],
    queryFn: () => api.post<CampaignPreview>(`/api/campaigns/${id}/preview`),
    enabled: !!c,
    placeholderData: (prev) => prev,
  });

  const count = useAudienceCount(draft?.audience ?? null);
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  // Actions
  const [testTo, setTestTo] = useState(user.email ?? "");
  const test = useMutation({
    mutationFn: async () => {
      await save();
      return api.post<{ results: { to: string; ok: boolean; error?: string }[]; previewAs: string | null }>(`/api/campaigns/${id}/test`, {
        emails: testTo.split(/[\s,;]+/).filter(Boolean),
      });
    },
    onSuccess: (r) => {
      const failed = r.results.filter((x) => !x.ok);
      if (!failed.length) toast.success(`Test sent to ${r.results.map((x) => x.to).join(', ')}`, { description: r.previewAs ? `Personalised as ${r.previewAs}` : undefined });
      else toast.error(failed[0]!.error ?? 'The test didn’t send', { description: failed[0]!.to });
    },
  });
  const [when, setWhen] = useState(() => nextAt(1, 10, tz));
  const after = (r: { campaign: Campaign }, msg: string, go?: string) => {
    qc.setQueryData(['campaign', id], r);
    qc.invalidateQueries({ queryKey: ['campaigns'] });
    qc.invalidateQueries({ queryKey: ['overview'] });
    toast.success(msg);
    if (go) nav(go);
  };
  const schedule = useMutation({
    mutationFn: async () => {
      await save();
      return api.post<{ campaign: Campaign }>(`/api/campaigns/${id}/schedule`, { scheduledAt: toIso(when, tz) });
    },
    onSuccess: (r) => {
      takeoff();
      after(r, `Scheduled for ${dateTime(r.campaign.scheduledAt)}`, '/email/broadcasts?tab=SCHEDULED');
    },
  });
  const unschedule = useMutation({
    mutationFn: () => api.post<{ campaign: Campaign }>(`/api/campaigns/${id}/unschedule`),
    onSuccess: (r) => after(r, 'Unscheduled. It’s a draft again.'),
  });
  const send = useMutation({
    mutationFn: async () => {
      await save();
      return api.post<{ campaign: Campaign }>(`/api/campaigns/${id}/send`);
    },
    onSuccess: (r) => {
      takeoff();
      after(r, 'Sending started', `/campaigns/${id}`);
    },
    onError: (e: Error) => {
      setConfirmSend(false);
      toast.error(e.message);
    },
  });

  const sender = senders.data?.senders.find((s) => s.id === draft?.senderId);
  const readySenders = senders.data?.senders.filter((s) => s.readyToSend) ?? [];
  const audienceText = useMemo(() => (draft ? describeAudience(draft.audience, lists.data?.lists ?? [], labelOf) : ''), [draft, lists.data, labelOf]);

  if (q.error) return <Navigate to="/email/broadcasts" replace />;
  if (!c || !draft) return <Skeleton className="h-[600px] rounded-[var(--radius-panel)]" />;
  if (c.status !== 'DRAFT' && c.status !== 'SCHEDULED') return <Navigate to={`/campaigns/${id}`} replace />;

  const checks = preview.data?.checks;
  const canSend = preview.data?.canSend ?? false;
  const recipients = count.data?.count ?? preview.data?.recipients ?? 0;
  const firstError = checks?.find((x) => x.level === 'error');
  const errorFor = (ids: string[]) => !!checks?.some((x) => x.level === 'error' && ids.includes(x.id));

  return (
    <>
      {/* Header */}
      <header className="flex flex-col gap-4">
        <Link to="/email/broadcasts" className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Email: broadcasts
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <label className="group relative min-w-0 flex-1">
              <span className="sr-only">Broadcast name</span>
              <input
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                onBlur={() => !draft.name.trim() && set({ name: 'Untitled broadcast' })}
                className="w-full max-w-xl truncate rounded-lg bg-transparent px-1 py-0.5 -ml-1 text-[26px] font-semibold tracking-[-0.025em] outline-none hover:bg-hover focus:bg-surface focus:shadow-[0_0_0_2px_var(--color-accent)]"
              />
            </label>
            <CampaignStatusBadge status={c.status} />
            <span className="hidden items-center gap-1.5 text-xs text-muted sm:inline-flex" aria-live="polite">
              {saveState === 'saving' ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> Saving
                </>
              ) : saveState === 'error' ? (
                <span className="text-danger">Not saved</span>
              ) : (
                <>
                  <Check className="h-3 w-3" /> Saved
                </>
              )}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Popover
              align="end"
              className="w-[340px] p-4"
              trigger={
                <Button>
                  <FlaskConical className="h-4 w-4" />
                  Send a test
                </Button>
              }
            >
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  test.mutate();
                }}
              >
                <Field
                  label="Send a test to"
                  hint="Up to 5 addresses, separated by commas. The subject starts with [Test]."
                  error={test.error instanceof ApiError ? test.error.field('emails') ?? test.error.message : undefined}
                >
                  {(p) => <Input {...p} value={testTo} onChange={(e) => setTestTo(e.target.value)} />}
                </Field>
                <Button type="submit" variant="primary" loading={test.isPending}>
                  Send test
                </Button>
              </form>
            </Popover>
            {c.status === 'SCHEDULED' ? (
              <Button loading={unschedule.isPending} onClick={() => unschedule.mutate()}>
                Unschedule
              </Button>
            ) : (
              <Popover
                align="end"
                className="w-[360px] p-4"
                trigger={
                  <Button>
                    <CalendarClock className="h-4 w-4" />
                    Schedule
                  </Button>
                }
              >
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      ['Tomorrow, 10 AM', nextAt(1, 10, tz)],
                      ['Tomorrow, 6 PM', nextAt(1, 18, tz)],
                      ['Saturday, 10 AM', nextAt(0, 10, tz, 6)],
                      ['Monday, 9 AM', nextAt(0, 9, tz, 1)],
                    ].map(([label, v]) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setWhen(v!)}
                        className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold', when === v ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line hover:bg-sunken')}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <Field label="Date and time" hint={`India time (${tz}). Sends even if nobody is signed in.`} error={schedule.error?.message}>
                    {(p) => <Input {...p} type="datetime-local" value={when} min={toLocalInput(new Date(), tz)} onChange={(e) => setWhen(e.target.value)} />}
                  </Field>
                  <Button variant="primary" loading={schedule.isPending} disabled={!canSend || !when} onClick={() => schedule.mutate()}>
                    <Clock3 className="h-4 w-4" />
                    Schedule for {when ? dateTime(toIso(when, tz)) : '…'}
                  </Button>
                  {!canSend && firstError && (
                    <p className="text-xs text-warm-strong">
                      {firstError.title} {firstError.note}
                    </p>
                  )}
                </div>
              </Popover>
            )}
            <SendNowButton canSend={canSend} checks={checks} onSend={() => setConfirmSend(true)} />
          </div>
        </div>
        {c.status === 'SCHEDULED' && c.scheduledAt && (
          <div className="flex items-center gap-3 rounded-[14px] border border-[#cdd9ea] bg-blue-soft px-4 py-3 text-sm text-blue-ink">
            <CalendarClock className="h-4 w-4 shrink-0" />
            <span>
              Scheduled for <strong className="font-semibold">{dateTime(c.scheduledAt)}</strong>. Your edits are saved into it until then.
            </span>
          </div>
        )}
        {c.lastError && (
          <div className="flex items-center gap-3 rounded-[14px] border border-[#f3c9a8] bg-warm-soft px-4 py-3 text-sm text-warm-strong">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            <span>{c.lastError}</span>
          </div>
        )}
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        {/* Left: the parts of the letter, in order */}
        <div className="flex flex-col gap-3">
          <Step
            icon={<Mail className="h-4 w-4" />}
            number={1}
            next={{ label: 'Next: To', onClick: () => setOpen('to') }}
            title="From"
            summary={sender ? `${sender.fromName} <${sender.fromEmail}>` : 'Choose who it’s from'}
            done={!!sender?.readyToSend}
            error={errorFor(['sender'])}
            open={open === 'from'}
            onToggle={() => setOpen(open === 'from' ? null : 'from')}
          >
            {senders.data && senders.data.senders.length === 0 ? (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm text-muted">Connect your domain or a Gmail account first, so emails come from your own address.</p>
                <LinkButton to="/email/setup" size="sm" variant="primary">
                  Connect an address
                </LinkButton>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {senders.data?.senders.map((s) => (
                  <label
                    key={s.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-[12px] border px-4 py-3',
                      draft.senderId === s.id ? 'border-accent bg-accent-soft/40 shadow-[0_0_0_1px_var(--color-accent)]' : 'border-line hover:bg-sunken',
                      !s.readyToSend && 'opacity-60',
                    )}
                  >
                    <input type="radio" name="sender" className="sr-only" checked={draft.senderId === s.id} disabled={!s.readyToSend} onChange={() => set({ senderId: s.id })} />
                    {draft.senderId === s.id ? <CheckCircle2 className="h-4 w-4 text-accent" /> : <Circle className="h-4 w-4 text-faint" />}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-semibold">{s.fromName}</span>
                      <span className="truncate text-[13px] text-muted">{s.fromEmail}</span>
                    </span>
                    <Badge tone={s.kind === 'DOMAIN' ? 'grey' : 'blue'}>{s.kind === 'DOMAIN' ? 'Your domain' : 'Gmail'}</Badge>
                    {!s.readyToSend && <Badge tone="orange">Not ready</Badge>}
                  </label>
                ))}
                {sender?.kind === 'GMAIL' && sender.mailbox && (
                  <p className="text-xs leading-relaxed text-muted">
                    Gmail lets this address send about {n(sender.mailbox.dailyLimit)} emails a day. Bigger campaigns continue automatically the next day. Opens and clicks aren’t tracked for Gmail.
                  </p>
                )}
                {readySenders.length === 0 && <p className="text-xs text-warm-strong">None of your addresses are ready yet. Finish setup in Settings.</p>}
              </div>
            )}
          </Step>

          <Step
            icon={<Users className="h-4 w-4" />}
            number={2}
            next={{ label: 'Next: Subject', onClick: () => setOpen('subject') }}
            title="To"
            summary={
              <>
                {audienceText} <span className="tnum font-normal text-muted">({n(recipients)} {recipients === 1 ? 'person' : 'people'})</span>
              </>
            }
            done={recipients > 0 && !errorFor(['audience', 'quota'])}
            error={errorFor(['audience', 'quota'])}
            open={open === 'to'}
            onToggle={() => setOpen(open === 'to' ? null : 'to')}
          >
            <AudienceEditor allowTemporary value={draft.audience} onChange={(a) => set({ audience: a })} />
          </Step>

          <Step
            icon={<Pencil className="h-4 w-4" />}
            number={3}
            next={{ label: 'Next: Message', onClick: () => setOpen('content') }}
            title="Subject"
            summary={draft.subject ? <PrettyTags text={draft.subject} /> : 'Write a subject line'}
            done={!!draft.subject && !errorFor(['subject', 'unknown_tags'])}
            error={errorFor(['subject', 'unknown_tags'])}
            open={open === 'subject'}
            onToggle={() => setOpen(open === 'subject' ? null : 'subject')}
          >
            <div className="flex flex-col gap-5">
              <Field label="Subject line" aside={`${draft.subject.length} / 60`} hint="Short and specific works best. Personalise with the { } button.">
                {(p) => <SubjectInput {...p} value={draft.subject} onChange={(v) => set({ subject: v })} fields={fields.data} placeholder="{first_name|Hello}, Goa seats are open for December" />}
              </Field>
              <Field label="Preview text" aside={`${draft.previewText.length} / 90`} hint="The grey line after the subject in most inboxes.">
                {(p) => <Textarea {...p} className="min-h-0" rows={2} value={draft.previewText} onChange={(e) => set({ previewText: e.target.value })} placeholder="3 nights, flights included, from ₹18,500" />}
              </Field>
            </div>
          </Step>

          <Step
            icon={<LayoutTemplate className="h-4 w-4" />}
            number={4}
            next={{ label: 'Next: Attachments', onClick: () => setOpen('files') }}
            title="Message"
            summary={draft.html ? (errorFor(['content']) ? 'Needs content' : checks?.some((x) => x.id === 'placeholders') ? 'Design chosen, placeholders left to replace' : 'Design ready') : 'Pick a design'}
            done={!!draft.html && !checks?.some((x) => x.id === 'placeholders' || x.id === 'content')}
            error={errorFor(['content'])}
            open={open === 'content'}
            onToggle={() => setOpen(open === 'content' ? null : 'content')}
          >
            <div className="flex flex-col gap-4 sm:flex-row">
              <button type="button" onClick={() => setEditing(true)} className="w-full shrink-0 overflow-hidden rounded-[12px] border border-line hover:border-accent sm:w-48" aria-label="Edit design">
                <EmailThumbnail html={draft.html} height={170} />
              </button>
              <div className="flex flex-col gap-3">
                <p className="text-sm leading-relaxed text-muted">Click into the email to change text, links and images. Anything in [BRACKETS] needs replacing before you can send.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" onClick={() => setEditing(true)} disabled={!draft.html}>
                    <Pencil className="h-4 w-4" />
                    Edit design
                  </Button>
                  <Button size="sm" onClick={() => setChangingDesign(true)}>
                    Change design
                  </Button>
                </div>
              </div>
            </div>
          </Step>

          <Step
            icon={<Paperclip className="h-4 w-4" />}
            number={5}
            next={{ label: 'Done: check and send', onClick: () => setOpen(null) }}
            title="Attachments"
            summary={draft.attachments.length ? describeFiles(draft.attachments) : 'Optional: brochure, itinerary, photos'}
            done={draft.attachments.length > 0 && !errorFor(['attachments'])}
            error={errorFor(['attachments'])}
            open={open === 'files'}
            onToggle={() => setOpen(open === 'files' ? null : 'files')}
          >
            <AttachmentPicker channel="EMAIL" value={draft.attachments} onChange={(attachments) => set({ attachments })} />
          </Step>
        </div>

        {/* Right: live preview + checks */}
        <div className="flex flex-col gap-4 xl:sticky xl:top-6">
          <Panel className="flex flex-col gap-4 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <h2 className="text-[15px] font-semibold">Preview</h2>
                <span className="truncate text-xs text-muted">
                  {preview.data?.previewAs ? `Personalised for ${preview.data.previewAs.firstName ?? preview.data.previewAs.email}` : 'Personalised with sample details'}
                </span>
              </div>
              <DeviceToggle value={device} onChange={setDevice} />
            </div>
            <EmailPreview
              html={preview.data?.rendered?.html ?? null}
              device={device}
              fromName={sender?.fromName ?? tenant.name}
              subject={preview.data?.rendered?.subject ?? draft.subject}
              previewText={draft.previewText}
              attachments={draft.attachments}
            />
          </Panel>
          <ChecksPanel checks={checks} loading={preview.isFetching} />
        </div>
      </div>

      <DesignEditorDialog
        open={editing}
        onOpenChange={(o) => {
          setEditing(o);
          if (!o) save();
        }}
        html={draft.html ?? ''}
        onChange={(html) => set({ html })}
      />

      <Dialog open={changingDesign} onOpenChange={setChangingDesign} title="Change design" description="Your subject and audience stay. The email body is replaced." className="max-w-5xl">
        <DesignGallery
          onPick={(d) => {
            set({ html: d.html, ...(draft.subject ? {} : { subject: d.subject ?? '' }), ...(draft.previewText ? {} : { previewText: d.previewText ?? '' }) });
            setChangingDesign(false);
            setOpen('content');
          }}
        />
      </Dialog>

      <Dialog
        open={confirmSend}
        onOpenChange={setConfirmSend}
        title={`Send to ${n(recipients)} ${recipients === 1 ? 'person' : 'people'} now?`}
        description={
          <>
            From <strong className="font-semibold text-ink">{sender?.fromEmail}</strong>, subject “{draft.subject}”. Once it starts, it can be stopped but not unsent.
          </>
        }
        footer={
          <>
            <Button onClick={() => setConfirmSend(false)}>Not yet</Button>
            <Button variant="primary" loading={send.isPending} onClick={() => send.mutate()}>
              <Send className="h-4 w-4" />
              Send now
            </Button>
          </>
        }
      />
    </>
  );
}

export function ComposerPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['campaign', id], queryFn: () => api.get<{ campaign: Campaign }>(`/api/campaigns/${id}`), enabled: !!id });
  useNavSection(q.data ? (q.data.campaign.channel === 'WHATSAPP' ? 'whatsapp' : 'email') : null);
  if (!id) return <NewCampaign />;
  if (q.error) return <Navigate to="/email/broadcasts" replace />;
  if (!q.data) return <Skeleton className="h-[600px] rounded-[var(--radius-panel)]" />;
  const c = q.data.campaign;
  if (c.status !== 'DRAFT' && c.status !== 'SCHEDULED') return <Navigate to={`/campaigns/${id}`} replace />;
  return c.channel === 'WHATSAPP' ? <WhatsAppComposer key={id} c={c} /> : <Composer key={id} id={id} />;
}

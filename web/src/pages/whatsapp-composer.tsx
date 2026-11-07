import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bold, Braces, CalendarClock, Check, Clock3, FlaskConical, Italic, Loader2, MessageCircle, Send, Strikethrough, TriangleAlert, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AudienceEditor, describeAudience, useAudienceCount, useFieldLabel, useLists } from '@/components/campaigns/audience';
import { useFields } from '@/components/contacts/contact-sheet';
import { MergeTagMenu } from '@/components/email/visual-editor';
import { Button, LinkButton } from '@/components/ui/button';
import { Badge, Panel } from '@/components/ui/display';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Dialog, Popover, Tooltip } from '@/components/ui/overlay';
import { WhatsAppPreview } from '@/components/whatsapp/preview';
import { AttachmentPicker, describeFiles } from '@/components/attachments/attachments';
import { useWhatsApp } from '@/components/whatsapp/settings';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dateTime, n, phone as formatPhone } from '@/lib/format';
import { useSession } from '@/lib/session';
import { CampaignStatusBadge } from '@/lib/status';
import { PrettyTags } from '@/lib/tags';
import type { Attachment, Audience, Campaign, CampaignPreview } from '@/lib/types';
import { ChecksPanel, nextAt, Step, toIso, toLocalInput } from './composer';
import { takeoff } from '@/lib/celebrate';
import { showWhatsAppSafetyTips } from '@/components/whatsapp/safety-tips';

const MAX = 4096;
interface Draft {
  name: string;
  text: string;
  audience: Audience | null;
  attachments: Attachment[];
}

export const WHATSAPP_STARTER = 'Namaste {first_name|there} 🙏\n\n*[TRIP NAME]* has a few seats left for [DATES].\n\nReply to this message to book, or call us on [PHONE].\n\n_Reply STOP to stop these messages._';

/** Wraps the selected text with WhatsApp formatting (*bold*, _italic_, ~strike~). */
function wrap(el: HTMLTextAreaElement | null, value: string, mark: string, set: (v: string) => void) {
  if (!el) return;
  const { selectionStart: a, selectionEnd: b } = el;
  const sel = value.slice(a, b) || 'text';
  const next = value.slice(0, a) + mark + sel + mark + value.slice(b);
  set(next);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(a + mark.length, a + mark.length + sel.length);
  });
}

/** The WhatsApp message box: formatting buttons, personal fields and a character count. */
export function WhatsAppTextEditor({ value, onChange, rows = 10, placeholder = 'Namaste {first_name|there}…' }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fields = useFields();
  const draft = { text: value };
  const set = (p: { text: string }) => onChange(p.text);
  return (
    <>
      <div className="flex flex-wrap items-center gap-1 rounded-[10px] border border-line bg-sunken p-1">
        {(
          [
            ['Bold', '*', Bold],
            ['Italic', '_', Italic],
            ['Strikethrough', '~', Strikethrough],
          ] as const
        ).map(([label, mark, Icon]) => (
          <Tooltip key={label} content={`${label} (${mark}text${mark})`}>
            <button type="button" aria-label={label} onClick={() => wrap(ref.current, draft.text, mark, (v) => set({ text: v }))} className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 hover:bg-hover">
              <Icon className="h-4 w-4" />
            </button>
          </Tooltip>
        ))}
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <MergeTagMenu
          fields={fields.data?.fields ?? []}
          onInsert={(t) => {
            const el = ref.current;
            const at = el?.selectionStart ?? draft.text.length;
            const end = el?.selectionEnd ?? at;
            set({ text: draft.text.slice(0, at) + t + draft.text.slice(end) });
            requestAnimationFrame(() => {
              el?.focus();
              el?.setSelectionRange(at + t.length, at + t.length);
            });
          }}
          trigger={
            <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-ink-2 hover:bg-hover">
              <Braces className="h-4 w-4" />
              Personalise
            </button>
          }
        />
        <span className={cn('tnum ml-auto pr-2 text-xs', draft.text.length > MAX ? 'text-danger' : 'text-muted')}>
          {n(draft.text.length)} / {n(MAX)}
        </span>
      </div>
      <Textarea
        ref={ref}
        aria-label="Message"
        rows={rows}
        value={draft.text}
        onChange={(e) => set({ text: e.target.value })}
        placeholder={placeholder}
        className="min-h-[220px] text-[15px] leading-relaxed"
      />
    </>
  );
}

export function WhatsAppComposer({ c }: { c: Campaign }) {
  const id = c.id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const { tenant } = useSession();
  const tz = tenant.timezone;
  const fields = useFields();
  const lists = useLists();
  const labelOf = useFieldLabel();
  const wa = useWhatsApp();
  const ref = useRef<HTMLTextAreaElement>(null);

  const [draft, setDraft] = useState<Draft>(() => ({ name: c.name, text: c.text ?? '', audience: c.audience, attachments: c.attachments ?? [] }));
  const saved = useRef<Draft>(draft);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState<'to' | 'from' | 'message' | null>(!c.text || /\[[A-Z]/.test(c.text) ? 'message' : null);
  const [confirmSend, setConfirmSend] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    const diff = Object.fromEntries(Object.entries(draft).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(saved.current[k as keyof Draft])));
    if (!Object.keys(diff).length) return;
    setSaveState('saving');
    try {
      const body: Record<string, unknown> = { ...diff };
      if ('attachments' in body) body.attachments = draft.attachments.map((a) => a.id);
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
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 600);
    return () => clearTimeout(timer.current);
  }, [draft, save]);

  const preview = useQuery({
    queryKey: ['campaign-preview', id, version],
    queryFn: () => api.post<CampaignPreview>(`/api/campaigns/${id}/preview`),
    placeholderData: (prev) => prev,
  });
  const count = useAudienceCount(draft.audience, 'WHATSAPP');
  const audienceText = useMemo(() => describeAudience(draft.audience, lists.data?.lists ?? [], labelOf), [draft.audience, lists.data, labelOf]);

  const after = (r: { campaign: Campaign }, msg: string, go?: string) => {
    qc.setQueryData(['campaign', id], r);
    qc.invalidateQueries({ queryKey: ['campaigns'] });
    toast.success(msg);
    if (go) nav(go);
  };
  const [testTo, setTestTo] = useState('');
  const test = useMutation({
    mutationFn: async () => {
      await save();
      return api.post<{ queued: string[] }>(`/api/campaigns/${id}/test`, { phones: testTo.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean) });
    },
    onSuccess: (r) => toast.success(`Test on its way to ${r.queued.map(formatPhone).join(', ')}`, { description: 'It starts with [Test]. Give it a few seconds.' }),
  });
  const [when, setWhen] = useState(() => nextAt(1, 10, tz));
  const schedule = useMutation({
    mutationFn: async () => {
      await save();
      return api.post<{ campaign: Campaign }>(`/api/campaigns/${id}/schedule`, { scheduledAt: toIso(when, tz) });
    },
    onSuccess: (r) => {
      takeoff();
      showWhatsAppSafetyTips();
      after(r, `Scheduled for ${dateTime(r.campaign.scheduledAt)}`, '/whatsapp/broadcasts?tab=SCHEDULED');
    },
  });
  const unschedule = useMutation({ mutationFn: () => api.post<{ campaign: Campaign }>(`/api/campaigns/${id}/unschedule`), onSuccess: (r) => after(r, 'Unscheduled. It’s a draft again.') });
  const send = useMutation({
    mutationFn: async () => {
      await save();
      return api.post<{ campaign: Campaign }>(`/api/campaigns/${id}/send`);
    },
    onSuccess: (r) => {
      takeoff();
      showWhatsAppSafetyTips();
      after(r, 'Sending started', `/campaigns/${id}`);
    },
    onError: (e: Error) => {
      setConfirmSend(false);
      toast.error(e.message);
    },
  });

  const checks = preview.data?.checks;
  const canSend = preview.data?.canSend ?? false;
  const recipients = count.data?.count ?? preview.data?.recipients ?? 0;
  const errorFor = (ids: string[]) => !!checks?.some((x) => x.level === 'error' && ids.includes(x.id));
  const linked = wa.data?.status === 'CONNECTED';
  const firstError = checks?.find((x) => x.level === 'error');
  const hours = wa.data ? (Math.min(recipients, wa.data.dailyLimit) * wa.data.intervalSeconds) / 3600 : 0;

  return (
    <>
      <header className="flex flex-col gap-4">
        <Link to="/whatsapp/broadcasts" className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> WhatsApp: broadcasts
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#e7f8ee] text-[#128c4a]" title="WhatsApp broadcast">
              <MessageCircle className="h-[18px] w-[18px]" />
            </span>
            <input
              aria-label="Broadcast name"
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              onBlur={() => !draft.name.trim() && set({ name: 'Untitled broadcast' })}
              className="-ml-1 w-full max-w-xl truncate rounded-lg bg-transparent px-1 py-0.5 text-[26px] font-semibold tracking-[-0.025em] outline-none hover:bg-hover focus:bg-surface focus:shadow-[0_0_0_2px_var(--color-accent)]"
            />
            <CampaignStatusBadge status={c.status} />
            <span className="hidden items-center gap-1.5 text-xs text-muted sm:inline-flex" aria-live="polite">
              {saveState === 'saving' ? <Loader2 className="h-3 w-3 animate-spin" /> : saveState === 'saved' ? <Check className="h-3 w-3" /> : null}
              {saveState === 'saving' ? 'Saving' : saveState === 'saved' ? 'Saved' : <span className="text-danger">Not saved</span>}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Popover
              align="end"
              className="w-[320px] p-4"
              trigger={
                <Button disabled={!linked}>
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
                <Field label="Send a test to" hint="Up to 3 numbers, separated by commas." error={test.error instanceof ApiError ? test.error.field('phones') ?? test.error.message : undefined}>
                  {(p) => <Input {...p} inputMode="tel" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="98480 22338" />}
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
                className="w-[340px] p-4"
                trigger={
                  <Button>
                    <CalendarClock className="h-4 w-4" />
                    Schedule
                  </Button>
                }
              >
                <div className="flex flex-col gap-4">
                  <Field label="Date and time" hint={`India time (${tz}). The linked phone must stay on and connected.`} error={schedule.error?.message}>
                    {(p) => <Input {...p} type="datetime-local" value={when} min={toLocalInput(new Date(), tz)} onChange={(e) => setWhen(e.target.value)} />}
                  </Field>
                  <Button variant="primary" loading={schedule.isPending} disabled={!canSend || !when} onClick={() => schedule.mutate()}>
                    <Clock3 className="h-4 w-4" />
                    Schedule for {when ? dateTime(toIso(when, tz)) : '…'}
                  </Button>
                  {!canSend && firstError && <p className="text-xs text-warm-strong">{firstError.title}</p>}
                </div>
              </Popover>
            )}
            <Button variant="primary" disabled={!canSend} onClick={() => setConfirmSend(true)}>
              <Send className="h-4 w-4" />
              Send now
            </Button>
          </div>
        </div>
        {c.lastError && (
          <div className="flex items-center gap-3 rounded-[14px] border border-[#f3c9a8] bg-warm-soft px-4 py-3 text-sm text-warm-strong">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            {c.lastError}
          </div>
        )}
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
        <div className="flex flex-col gap-3">
          <Step
            icon={<Users className="h-4 w-4" />}
            title="To"
            summary={
              <>
                {audienceText} <span className="tnum font-normal text-muted">({n(recipients)} on WhatsApp)</span>
              </>
            }
            done={recipients > 0}
            error={errorFor(['audience'])}
            open={open === 'to'}
            onToggle={() => setOpen(open === 'to' ? null : 'to')}
          >
            <AudienceEditor allowTemporary channel="WHATSAPP" value={draft.audience} onChange={(a) => set({ audience: a })} />
          </Step>

          <Step
            icon={<MessageCircle className="h-4 w-4" />}
            title="From"
            summary={linked ? `${wa.data?.displayName ? `${wa.data.displayName}, ` : ''}${formatPhone(wa.data?.phone)}` : 'Link your WhatsApp number'}
            done={linked}
            error={!linked}
            open={open === 'from'}
            onToggle={() => setOpen(open === 'from' ? null : 'from')}
          >
            {linked ? (
              <p className="text-sm leading-relaxed text-muted">
                Sends from the number linked in Settings, one message every {wa.data?.intervalSeconds} seconds, up to {n(wa.data?.dailyLimit)} a day.
                {recipients > 0 && ` This campaign takes about ${hours < 1 ? `${Math.max(1, Math.round(hours * 60))} minutes` : `${Math.round(hours * 10) / 10} hours`}${recipients > (wa.data?.dailyLimit ?? 0) ? ' a day, over several days' : ''}.`}
              </p>
            ) : (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm text-muted">Link the WhatsApp number you want to send from. It takes a minute: scan a QR code with the phone.</p>
                <LinkButton to="/whatsapp/setup" variant="primary" size="sm">
                  Link WhatsApp
                </LinkButton>
              </div>
            )}
          </Step>

          <Step
            icon={<Braces className="h-4 w-4" />}
            title="Message"
            summary={
              draft.text ? (
                <>
                  <PrettyTags text={draft.text.split('\n')[0]!.slice(0, 80)} />
                  {draft.attachments.length > 0 && <span className="font-normal text-muted"> · {describeFiles(draft.attachments)}</span>}
                </>
              ) : draft.attachments.length ? (
                describeFiles(draft.attachments)
              ) : (
                'Write the message'
              )
            }
            done={(!!draft.text.trim() || draft.attachments.length > 0) && !errorFor(['content', 'placeholders', 'unknown_tags'])}
            error={errorFor(['content', 'placeholders', 'unknown_tags'])}
            open={open === 'message'}
            onToggle={() => setOpen(open === 'message' ? null : 'message')}
          >
            <div className="flex flex-col gap-3">
              <WhatsAppTextEditor value={draft.text} onChange={(text) => set({ text })} />
              <p className="text-xs leading-relaxed text-muted">
                Keep it short and personal, like a message you’d type yourself. Ending with “Reply STOP to stop these messages” lowers the chance of being reported.
              </p>
              <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
                <span className="text-[13px] font-semibold">Photos, videos and files</span>
                <AttachmentPicker channel="WHATSAPP" value={draft.attachments} onChange={(attachments) => set({ attachments })} />
              </div>
            </div>
          </Step>
        </div>

        <div className="flex flex-col gap-4 xl:sticky xl:top-6">
          <Panel className="flex flex-col gap-4 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <h2 className="text-[15px] font-semibold">Preview</h2>
                <span className="text-xs text-muted">{preview.data?.previewAs ? `As ${preview.data.previewAs.firstName ?? formatPhone(preview.data.previewAs.phone)} will see it` : 'With sample details'}</span>
              </div>
              <Badge tone="grey">WhatsApp</Badge>
            </div>
            <WhatsAppPreview text={preview.data?.rendered?.text ?? draft.text} businessName={wa.data?.displayName || tenant.name} phone={formatPhone(wa.data?.phone) || null} attachments={draft.attachments} />
          </Panel>
          <ChecksPanel checks={checks} loading={preview.isFetching} />
        </div>
      </div>

      <Dialog
        open={confirmSend}
        onOpenChange={setConfirmSend}
        title={`Send to ${n(recipients)} ${recipients === 1 ? 'person' : 'people'} on WhatsApp?`}
        description={`From ${formatPhone(wa.data?.phone)}, one every ${wa.data?.intervalSeconds} seconds. Keep the phone on and connected until it finishes. It can be stopped, not unsent.`}
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

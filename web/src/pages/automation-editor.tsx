import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock, ChevronDown, Info, MoreHorizontal, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AudienceEditor, describeAudience, useAudienceCount, useFieldLabel, useLists } from '@/components/campaigns/audience';
import { useFields } from '@/components/contacts/contact-sheet';
import { EmailThumbnail } from '@/components/email/thumbnail';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, EmptyState, Panel, PanelHeader, Skeleton } from '@/components/ui/display';
import { Input } from '@/components/ui/field';
import { Dialog, Menu, MenuItem } from '@/components/ui/overlay';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { date, n } from '@/lib/format';
import { PrettyTags } from '@/lib/tags';
import type { Audience, Automation, CustomField, Sender, Starter, Template } from '@/lib/types';
import type { Upcoming } from './automations';

type Timing = 'before' | 'on' | 'after';
interface Draft {
  name: string;
  templateId: string;
  senderId: string;
  dateFieldId: string;
  days: number;
  timing: Timing;
  sendTime: string;
  repeat: 'ONCE' | 'YEARLY';
  audience: Audience | null;
}

const RECIPES = {
  trip: { name: 'Trip reminder, 3 days before', fieldKey: 'trip_date', fieldLabel: 'Trip date', starter: 'trip-reminder', days: 3, timing: 'before' as Timing, sendTime: '09:00', repeat: 'ONCE' as const },
  birthday: { name: 'Birthday wishes', fieldKey: 'birthday', fieldLabel: 'Birthday', starter: 'birthday', days: 0, timing: 'on' as Timing, sendTime: '08:30', repeat: 'YEARLY' as const },
};

const fromAutomation = (a: Automation): Draft => ({
  name: a.name,
  templateId: a.template?.id ?? '',
  senderId: a.sender?.id ?? '',
  dateFieldId: a.dateField.id,
  days: Math.abs(a.offsetDays),
  timing: a.offsetDays < 0 ? 'before' : a.offsetDays > 0 ? 'after' : 'on',
  sendTime: a.sendTime,
  repeat: a.repeat,
  audience: a.audience,
});
const toBody = (d: Draft) => ({
  name: d.name.trim() || 'Untitled automation',
  templateId: d.templateId || null,
  senderId: d.senderId || null,
  dateFieldId: d.dateFieldId,
  offsetDays: d.timing === 'on' ? 0 : d.timing === 'before' ? -d.days : d.days,
  sendTime: d.sendTime,
  repeat: d.repeat,
  audience: d.audience,
});

/** A select that reads as part of a sentence. */
function Pick({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative inline-flex max-w-full align-baseline">
      <select
        {...props}
        className={cn(
          'max-w-full cursor-pointer appearance-none truncate rounded-[10px] border border-transparent bg-accent-soft py-1 pl-3 pr-8 font-semibold text-accent-strong outline-none transition-colors hover:border-accent/40 focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-soft)] aria-[invalid=true]:bg-warm-soft aria-[invalid=true]:text-warm-strong',
          className,
        )}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-accent-strong/70" aria-hidden />
    </span>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2 py-4 sm:grid-cols-[96px_minmax(0,1fr)] sm:items-baseline">
      <span className="text-[13px] font-semibold text-muted">{label}</span>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-2 text-[17px] leading-relaxed">{children}</div>
    </div>
  );
}

function UpcomingPanel({ id, tz }: { id?: string; tz: string }) {
  const q = useQuery({ queryKey: ['automation-upcoming', id, 14], queryFn: () => api.get<Upcoming>(`/api/automations/${id}/upcoming?days=14`), enabled: !!id });
  return (
    <Panel className="flex flex-col gap-4 p-5 sm:p-6">
      <PanelHeader title="Coming up" description="Who gets it in the next 14 days, if it’s on." />
      {!id ? (
        <p className="text-sm leading-relaxed text-muted">Save it once to see exactly who will get it, day by day.</p>
      ) : !q.data ? (
        <Skeleton className="h-40" />
      ) : q.data.days.length === 0 ? (
        <EmptyState icon={<CalendarClock />} title="Nobody in the next 14 days">
          {q.data.audience.withDate === 0 ? 'None of your contacts have this date filled in yet. Add it in Contacts or with a CSV import.' : `${n(q.data.audience.withDate)} contacts have this date. None of them fall in the next two weeks.`}
        </EmptyState>
      ) : (
        <ol className="relative flex flex-col gap-4 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-line">
          {q.data.days.map((d) => (
            <li key={d.day} className="relative flex flex-col gap-2 pl-6">
              <span className="absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-surface bg-accent ring-1 ring-accent/30" aria-hidden />
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold">{date(d.day + 'T12:00:00Z', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })}</span>
                <span className="tnum text-[13px] text-muted">
                  {n(d.count)} {d.count === 1 ? 'email' : 'emails'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {d.people.map((p) => (
                  <span key={p.email} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-0.5 pl-0.5 pr-2.5 text-xs font-medium" title={p.email}>
                    <Avatar name={p.name} email={p.email} size={20} />
                    {p.name}
                  </span>
                ))}
                {d.count > d.people.length && <span className="px-1 py-0.5 text-xs text-muted">and {n(d.count - d.people.length)} more</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {q.data && q.data.audience.withDate > 0 && (
        <p className="border-t border-line-soft pt-3 text-xs text-muted">
          {n(q.data.audience.withDate)} subscribed contacts have this date filled in.
        </p>
      )}
    </Panel>
  );
}

export function AutomationEditorPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const recipe = RECIPES[params.get('recipe') as keyof typeof RECIPES];
  const nav = useNavigate();
  const qc = useQueryClient();
  const fields = useFields();
  const lists = useLists();
  const labelOf = useFieldLabel();
  const senders = useQuery({ queryKey: ['senders'], queryFn: () => api.get<{ senders: Sender[] }>('/api/senders') });
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api.get<{ templates: Template[] }>('/api/templates') });
  const starters = useQuery({ queryKey: ['starters'], queryFn: () => api.get<{ starters: Starter[] }>('/api/templates/starters'), staleTime: Infinity });
  const existing = useQuery({ queryKey: ['automation', id], queryFn: () => api.get<{ automation: Automation }>(`/api/automations/${id}`), enabled: !!id });
  const a = existing.data?.automation;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingAudience, setEditingAudience] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dateFields = (fields.data?.fields ?? []).filter((f) => f.type === 'DATE');

  // Start from the saved automation, or a recipe, or blank
  useEffect(() => {
    if (draft) return;
    if (id) {
      if (a) setDraft(fromAutomation(a));
      return;
    }
    if (!fields.data || !senders.data) return;
    const def = senders.data.senders.find((s) => s.isDefault && s.readyToSend) ?? senders.data.senders.find((s) => s.readyToSend);
    const field = recipe ? dateFields.find((f) => f.key === recipe.fieldKey) : dateFields[0];
    setDraft({
      name: recipe?.name ?? '',
      templateId: '',
      senderId: def?.id ?? '',
      dateFieldId: field?.id ?? '',
      days: recipe?.days ?? 3,
      timing: recipe?.timing ?? 'before',
      sendTime: recipe?.sendTime ?? '09:00',
      repeat: recipe?.repeat ?? 'ONCE',
      audience: null,
    });
  }, [draft, id, a, fields.data, senders.data, recipe, dateFields]);

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const createField = useMutation({
    mutationFn: (label: string) => api.post<{ field: CustomField }>('/api/fields', { label, type: 'DATE' }),
    onSuccess: ({ field }) => {
      qc.invalidateQueries({ queryKey: ['fields'] });
      set({ dateFieldId: field.id });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const fromStarter = useMutation({
    mutationFn: (starterId: string) => api.post<{ template: Template }>('/api/templates/from-starter', { starterId }),
    onSuccess: ({ template }) => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      set({ templateId: template.id });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const template = useQuery({ queryKey: ['template', draft?.templateId], queryFn: () => api.get<{ template: Template }>(`/api/templates/${draft!.templateId}`), enabled: !!draft?.templateId });
  const count = useAudienceCount(draft?.audience ?? null);

  const save = useMutation({
    mutationFn: async (activate: boolean) => {
      const body = toBody(draft!);
      const saved = id ? await api.patch<{ automation: Automation }>(`/api/automations/${id}`, body) : await api.post<{ automation: Automation }>('/api/automations', body);
      if (activate && saved.automation.status !== 'ACTIVE') return api.post<{ automation: Automation }>(`/api/automations/${saved.automation.id}/activate`).then((r) => ({ ...r, created: !id }));
      return { ...saved, created: !id };
    },
    onSuccess: ({ automation, created }, activate) => {
      qc.setQueryData(['automation', automation.id], { automation });
      qc.invalidateQueries({ queryKey: ['automations'] });
      qc.invalidateQueries({ queryKey: ['automation-upcoming', automation.id] });
      setDraft(fromAutomation(automation));
      toast.success(activate ? `“${automation.name}” is on` : 'Saved', activate ? { description: 'From now on. Dates that already passed are skipped.' } : undefined);
      if (created) nav(`/automations/${automation.id}`, { replace: true });
    },
    onError: (e: Error) => {
      if (!(e instanceof ApiError && e.details?.fields)) toast.error(e.message);
    },
  });
  const pause = useMutation({
    mutationFn: () => api.post<{ automation: Automation }>(`/api/automations/${id}/pause`),
    onSuccess: ({ automation }) => {
      qc.setQueryData(['automation', id], { automation });
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Paused');
    },
  });
  const del = useMutation({
    mutationFn: () => api.del(`/api/automations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Automation deleted');
      nav('/automations');
    },
    onError: (e: Error) => {
      setConfirmDelete(false);
      toast.error(e.message);
    },
  });

  // When a recipe asks for a starter design, create it once
  useEffect(() => {
    if (!id && recipe && draft && !draft.templateId && templates.data && !fromStarter.isPending && !fromStarter.isSuccess) {
      const name = starters.data?.starters.find((s) => s.id === recipe.starter)?.name;
      const already = templates.data.templates.find((t) => t.name === name);
      if (already) set({ templateId: already.id });
      else if (starters.data) fromStarter.mutate(recipe.starter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, recipe, draft?.templateId, templates.data, starters.data]);

  const dirty = useMemo(() => (a && draft ? JSON.stringify(toBody(fromAutomation(a))) !== JSON.stringify(toBody(draft)) : true), [a, draft]);

  if (id && existing.error) return <Navigate to="/automations" replace />;
  if (!draft) return <Skeleton className="h-[520px] rounded-[var(--radius-panel)]" />;

  const field = dateFields.find((f) => f.id === draft.dateFieldId);
  const err = (k: string) => (save.error instanceof ApiError ? save.error.field(k) : undefined);
  const audienceText = describeAudience(draft.audience, lists.data?.lists ?? [], labelOf);
  const on = a?.status === 'ACTIVE';
  const ready = !!draft.templateId && !!draft.senderId && !!draft.dateFieldId;
  const fieldIsYearly = field && /birth|anniversar/i.test(field.label);

  return (
    <>
      <header className="flex flex-col gap-4">
        <Link to="/automations" className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Automations
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <input
              aria-label="Automation name"
              value={draft.name}
              placeholder="Name this automation"
              onChange={(e) => set({ name: e.target.value })}
              className="-ml-1 w-full max-w-xl rounded-lg bg-transparent px-1 py-0.5 text-[26px] font-semibold tracking-[-0.025em] outline-none placeholder:text-faint hover:bg-hover focus:bg-surface focus:shadow-[0_0_0_2px_var(--color-accent)]"
            />
            {a && (
              <Badge tone={on ? 'green' : a.status === 'PAUSED' ? 'orange' : 'grey'} dot>
                {on ? 'On' : a.status === 'PAUSED' ? 'Paused' : 'Draft'}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {a && (
              <Menu
                trigger={
                  <Button variant="ghost" size="icon" aria-label="More">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                }
              >
                <MenuItem icon={<Trash2 />} danger onSelect={() => setConfirmDelete(true)}>
                  Delete
                </MenuItem>
              </Menu>
            )}
            {on ? (
              <>
                <Button onClick={() => pause.mutate()} loading={pause.isPending}>
                  <Pause className="h-4 w-4" />
                  Pause
                </Button>
                <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(false)}>
                  Save changes
                </Button>
              </>
            ) : (
              <>
                <Button disabled={!dirty && !!a} loading={save.isPending && !save.variables} onClick={() => save.mutate(false)}>
                  {a ? 'Save' : 'Save as draft'}
                </Button>
                <Button variant="accent" disabled={!ready} loading={save.isPending && save.variables} onClick={() => save.mutate(true)}>
                  <Play className="h-4 w-4" />
                  {a ? 'Save and switch on' : 'Switch on'}
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
        <div className="flex flex-col gap-6">
          <Panel className="px-5 py-2 sm:px-7">
            <div className="divide-y divide-line-soft">
              <Line label="Send">
                <Pick
                  aria-label="Email to send"
                  aria-invalid={!draft.templateId || !!err('templateId') || undefined}
                  value={draft.templateId}
                  onChange={(e) => (e.target.value.startsWith('starter:') ? fromStarter.mutate(e.target.value.slice(8)) : set({ templateId: e.target.value }))}
                >
                  <option value="">Choose an email</option>
                  {templates.data?.templates.length ? (
                    <optgroup label="Your templates">
                      {templates.data.templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  <optgroup label="Start from a ready-made design">
                    {starters.data?.starters.map((s) => (
                      <option key={s.id} value={`starter:${s.id}`}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                </Pick>
              </Line>

              <Line label="When">
                {draft.timing !== 'on' && (
                  <>
                    <Input
                      aria-label="Number of days"
                      type="number"
                      min={1}
                      max={365}
                      value={draft.days}
                      onChange={(e) => set({ days: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })}
                      className="tnum h-9 w-[72px] px-2.5 text-center text-[17px] font-semibold"
                    />
                    <span>{draft.days === 1 ? 'day' : 'days'}</span>
                  </>
                )}
                <Pick aria-label="Before, on or after" value={draft.timing} onChange={(e) => set({ timing: e.target.value as Timing, days: e.target.value === 'on' ? 0 : draft.days || 1 })}>
                  <option value="before">before</option>
                  <option value="on">on</option>
                  <option value="after">after</option>
                </Pick>
                <span>each person’s</span>
                {dateFields.length ? (
                  <Pick aria-label="Date field" aria-invalid={!draft.dateFieldId || undefined} value={draft.dateFieldId} onChange={(e) => set({ dateFieldId: e.target.value })}>
                    {!draft.dateFieldId && <option value="">choose a date</option>}
                    {dateFields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </Pick>
                ) : (
                  <span className="inline-flex flex-wrap gap-2">
                    {['Trip date', 'Birthday'].map((l) => (
                      <Button key={l} size="sm" onClick={() => createField.mutate(l)} loading={createField.isPending && createField.variables === l}>
                        Add a “{l}” field
                      </Button>
                    ))}
                  </span>
                )}
              </Line>

              <Line label="At">
                <Input
                  aria-label="Time of day"
                  type="time"
                  step={900}
                  value={draft.sendTime}
                  onChange={(e) => e.target.value && set({ sendTime: e.target.value })}
                  className="tnum h-9 w-[150px] px-2.5 text-[17px] font-semibold"
                />
                <span className="text-muted">India time,</span>
                <Pick aria-label="How often" value={draft.repeat} onChange={(e) => set({ repeat: e.target.value as Draft['repeat'] })}>
                  <option value="ONCE">once</option>
                  <option value="YEARLY">every year</option>
                </Pick>
              </Line>

              <Line label="From">
                <Pick aria-label="Sender" aria-invalid={!draft.senderId || undefined} value={draft.senderId} onChange={(e) => set({ senderId: e.target.value })}>
                  <option value="">choose an address</option>
                  {senders.data?.senders.map((s) => (
                    <option key={s.id} value={s.id} disabled={!s.readyToSend}>
                      {s.fromName} &lt;{s.fromEmail}&gt;{s.readyToSend ? '' : ' (not ready)'}
                    </option>
                  ))}
                </Pick>
              </Line>

              <Line label="To">
                <span>{audienceText}</span>
                <span className="tnum text-[15px] text-muted">({count.data ? n(count.data.count) : '…'} people)</span>
                <Button size="sm" variant="ghost" onClick={() => setEditingAudience(true)}>
                  Change
                </Button>
              </Line>
            </div>
          </Panel>

          {fieldIsYearly && draft.repeat === 'ONCE' && (
            <p className="flex items-start gap-2 rounded-[14px] bg-blue-soft px-4 py-3 text-[13px] text-blue-ink">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              {field!.label} comes round every year. Choose “every year” so people get it each time, not just once.
            </p>
          )}

          <Panel className="flex flex-col gap-4 p-5 sm:flex-row sm:p-6">
            <div className="w-full shrink-0 overflow-hidden rounded-[12px] border border-line sm:w-52">
              {template.data ? <EmailThumbnail html={template.data.template.html} height={180} /> : <div className="grid h-[180px] place-items-center bg-sunken text-xs text-muted">{draft.templateId ? 'Loading…' : 'No email chosen'}</div>}
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <h2 className="text-[15px] font-semibold">The email</h2>
              {template.data ? (
                <>
                  <p className="text-sm">
                    <span className="text-muted">Subject: </span>
                    <span className="font-medium">{template.data.template.subject ? <PrettyTags text={template.data.template.subject} /> : 'No subject yet'}</span>
                  </p>
                  <p className="text-[13px] leading-relaxed text-muted">
                    Uses fields like {field ? <PrettyTags text={`{${field.key}}`} /> : 'the date'} so each person sees their own details. Changes to the template apply to emails sent from then on.
                  </p>
                  <Link to={`/templates/${template.data.template.id}`} className="mt-1 inline-flex items-center gap-1.5 self-start text-[13px] font-semibold text-accent hover:text-accent-strong">
                    <Pencil className="h-3.5 w-3.5" />
                    Edit this template
                  </Link>
                </>
              ) : (
                <p className="text-[13px] leading-relaxed text-muted">Choose a template, or start from the ready-made Trip reminder or Birthday design.</p>
              )}
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-4 xl:sticky xl:top-6">
          <UpcomingPanel id={id} tz={a?.timezone ?? 'Asia/Kolkata'} />
          <Panel className="flex flex-col gap-2.5 p-5 text-[13px] leading-relaxed text-muted">
            <p className="font-semibold text-ink">Good to know</p>
            <p>Switching on starts from now: dates that already passed are skipped, so nobody gets a late reminder.</p>
            <p>Each person gets it once per date, even if you pause and switch it on again.</p>
            <p>Birthdays on 29 February are sent on 28 February in other years.</p>
          </Panel>
        </div>
      </div>

      <Dialog open={editingAudience} onOpenChange={setEditingAudience} title="Who gets it" description="Only people with the date filled in will get it." className="max-w-xl" footer={<Button variant="primary" onClick={() => setEditingAudience(false)}>Done</Button>}>
        <AudienceEditor value={draft.audience} onChange={(au) => set({ audience: au })} />
      </Dialog>
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this automation?"
        description="Only automations that haven’t sent anything can be deleted. Otherwise, pause it to keep its history."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Keep it</Button>
            <Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>
              Delete
            </Button>
          </>
        }
      />
    </>
  );
}

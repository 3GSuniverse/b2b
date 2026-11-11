import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Bot,
  CheckCircle2,
  Clock3,
  Flame,
  Languages,
  Loader2,
  PhoneCall,
  PhoneForwarded,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Plus,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Timer,
  Trash2,
  UserRoundCheck,
  Wand2,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PracticeCall } from '@/components/calls/practice-call';
import { PlanLock } from '@/components/plan-lock';
import { Button } from '@/components/ui/button';
import { Segmented, Switch, Tabs } from '@/components/ui/controls';
import { Badge, CopyButton, EmptyState, PageHeader, Panel, PanelHeader, Skeleton, type Tone } from '@/components/ui/display';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Sheet } from '@/components/ui/overlay';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ago, dateTime, n, phone as formatPhone } from '@/lib/format';
import { useSession } from '@/lib/session';

/**
 * AI Caller: a voice assistant that answers the agency's phone when the team can't.
 * Customers hear a warm, natural voice in Telugu, Hindi or English that knows the agency's
 * packages and their own trips; the team gets a summary of every call and who to call back.
 */

type Lang = 'en' | 'te' | 'hi';
type Purpose = 'SALES' | 'SUPPORT' | 'BOTH';
type Outcome = 'INTERESTED' | 'NOT_INTERESTED' | 'CALLBACK' | 'NEEDS_HUMAN' | 'WRONG_NUMBER' | 'ANSWERED';
type Settings = {
  enabled: boolean;
  agentName: string;
  language: Lang;
  purpose: Purpose;
  greeting: string | null;
  instructions: string | null;
  callFrom: string | null;
  hoursFrom: string;
  hoursTo: string;
  suspended: { at: string; reason: string | null } | null;
};
type CallRow = { id: string; direction: 'IN' | 'OUT'; phone: string; status: string; outcome: Outcome | null; summary: string | null; seconds: number; createdAt: string };
type Overview = {
  allowed: boolean;
  ready: { voice: boolean; ai: boolean; line: boolean };
  settings: Settings;
  minutes: number;
  last30: { total: number; answered: number; interested: number; needsHuman: number; minutes: number };
  calls: CallRow[];
};
type Filter = 'ALL' | 'INTERESTED' | 'NEEDS_HUMAN' | 'NOT_INTERESTED';

const OUTCOME: Record<Outcome, { label: string; tone: Tone }> = {
  INTERESTED: { label: 'Interested', tone: 'green' },
  CALLBACK: { label: 'Call back', tone: 'orange' },
  NEEDS_HUMAN: { label: 'Call back', tone: 'orange' },
  NOT_INTERESTED: { label: 'Not interested', tone: 'grey' },
  WRONG_NUMBER: { label: 'Wrong number', tone: 'grey' },
  ANSWERED: { label: 'Answered', tone: 'blue' },
};

const duration = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`);

export function CallsPage() {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [params, setParams] = useSearchParams();
  const open = params.get('call');
  const q = useQuery({ queryKey: ['calls', filter], queryFn: () => api.get<Overview>(`/api/calls?outcome=${filter}`) });
  const d = q.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="AI Caller" description="Your agency’s voice assistant. It picks up when your team can’t, talks like a real person in Telugu, Hindi or English, and tells you who to call back." />
      <PlanLock feature="calls" />
      {!d ? (
        <div className="grid gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-72" />
        </div>
      ) : (
        <>
          <Hero d={d} />
          {d.settings.suspended && <SuspendedBand reason={d.settings.suspended.reason} />}
          {d.allowed && <PracticeCall />}
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-6">
              <SetupSteps s={d.settings} />
              <CallLog calls={d.calls} filter={filter} onFilter={setFilter} onOpen={(id) => setParams({ call: id })} />
            </div>
            <div className="flex flex-col gap-6">
              <SettingsPanel s={d.settings} allowed={d.allowed} />
              <SafetyPanel />
              <DoNotCall />
            </div>
          </div>
        </>
      )}
      <CallSheet id={open} onClose={() => setParams({})} />
    </div>
  );
}

function Hero({ d }: { d: Overview }) {
  const s = d.settings;
  const live = s.enabled && !s.suspended && !!s.callFrom && d.minutes > 0 && d.ready.voice && d.ready.ai && d.ready.line;
  const state = s.suspended
    ? { label: 'Switched off for safety', dot: 'bg-[#ff6b7a]' }
    : live
      ? { label: 'Answering calls', dot: 'bg-[#3ee6a5]' }
      : s.enabled
        ? { label: !s.callFrom ? 'Waiting for your calling number' : d.minutes <= 0 ? 'Out of minutes' : 'Getting the line ready', dot: 'bg-highlight' }
        : { label: 'Switched off', dot: 'bg-nav-muted' };
  return (
    <section className="relative overflow-hidden rounded-[24px] bg-[linear-gradient(125deg,#1d1a4d_0%,#4a3fd1_55%,#a2348f_100%)] p-6 text-white shadow-[0_24px_60px_-28px_#4a3fd1] sm:p-8">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-highlight/30 blur-3xl [animation:glow-drift_9s_ease-in-out_infinite]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-[#3ee6a5]/20 blur-3xl [animation:glow-drift_12s_ease-in-out_infinite_reverse]" />
      <div className="relative flex flex-col gap-7 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-5">
          <PulsePhone live={live} />
          <div className="flex flex-col gap-1.5">
            <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-[12.5px] font-semibold backdrop-blur">
              <span className={cn('h-2 w-2 rounded-full', state.dot, live && 'animate-pulse')} />
              {state.label}
            </span>
            <h2 className="text-[26px] font-extrabold tracking-[-0.02em] sm:text-[30px]">
              Hi, I’m {s.agentName} <span className="inline-block [animation:nav-wiggle_1.8s_ease-in-out_infinite]">👋</span>
            </h2>
            <p className="max-w-md text-[14px] leading-relaxed text-white/80">
              {s.callFrom ? (
                <>
                  I answer calls on <b className="text-white">{formatPhone(s.callFrom)}</b> in {s.language === 'te' ? 'Telugu' : s.language === 'hi' ? 'Hindi' : 'English'}, and switch language when your customer does.
                </>
              ) : (
                'Once your calling number is ready, forward your phone to it and I’ll start answering.'
              )}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[540px]">
          <HeroStat icon={<Timer />} label="Minutes left" value={n(d.minutes)} warn={d.minutes <= 30} />
          <HeroStat icon={<PhoneIncoming />} label="Calls, 30 days" value={n(d.last30.total)} />
          <HeroStat icon={<Flame />} label="Interested" value={n(d.last30.interested)} />
          <HeroStat icon={<UserRoundCheck />} label="To call back" value={n(d.last30.needsHuman)} />
        </div>
      </div>
    </section>
  );
}

function PulsePhone({ live }: { live: boolean }) {
  return (
    <div className="relative grid h-[84px] w-[84px] shrink-0 place-items-center">
      {live && (
        <>
          <span className="absolute inset-0 rounded-full bg-white/20 animate-ping [animation-duration:2.2s]" />
          <span className="absolute inset-2 rounded-full bg-white/15 animate-ping [animation-delay:0.7s] [animation-duration:2.2s]" />
        </>
      )}
      <span className="relative grid h-[68px] w-[68px] place-items-center rounded-full bg-white text-accent shadow-[0_10px_30px_-8px_rgb(0_0_0/0.45)]">
        <PhoneCall className={cn('h-8 w-8', live && '[animation:nav-wiggle_1.4s_ease-in-out_infinite]')} />
        <span className="absolute -right-1 -top-1 grid h-7 w-7 place-items-center rounded-full bg-highlight text-white ring-4 ring-[#3a2f9e]">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
      </span>
    </div>
  );
}

function HeroStat({ icon, label, value, warn }: { icon: ReactNode; label: string; value: string; warn?: boolean }) {
  return (
    <div className={cn('flex flex-col gap-1 rounded-[16px] bg-white/10 p-3.5 backdrop-blur transition-transform duration-300 hover:-translate-y-0.5 hover:bg-white/15', warn && 'ring-1 ring-highlight/80')}>
      <span className="text-white/70 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <span className="tnum text-[22px] font-extrabold leading-none">{value}</span>
      <span className="text-[12px] font-medium text-white/70">{label}</span>
    </div>
  );
}

function SuspendedBand({ reason }: { reason: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[16px] bg-danger-soft px-4 py-3.5 text-[13.5px] text-danger">
      <ShieldAlert className="h-5 w-5 shrink-0" />
      <p className="flex-1">
        <b>AI Caller is switched off for safety.</b> Someone wrote instructions that could cheat people on the phone{reason ? ` (${reason.toLowerCase()})` : ''}. The Drona team is reviewing it.
      </p>
      <Link to="/help/new" className="font-semibold underline underline-offset-4">
        Contact customer care
      </Link>
    </div>
  );
}

const FORWARD = [
  { code: '**61*', label: 'When you don’t pick up', note: 'Recommended', tone: 'green' as const },
  { code: '**67*', label: 'When you’re on another call', note: 'Recommended', tone: 'green' as const },
  { code: '**62*', label: 'When your phone is off or out of network', note: 'Recommended', tone: 'green' as const },
  { code: '**21*', label: 'Every call, always', note: 'Your phone won’t ring', tone: 'orange' as const },
];

function SetupSteps({ s }: { s: Settings }) {
  const num = s.callFrom ? s.callFrom.replace(/^\+91/, '0') : null;
  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader title="Get your calls answered in 3 steps" description="Customers keep calling your usual number. When your team can’t pick up, the call comes to the AI Caller instead." />
      <ol className="mt-5 flex flex-col gap-5">
        <Step n={1} done={!!s.callFrom} title="Your Dhrona calling number">
          {s.callFrom ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="tnum rounded-xl bg-accent-soft px-3 py-1.5 text-[16px] font-bold text-accent">{formatPhone(s.callFrom)}</span>
              <CopyButton value={num!} label="Copy number" />
            </div>
          ) : (
            <p className="text-[13.5px] text-muted">
              The Drona team sets this up for your agency. <Link className="font-semibold text-accent hover:underline" to="/help/new">Ask for your calling number</Link>
            </p>
          )}
        </Step>
        <Step n={2} done={false} title="Forward your phone to it">
          <p className="mb-3 text-[13.5px] text-muted">On the phone your customers call, dial one of these codes and press call. Do all three green ones so the AI only answers when your team can’t.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {FORWARD.map((f) => {
              const dial = num ? `${f.code}${num}#` : `${f.code}<number>#`;
              return (
                <div key={f.code} className="group flex items-center justify-between gap-2 rounded-[14px] border border-line bg-sunken px-3.5 py-2.5 transition-colors hover:border-accent/40 hover:bg-accent-soft/40">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[13px] font-semibold">{f.label}</span>
                    <span className="tnum truncate font-mono text-[13px] text-accent">{dial}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge tone={f.tone}>{f.note}</Badge>
                    {num && <CopyButton value={dial} label="Copy" />}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2.5 text-[12.5px] text-faint">
            To stop forwarding, dial <span className="font-mono">##002#</span>. On Jio, or if a code doesn’t work: Phone app → Settings → Calls → Call forwarding.
          </p>
        </Step>
        <Step n={3} done={s.enabled && !s.suspended} title="Switch it on">
          <p className="text-[13.5px] text-muted">Choose the voice’s name and language on the right, then switch it on. Every call shows up below with a summary.</p>
        </Step>
      </ol>
    </Panel>
  );
}

function Step({ n: num, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-bold transition-colors', done ? 'bg-success text-white' : 'bg-accent-soft text-accent')}>
        {done ? <CheckCircle2 className="h-4 w-4" /> : num}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
        <h3 className="text-[14.5px] font-semibold">{title}</h3>
        {children}
      </div>
    </li>
  );
}

const LANGS: { value: Lang; label: string }[] = [
  { value: 'te', label: 'తెలుగు' },
  { value: 'hi', label: 'हिंदी' },
  { value: 'en', label: 'English' },
];
const PURPOSES: { value: Purpose; label: string }[] = [
  { value: 'BOTH', label: 'Both' },
  { value: 'SUPPORT', label: 'Answer questions' },
  { value: 'SALES', label: 'Sell trips' },
];
const DEFAULT_GREETING: Record<Lang, (name: string, agency: string) => string> = {
  en: (a, g) => `Namaste! This is ${a}, the AI assistant of ${g}. How may I help you today?`,
  te: (a, g) => `నమస్కారం! నేను ${a}, ${g} యొక్క AI అసిస్టెంట్‌ని. మీకు ఎలా సహాయం చేయగలను?`,
  hi: (a, g) => `नमस्ते! मैं ${a}, ${g} की AI असिस्टेंट बोल रही हूँ। बताइए, मैं आपकी क्या मदद कर सकती हूँ?`,
};

function SettingsPanel({ s, allowed }: { s: Settings; allowed: boolean }) {
  const { user, tenant } = useSession();
  const qc = useQueryClient();
  const canEdit = user.role !== 'MEMBER' && !s.suspended;
  const [f, setF] = useState(s);
  useEffect(() => setF(s), [s]);
  const dirty = JSON.stringify(f) !== JSON.stringify(s);
  const save = useMutation({
    mutationFn: (next: Settings) =>
      api.put<Settings>('/api/calls/settings', {
        enabled: next.enabled,
        agentName: next.agentName,
        language: next.language,
        purpose: next.purpose,
        greeting: next.greeting?.trim() || null,
        instructions: next.instructions?.trim() || null,
        hoursFrom: next.hoursFrom,
        hoursTo: next.hoursTo,
      }),
    onSuccess: (r) => {
      toast.success(r.enabled ? `${r.agentName} is ready to answer your calls 🎉` : 'Saved');
      void qc.invalidateQueries({ queryKey: ['calls'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'call_misuse') {
        toast.error(e.message, { duration: 12_000 });
        void qc.invalidateQueries({ queryKey: ['calls'] });
      } else toast.error(e instanceof Error ? e.message : 'Couldn’t save');
    },
  });
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setF((x) => ({ ...x, [k]: v }));

  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader
        title="Your assistant"
        description={canEdit ? 'How it sounds and what it talks about.' : s.suspended ? 'Locked while the Drona team reviews it.' : 'Only the owner and managers can change this.'}
        action={
          <Switch
            label="AI Caller on"
            checked={f.enabled}
            disabled={!canEdit || (!allowed && !f.enabled)}
            onCheckedChange={(v) => {
              const next = { ...f, enabled: v };
              setF(next);
              save.mutate(next);
            }}
          />
        }
      />
      <fieldset disabled={!canEdit} className="mt-5 flex flex-col gap-4 disabled:opacity-70">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Field label="Assistant’s name" hint="A friendly name customers will hear">
            {(p) => <Input {...p} value={f.agentName} maxLength={30} onChange={(e) => set('agentName', e.target.value)} leading={<Bot className="h-4 w-4" />} />}
          </Field>
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Languages className="h-3.5 w-3.5 text-accent" /> Starts in
            </span>
            <Segmented label="Language" value={f.language} onChange={(v) => set('language', v)} options={LANGS} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold">What should it do?</span>
          <Segmented label="Purpose" value={f.purpose} onChange={(v) => set('purpose', v)} options={PURPOSES} />
        </div>
        <Field label="First words" hint="Leave empty for our greeting. It always says it’s an AI assistant." aside={`${(f.greeting ?? '').length}/300`}>
          {(p) => <Textarea {...p} rows={2} maxLength={300} value={f.greeting ?? ''} placeholder={DEFAULT_GREETING[f.language](f.agentName || 'Asha', tenant.name)} onChange={(e) => set('greeting', e.target.value)} />}
        </Field>
        <Field label="Anything it should know or mention" hint="Offers, timings, what to suggest. It also reads your packages, your Drona AI notes and the caller’s own trips." aside={`${(f.instructions ?? '').length}/2000`}>
          {(p) => (
            <Textarea {...p} rows={4} maxLength={2000} value={f.instructions ?? ''} placeholder="e.g. Mention our Kerala December offer. Office is open 10 am to 7 pm, Monday to Saturday. For group bookings, say our manager will call back." onChange={(e) => set('instructions', e.target.value)} />
          )}
        </Field>
        {canEdit && (
          <div className="flex items-center justify-end gap-2">
            {dirty && (
              <Button variant="ghost" type="button" onClick={() => setF(s)}>
                Undo
              </Button>
            )}
            <Button variant="primary" type="button" disabled={!dirty || save.isPending || f.agentName.trim().length < 2} onClick={() => save.mutate(f)}>
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Save
            </Button>
          </div>
        )}
      </fieldset>
    </Panel>
  );
}

function SafetyPanel() {
  const rules = ['Always says it’s an AI assistant', 'Never asks for OTPs, PINs, card or bank details', 'Never pretends to be a bank, police or government', 'Stops calling anyone who says “don’t call me”'];
  return (
    <Panel className="overflow-hidden">
      <div className="flex items-start gap-3 bg-[linear-gradient(120deg,#ddf5ea,#e2effb)] p-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-success text-white">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-[15px] font-semibold">Safe for your customers, always</h2>
          <p className="text-[13px] leading-relaxed text-ink-2">Instructions that try to cheat people switch the AI Caller off at once, and switch off the login that wrote them.</p>
        </div>
      </div>
      <ul className="grid gap-2 p-5 sm:grid-cols-2">
        {rules.map((r) => (
          <li key={r} className="flex items-start gap-2 text-[13px]">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            {r}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function CallLog({ calls, filter, onFilter, onOpen }: { calls: CallRow[]; filter: Filter; onFilter: (f: Filter) => void; onOpen: (id: string) => void }) {
  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader title="Calls" description="Every call the assistant took, with what the customer wanted." />
      <div className="mt-4">
        <Tabs
          label="Show"
          value={filter}
          onChange={onFilter}
          tabs={[
            { value: 'ALL', label: 'All' },
            { value: 'INTERESTED', label: 'Interested' },
            { value: 'NEEDS_HUMAN', label: 'Call back' },
            { value: 'NOT_INTERESTED', label: 'Not interested' },
          ]}
        />
      </div>
      {calls.length === 0 ? (
        <EmptyState icon={<PhoneMissed />} title={filter === 'ALL' ? 'No calls yet' : 'Nothing here'}>
          {filter === 'ALL' ? 'When your phone is forwarded, every call the assistant answers shows up here with a summary.' : 'Calls with this result will show up here.'}
        </EmptyState>
      ) : (
        <ul className="mt-3 flex flex-col">
          {calls.map((c, i) => {
            const o = c.outcome ? OUTCOME[c.outcome] : null;
            return (
              <li key={c.id} style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }} className="animate-[rise-in_400ms_both]">
                <button type="button" onClick={() => onOpen(c.id)} className="group flex w-full items-center gap-3 rounded-[14px] px-2 py-3 text-left transition-colors hover:bg-hover">
                  <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-full transition-transform group-hover:scale-110', c.outcome === 'INTERESTED' ? 'bg-success-soft text-success' : c.status === 'COMPLETED' ? 'bg-accent-soft text-accent' : 'bg-line-soft text-muted')}>
                    {c.direction === 'IN' ? <PhoneIncoming className="h-4 w-4" /> : <PhoneOutgoing className="h-4 w-4" />}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="tnum text-[14px] font-semibold">{formatPhone(c.phone)}</span>
                      {o && <Badge tone={o.tone}>{o.label}</Badge>}
                    </span>
                    <span className="truncate text-[13px] text-muted">{c.summary ?? (c.status === 'NO_ANSWER' ? 'Hung up before speaking' : c.status === 'FAILED' ? 'The line had trouble' : 'No summary')}</span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5 text-[12px] text-faint">
                    <span>{ago(c.createdAt)}</span>
                    <span className="tnum inline-flex items-center gap-1">
                      <Clock3 className="h-3 w-3" />
                      {duration(c.seconds)}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

type FullCall = CallRow & { transcript: { from: 'agent' | 'customer'; text: string }[]; minutesBilled: number; endedAt: string | null };

function CallSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['call', id], queryFn: () => api.get<{ call: FullCall }>(`/api/calls/log/${id}`), enabled: !!id });
  const c = q.data?.call;
  const o = c?.outcome ? OUTCOME[c.outcome] : null;
  return (
    <Sheet open={!!id} onOpenChange={(v) => !v && onClose()} title={c ? formatPhone(c.phone) : 'Call'} description={c ? `${dateTime(c.createdAt)} · ${duration(c.seconds)} · ${c.minutesBilled} min used` : undefined}>
      {!c ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="flex flex-col gap-5">
          {(c.summary || o) && (
            <div className="flex flex-col gap-2 rounded-[16px] bg-[linear-gradient(120deg,#ecebfd,#f6e8f4)] p-4">
              <span className="flex items-center gap-2 text-[12.5px] font-semibold text-accent">
                <Sparkles className="h-3.5 w-3.5" /> What they wanted {o && <Badge tone={o.tone}>{o.label}</Badge>}
              </span>
              {c.summary && <p className="text-[14px] leading-relaxed">{c.summary}</p>}
            </div>
          )}
          {c.transcript.length === 0 ? (
            <p className="text-[13.5px] text-muted">Nothing was said on this call.</p>
          ) : (
            <ol className="flex flex-col gap-2.5">
              {c.transcript.map((t, i) => (
                <li key={i} className={cn('flex', t.from === 'agent' ? 'justify-start' : 'justify-end')}>
                  <span className={cn('max-w-[85%] rounded-[18px] px-3.5 py-2.5 text-[13.5px] leading-relaxed', t.from === 'agent' ? 'rounded-bl-md bg-accent-soft text-ink' : 'rounded-br-md bg-accent text-white')}>
                    <span className={cn('mb-0.5 block text-[11px] font-semibold', t.from === 'agent' ? 'text-accent' : 'text-white/75')}>{t.from === 'agent' ? 'Assistant' : 'Customer'}</span>
                    {t.text}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <a href={`tel:${c.phone}`} className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-button)] bg-success px-4 py-3 text-[14px] font-semibold text-white transition-transform active:scale-[0.97]">
            <PhoneForwarded className="h-4 w-4" /> Call them back
          </a>
        </div>
      )}
    </Sheet>
  );
}

function DoNotCall() {
  const { user } = useSession();
  const canEdit = user.role !== 'MEMBER';
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['calls', 'do-not-call'], queryFn: () => api.get<{ numbers: { id: string; phone: string; reason: string | null; createdAt: string }[] }>('/api/calls/do-not-call') });
  const [num, setNum] = useState('');
  const add = useMutation({
    mutationFn: () => api.post<{ phone: string }>('/api/calls/do-not-call', { phone: num }),
    onSuccess: (r) => {
      toast.success(`${formatPhone(r.phone)} won’t get calls`);
      setNum('');
      void qc.invalidateQueries({ queryKey: ['calls', 'do-not-call'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Couldn’t add'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/calls/do-not-call/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['calls', 'do-not-call'] }),
  });
  const list = q.data?.numbers ?? [];
  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader title="Do-not-call list" description="People who asked not to be called. Anyone who says so on a call is added by itself." />
      {canEdit && (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (num.trim()) add.mutate();
          }}
        >
          <Input value={num} onChange={(e) => setNum(e.target.value)} placeholder="98480 12345" inputMode="tel" leading={<Ban className="h-4 w-4" />} aria-label="Phone number" />
          <Button type="submit" variant="secondary" disabled={!num.trim() || add.isPending}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </form>
      )}
      {list.length === 0 ? (
        <p className="mt-4 text-[13px] text-faint">Nobody yet.</p>
      ) : (
        <ul className="mt-3 flex max-h-64 flex-col overflow-auto">
          {list.map((x) => (
            <li key={x.id} className="flex items-center gap-3 border-b border-line-soft py-2 last:border-0">
              <span className="tnum flex-1 text-[13.5px] font-medium">{formatPhone(x.phone)}</span>
              <span className="text-[12px] text-faint">{x.reason ?? ago(x.createdAt)}</span>
              {canEdit && (
                <Button size="icon-sm" variant="danger-ghost" aria-label={`Remove ${x.phone}`} onClick={() => remove.mutate(x.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

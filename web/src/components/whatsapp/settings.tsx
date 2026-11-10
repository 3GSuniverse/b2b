import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2Off, Loader2, MessageCircle, RefreshCw, ShieldAlert, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Panel, PanelHeader, ProgressBar, Skeleton } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/field';
import { Dialog } from '@/components/ui/overlay';
import { api, ApiError } from '@/lib/api';
import { ago, n } from '@/lib/format';
import type { WhatsAppStatus } from '@/lib/types';
import { useSession } from '@/lib/session';

export function useWhatsApp(opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: ['whatsapp'],
    queryFn: () => api.get<{ whatsapp: WhatsAppStatus }>('/api/whatsapp').then((r) => r.whatsapp),
    // While linking, refresh fast so a new QR code (or "connected") shows up right away
    refetchInterval: (q) => (q.state.data?.status === 'CONNECTING' ? 2000 : opts.poll ? 30_000 : false),
  });
}

const STATUS: Record<WhatsAppStatus['status'], { label: string; tone: 'green' | 'orange' | 'grey' | 'red' }> = {
  CONNECTED: { label: 'Linked', tone: 'green' },
  CONNECTING: { label: 'Waiting for scan', tone: 'orange' },
  DISCONNECTED: { label: 'Not linked', tone: 'grey' },
  LOGGED_OUT: { label: 'Unlinked from phone', tone: 'orange' },
  BLOCKED: { label: 'Blocked by WhatsApp', tone: 'red' },
};

function RiskNote() {
  return (
    <div className="flex gap-3 rounded-[14px] border border-[#f3c9a8] bg-warm-soft px-4 py-3.5 text-[13px] leading-relaxed text-warm-strong">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="flex flex-col gap-1">
        <strong className="font-semibold">This links your number the way WhatsApp Web does. It isn’t WhatsApp’s official business API.</strong>
        <span>
          WhatsApp can block numbers that send in bulk this way, especially when people report the messages. Use a number you can afford to lose, message only people who expect to hear from you, and keep the pace slow.
        </span>
      </div>
    </div>
  );
}

function Linking({ wa, onCancel }: { wa: WhatsAppStatus; onCancel: () => void }) {
  return (
    <div className="grid items-center gap-8 md:grid-cols-[280px_minmax(0,1fr)]">
      <div className="grid h-[280px] w-[280px] place-items-center rounded-[18px] border border-line bg-white">
        {wa.qr ? (
          <img src={wa.qr} alt="QR code to link WhatsApp" className="h-[260px] w-[260px]" />
        ) : (
          <div className="flex flex-col items-center gap-3 text-[13px] text-muted">
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
            Getting a QR code from WhatsApp…
          </div>
        )}
      </div>
      <div className="flex flex-col gap-4">
        <h3 className="text-[15px] font-semibold">Scan with the phone that has this WhatsApp number</h3>
        <ol className="flex flex-col gap-3 text-sm">
          {['Open WhatsApp (or WhatsApp Business) on the phone', 'Tap ⋮ (Android) or Settings (iPhone), then Linked devices', 'Tap Link a device and point the camera at this code'].map((t, i) => (
            <li key={t} className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-white">{i + 1}</span>
              <span className="pt-0.5">{t}</span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted">The code changes every few seconds. This page updates by itself.</p>
        <Button variant="ghost" size="sm" className="self-start" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function WhatsAppSettings({ heading = true }: { heading?: boolean } = {}) {
  const qc = useQueryClient();
  const { tenant, user } = useSession();
  // One WhatsApp number per agency: only the owner or a Manager can link, unlink or change the pace
  const canManage = user.role !== 'MEMBER';
  const trial = tenant.plan?.plan === 'TRIAL' ? tenant.plan : null;
  const q = useWhatsApp({ poll: true });
  const wa = q.data;
  const [limits, setLimits] = useState<{ dailyLimit: number | null; intervalSeconds: number } | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  useEffect(() => {
    if (wa && !limits) setLimits({ dailyLimit: wa.ownDailyLimit ?? null, intervalSeconds: wa.intervalSeconds });
  }, [wa, limits]);

  const set = (r: { whatsapp: WhatsAppStatus }) => qc.setQueryData(['whatsapp'], r.whatsapp);
  const connect = useMutation({ mutationFn: () => api.post<{ whatsapp: WhatsAppStatus }>('/api/whatsapp/connect'), onSuccess: set, onError: (e: Error) => toast.error(e.message) });
  const disconnect = useMutation({
    mutationFn: () => api.post<{ whatsapp: WhatsAppStatus }>('/api/whatsapp/disconnect'),
    onSuccess: (r) => {
      set(r);
      setConfirmUnlink(false);
      toast.success('WhatsApp unlinked');
    },
  });
  const save = useMutation({
    mutationFn: () => api.patch<{ whatsapp: WhatsAppStatus }>('/api/whatsapp', limits!),
    onSuccess: (r) => {
      set(r);
      toast.success('Sending pace saved');
    },
  });

  // Celebrate the moment the scan succeeds
  const [was, setWas] = useState<WhatsAppStatus['status'] | null>(null);
  useEffect(() => {
    if (!wa) return;
    if (was === 'CONNECTING' && wa.status === 'CONNECTED') toast.success(`${wa.phone} is linked`, { description: 'You can send WhatsApp messages now.' });
    setWas(wa.status);
  }, [wa, was]);

  if (!wa || !limits) return <Skeleton className="h-72 rounded-[var(--radius-panel)]" />;
  const st = STATUS[wa.status];
  const dirty = limits.dailyLimit !== (wa.ownDailyLimit ?? null) || limits.intervalSeconds !== wa.intervalSeconds;
  const cap = wa.planPerDay ?? wa.trialPerDay ?? null;
  const errOf = (f: string) => (save.error instanceof ApiError ? save.error.field(f) : undefined);

  return (
    <div className="flex flex-col gap-5">
      {heading && <PanelHeader title="WhatsApp" description="Send WhatsApp messages and broadcasts from your own number. Messages appear in its chats like any you send from the phone." />}
      {trial?.whatsapp && (
        <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface px-4 py-3.5">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="font-semibold">Free trial: up to {n(trial.whatsapp.perDay)} WhatsApp messages a day</span>
            <span className="tnum text-muted">
              {n(trial.whatsapp.sentToday)} sent in the last 24 hours
            </span>
          </div>
          <ProgressBar value={trial.whatsapp.sentToday} max={trial.whatsapp.perDay} label="Trial WhatsApp messages sent today" tone={trial.whatsapp.sentToday / trial.whatsapp.perDay > 0.8 ? 'warm' : 'accent'} />
          <span className="text-xs text-muted">Bigger broadcasts continue the next day by themselves, until the trial ends. Each number can be used for one trial. When the trial ends, the number is unlinked automatically.</span>
        </div>
      )}
      <RiskNote />

      <Panel className="flex flex-col gap-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-[#e7f8ee] text-[#128c4a]">
            <MessageCircle className="h-5 w-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[15px] font-semibold">{wa.phone ? `${wa.displayName ? `${wa.displayName}, ` : ''}${wa.phone}` : 'No number linked'}</span>
            <span className="text-[13px] text-muted">{wa.status === 'CONNECTED' && wa.connectedAt ? `Linked ${ago(wa.connectedAt)}` : wa.lastError ?? 'Link a number to start.'}</span>
          </div>
          <Badge tone={st.tone} dot>
            {st.label}
          </Badge>
          {!canManage ? null : wa.status === 'CONNECTED' ? (
            <Button variant="danger-ghost" size="sm" onClick={() => setConfirmUnlink(true)}>
              <Link2Off className="h-4 w-4" />
              Unlink
            </Button>
          ) : wa.status !== 'CONNECTING' ? (
            <Button variant="primary" loading={connect.isPending} onClick={() => connect.mutate()}>
              {wa.status === 'DISCONNECTED' ? <Smartphone className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
              {wa.status === 'DISCONNECTED' ? 'Link WhatsApp' : 'Link again'}
            </Button>
          ) : null}
        </div>

        {!canManage && wa.status !== 'CONNECTED' && (
          <div className="flex items-start gap-3 rounded-[12px] bg-[#fff6e5] px-4 py-3 text-[13px] text-[#8a5a00]">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Your agency shares one WhatsApp number. Ask your agency owner or a Manager to link it. Once it’s linked, you can send WhatsApp messages and broadcasts from here.
            </span>
          </div>
        )}

        {canManage && wa.status === 'CONNECTING' && (
          <div className="border-t border-line-soft pt-6">
            <Linking wa={wa} onCancel={() => disconnect.mutate()} />
          </div>
        )}

        {wa.status === 'CONNECTED' && (
          <div className="flex flex-col gap-2 border-t border-line-soft pt-5">
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="font-medium">Sent in the last 24 hours</span>
              <span className="tnum text-muted">
                {n(wa.sentLast24h)} of {n(wa.dailyLimit)}
              </span>
            </div>
            <ProgressBar value={wa.sentLast24h} max={wa.dailyLimit} label="WhatsApp daily limit used" tone={wa.sentLast24h / wa.dailyLimit > 0.85 ? 'warm' : 'accent'} />
          </div>
        )}
      </Panel>

      <Panel className="flex flex-col gap-5 p-5 sm:p-6">
        <PanelHeader title="Sending pace" description="Slower is safer. Broadcasts bigger than the daily limit continue the next day by themselves." />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Messages per day"
            hint={
              cap
                ? `${wa.trialPerDay ? 'The free trial' : 'Your plan'} allows ${n(cap)} a day. Leave it empty to use all of it, or set less: a new number is safer starting around 100.`
                : 'Between 20 and 500. New numbers: start around 100.'
            }
            error={errOf('dailyLimit')}
          >
            {(p) => (
              <Input
                {...p}
                disabled={!canManage}
                type="number"
                min={20}
                max={cap ?? 500}
                placeholder={cap ? `${n(cap)} (your plan’s limit)` : '200'}
                value={limits.dailyLimit ?? ''}
                onChange={(e) => setLimits({ ...limits, dailyLimit: e.target.value === '' ? null : Number(e.target.value) })}
              />
            )}
          </Field>
          <Field label="Seconds between messages" hint="At least 6. We recommend 10 or more." error={errOf('intervalSeconds')}>
            {(p) => <Input {...p} disabled={!canManage} type="number" min={6} max={120} value={limits.intervalSeconds} onChange={(e) => setLimits({ ...limits, intervalSeconds: Number(e.target.value) })} />}
          </Field>
        </div>
        {!canManage && <p className="text-[13px] text-muted">Only your agency owner or a Manager can change the pace.</p>}
        <div className={canManage ? 'flex justify-end' : 'hidden'}>
          <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
            Save pace
          </Button>
        </div>
      </Panel>

      <Panel className="flex flex-col gap-2 p-5 text-[13px] leading-relaxed text-muted sm:p-6">
        <p className="font-semibold text-ink">How it behaves</p>
        <p>Only customers marked “Agreed to WhatsApp messages” with a phone number get WhatsApp broadcasts.</p>
        <p>If someone replies STOP, they’re unsubscribed from WhatsApp straight away and get a short confirmation.</p>
        <p>If the phone unlinks this device or WhatsApp blocks the number, sending pauses and you get an alert.</p>
      </Panel>

      <Dialog
        open={confirmUnlink}
        onOpenChange={setConfirmUnlink}
        title={`Unlink ${wa.phone}?`}
        description="WhatsApp messages stop until you link a number again. Your chats on the phone aren’t affected."
        footer={
          <>
            <Button onClick={() => setConfirmUnlink(false)}>Keep linked</Button>
            <Button variant="danger" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
              Unlink
            </Button>
          </>
        }
      />
    </div>
  );
}

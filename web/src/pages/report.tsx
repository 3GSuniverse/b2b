import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, ExternalLink, Info, MailX, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { DeviceToggle, EmailPreview, type Device } from '@/components/email/email-frame';
import { WhatsAppPreview } from '@/components/whatsapp/preview';
import { useNavSection } from '@/lib/section';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { EmptyState, Panel, PanelHeader, ProgressBar, Skeleton } from '@/components/ui/display';
import { Dialog } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dateTime, n, pct } from '@/lib/format';
import { CampaignStatusBadge } from '@/lib/status';
import { PrettyTags } from '@/lib/tags';
import type { Campaign, CampaignPreview, CampaignReport } from '@/lib/types';
import { CountPercent, CountUp } from '@/lib/motion';

const share = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

/** Sent → delivered → opened → clicked, each as a share of what was sent. */
function Funnel({ c, tracked }: { c: Campaign; tracked: boolean }) {
  const s = c.stats;
  const wa = c.channel === 'WHATSAPP';
  const steps = wa
    ? [
        { label: 'Sent', value: s.sent, note: `of ${n(s.recipients)} recipients` },
        { label: 'Delivered ✓✓', value: s.delivered, note: `${pct(share(s.delivered, s.sent))} of sent` },
        { label: 'Read', value: s.opened, note: `${pct(share(s.opened, s.delivered))} of delivered` },
      ]
    : [
    { label: 'Sent', value: s.sent, note: `of ${n(s.recipients)} recipients` },
    { label: 'Delivered', value: s.delivered, note: `${pct(share(s.delivered, s.sent))} of sent` },
    ...(tracked
      ? [
          { label: 'Opened', value: s.opened, note: `${pct(share(s.opened, s.delivered))} of delivered` },
          { label: 'Clicked a link', value: s.clicked, note: `${pct(share(s.clicked, s.delivered))} of delivered` },
        ]
      : []),
  ];
  const max = Math.max(s.sent, 1);
  void wa;
  return (
    <Panel className="flex flex-col gap-5 p-5 sm:p-6">
      <PanelHeader
        title="How far it got"
        description={wa ? 'Read counts only people who have read receipts (blue ticks) switched on.' : tracked ? 'Opens are a rough guide: some apps hide them, others open every email automatically.' : 'Opens and clicks aren’t tracked when sending from Gmail.'}
      />
      <ol className="stagger flex flex-col gap-3.5">
        {steps.map((st, i) => (
          <li key={st.label} className="grid grid-cols-[minmax(0,1fr)] grid-cols-[110px_minmax(0,1fr)] items-center gap-4 sm:grid-cols-[140px_minmax(0,1fr)_150px]">
            <span className="text-[13px] font-semibold">{st.label}</span>
            <div className="relative h-8 overflow-hidden rounded-[8px] bg-line-soft">
              <div
                className="absolute inset-y-0 left-0 rounded-[8px] transition-[width] duration-700 ease-out"
                style={{ width: `${Math.max((st.value / max) * 100, st.value ? 1.5 : 0)}%`, background: 'var(--color-chart-1)', opacity: 1 - i * 0.16 }}
              />
              <span className="tnum absolute inset-y-0 left-3 flex items-center text-[13px] font-semibold text-white mix-blend-normal [text-shadow:0_1px_1px_rgb(0_0_0/0.2)]">
                {st.value / max > 0.12 ? n(st.value) : ''}
              </span>
              {st.value / max <= 0.12 && <span className="tnum absolute inset-y-0 flex items-center text-[13px] font-semibold" style={{ left: `calc(${(st.value / max) * 100}% + 10px)` }}>{n(st.value)}</span>}
            </div>
            <span className="tnum col-span-2 -mt-2 text-xs text-muted sm:col-span-1 sm:mt-0 sm:text-right sm:text-[13px]">{st.note}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function SendingProgress({ c, pending, onCancel }: { c: Campaign; pending: number; onCancel: () => void }) {
  const done = c.stats.sent + c.stats.failed + c.stats.suppressed;
  return (
    <Panel className="flex flex-col gap-4 border-accent/40 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
          </span>
          <span className="text-[15px] font-semibold">Sending now</span>
        </div>
        <Button size="sm" variant="danger-ghost" onClick={onCancel}>
          <XCircle className="h-4 w-4" />
          Stop sending
        </Button>
      </div>
      <ProgressBar value={done} max={Math.max(c.stats.recipients, 1)} label="Sending progress" />
      <p className="tnum text-[13px] text-muted">
        <span className="font-semibold text-ink">{n(c.stats.sent)}</span> of {n(c.stats.recipients)} sent, {n(pending)} waiting. You can leave this page; sending carries on.
      </p>
    </Panel>
  );
}

export function ReportPage() {
  const { id } = useParams();
  const { tenant } = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [device, setDevice] = useState<Device>('desktop');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const q = useQuery({
    queryKey: ['campaign-report', id],
    queryFn: () => api.get<CampaignReport>(`/api/campaigns/${id}/report`),
    refetchInterval: (query) => (query.state.data?.campaign.status === 'SENDING' ? 3000 : false),
  });
  const preview = useQuery({ queryKey: ['campaign-preview', id, 'report'], queryFn: () => api.post<CampaignPreview>(`/api/campaigns/${id}/preview`), staleTime: Infinity });
  const duplicate = useMutation({
    mutationFn: () => api.post<{ campaign: Campaign }>(`/api/campaigns/${id}/duplicate`),
    onSuccess: ({ campaign }) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Copy created. Change what you need and send it again.');
      nav(`/campaigns/${campaign.id}/edit`);
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/api/campaigns/${id}/cancel`),
    onSuccess: () => {
      setConfirmCancel(false);
      qc.invalidateQueries({ queryKey: ['campaign-report', id] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Stopped. Nothing more will be sent.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useNavSection(q.data ? (q.data.campaign.channel === 'WHATSAPP' ? 'whatsapp' : 'email') : null);
  if (q.error) return <Navigate to="/email/broadcasts" replace />;
  if (!q.data)
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-16 w-96" />
        <Skeleton className="h-32 rounded-[var(--radius-panel)]" />
        <Skeleton className="h-72 rounded-[var(--radius-panel)]" />
      </div>
    );

  const { campaign: c, pending, cancelled, topLinks, problems } = q.data;
  if (c.status === 'DRAFT' || c.status === 'SCHEDULED') return <Navigate to={`/campaigns/${c.id}/edit`} replace />;
  const s = c.stats;
  const wa = c.channel === 'WHATSAPP';
  const tracked = !wa && c.sender?.kind !== 'GMAIL';
  const maxClicks = Math.max(1, ...topLinks.map((l) => l.clicks));

  const kpis = wa
    ? [
        { label: 'Delivered', value: <CountPercent value={c.rates.delivery} />, sub: `${n(s.delivered)} of ${n(s.sent)}` },
        { label: 'Read', value: <CountPercent value={c.rates.open} />, sub: `${n(s.opened)} people` },
        { label: 'Replied STOP', value: <CountUp value={s.unsubscribed} />, sub: pct(c.rates.unsubscribe) },
        { label: 'Not on WhatsApp', value: <CountUp value={s.failed - cancelled} />, sub: 'or couldn’t be sent', warn: false },
        { label: 'Skipped', value: <CountUp value={s.suppressed} />, sub: 'unsubscribed earlier' },
      ]
    : [
    { label: 'Delivered', value: <CountPercent value={c.rates.delivery} />, sub: `${n(s.delivered)} of ${n(s.sent)}` },
    ...(tracked
      ? [
          { label: 'Opened', value: <CountPercent value={c.rates.open} />, sub: `${n(s.opened)} people` },
          { label: 'Clicked', value: <CountPercent value={c.rates.click} />, sub: `${n(s.clicked)} people` },
        ]
      : []),
    { label: 'Unsubscribed', value: <CountUp value={s.unsubscribed} />, sub: pct(c.rates.unsubscribe) },
    { label: 'Bounced', value: <CountUp value={s.bounced} />, sub: pct(c.rates.bounce), warn: c.rates.bounce >= 3 },
  ];

  return (
    <>
      <header className="flex flex-col gap-4">
        <Link to={wa ? '/whatsapp/broadcasts' : '/email/broadcasts'} className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> {wa ? 'WhatsApp' : 'Email'}: broadcasts
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em]">{c.name}</h1>
              <CampaignStatusBadge status={c.status} />
            </div>
            <p className="text-sm text-muted">
              {c.subject && (
                <span className="font-medium text-ink">
                  <PrettyTags text={c.subject} />
                </span>
              )}
              <br className="sm:hidden" />
              <span className="sm:ml-2">
                {c.startedAt && `Sent ${dateTime(c.startedAt)}`}
                {c.sender && ` from ${c.sender.fromEmail}`}
              </span>
            </p>
          </div>
          <Button onClick={() => duplicate.mutate()} loading={duplicate.isPending}>
            <Copy className="h-4 w-4" />
            Duplicate
          </Button>
        </div>
      </header>

      {c.status === 'SENDING' && <SendingProgress c={c} pending={pending} onCancel={() => setConfirmCancel(true)} />}
      {c.status === 'CANCELLED' && (
        <div className="flex items-center gap-3 rounded-[14px] border border-line bg-surface px-4 py-3 text-sm text-ink-2">
          <XCircle className="h-4 w-4 shrink-0 text-muted" />
          Stopped on {dateTime(c.completedAt)}. {n(s.sent)} were sent before that; {n(cancelled)} weren’t.
        </div>
      )}
      {c.status === 'FAILED' && c.lastError && (
        <div className="flex items-center gap-3 rounded-[14px] border border-[#f4c7c2] bg-danger-soft px-4 py-3 text-sm text-danger">
          <XCircle className="h-4 w-4 shrink-0" />
          {c.lastError}
        </div>
      )}

      <Panel className={cn('stagger grid grid-cols-2', kpis.length === 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-3')}>
        {kpis.map((k, i) => (
          <div key={k.label} className={cn('flex flex-col gap-2 p-5', i % 2 === 1 && 'border-l border-line-soft', i >= 2 && 'border-t border-line-soft lg:border-t-0', i >= 1 && 'lg:border-l')}>
            <span className="text-[13px] font-medium text-muted">{k.label}</span>
            <span className={cn('tnum text-[28px] font-semibold leading-none tracking-[-0.03em]', k.warn && 'text-warm-strong')}>{k.value}</span>
            <span className="tnum text-[13px] text-muted">{k.sub}</span>
          </div>
        ))}
      </Panel>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Funnel c={c} tracked={tracked || wa} />

          {tracked && (
            <Panel className="flex flex-col">
              <PanelHeader className="px-5 pt-5 sm:px-6 sm:pt-6" title="Links people clicked" description="Each person counts once per link." />
              {topLinks.length ? (
                <ul className="stagger flex flex-col p-2 sm:p-3">
                  {topLinks.map((l) => (
                    <li key={l.url} className="flex flex-col gap-1.5 rounded-[10px] px-3 py-2.5 hover:bg-sunken">
                      <div className="flex items-center justify-between gap-4">
                        <a href={l.url} target="_blank" rel="noreferrer noopener" className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium hover:underline">
                          <span className="truncate">{l.url.replace(/^https?:\/\/(www\.)?/, '')}</span>
                          <ExternalLink className="h-3 w-3 shrink-0 text-muted" />
                        </a>
                        <span className="tnum shrink-0 text-[13px] font-semibold">{n(l.clicks)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
                        <div className="h-full rounded-full bg-[var(--color-chart-1)]" style={{ width: `${(l.clicks / maxClicks) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-6 pb-6 pt-3 text-sm text-muted">No link clicks yet.</p>
              )}
            </Panel>
          )}

          {!wa && (
          <Panel className="flex flex-col">
            <PanelHeader
              className="px-5 pt-5 sm:px-6 sm:pt-6"
              title="Didn’t arrive"
              description="Bounced addresses and spam reports are blocked from future emails automatically."
            />
            {problems.length ? (
              <div className="overflow-x-auto p-2 sm:p-3">
                <table className="w-full text-left text-[13px]">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Address</th>
                      <th className="px-3 py-2 font-semibold">What happened</th>
                      <th className="px-3 py-2 text-right font-semibold">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {problems.map((p, i) => {
                      const d = (p.detail ?? {}) as { bounceType?: string; complaintFeedbackType?: string; diagnosticCode?: string };
                      const what = d.complaintFeedbackType !== undefined || (!d.bounceType && !d.diagnosticCode) ? 'Marked as spam' : d.bounceType === 'Transient' ? 'Mailbox full or unavailable' : 'Address doesn’t exist';
                      return (
                        <tr key={i} className="border-t border-line-soft">
                          <td className="px-3 py-2.5 font-medium">{p.email}</td>
                          <td className="px-3 py-2.5 text-ink-2">{what}</td>
                          <td className="tnum whitespace-nowrap px-3 py-2.5 text-right text-muted">{dateTime(p.at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={<MailX />} title={s.bounced ? `${n(s.bounced)} bounced` : 'Everything arrived'}>
                {s.bounced ? 'Details show up here when the receiving server explains why.' : 'No bounces or spam reports for this broadcast.'}
              </EmptyState>
            )}
            {(s.suppressed > 0 || s.failed > 0) && (
              <p className="flex gap-2 border-t border-line-soft px-5 py-3.5 text-[13px] text-muted sm:px-6">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {s.suppressed > 0 && `${n(s.suppressed)} skipped because they had unsubscribed or bounced before. `}
                  {s.failed - cancelled > 0 && `${n(s.failed - cancelled)} couldn’t be sent after several tries.`}
                </span>
              </p>
            )}
          </Panel>
          )}
        </div>

        <Panel className="flex flex-col gap-4 p-4 sm:p-5 lg:sticky lg:top-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <h2 className="text-[15px] font-semibold">What was sent</h2>
              <span className="text-xs text-muted">Exactly as it went out, personalised for one recipient</span>
            </div>
            {!wa && <DeviceToggle value={device} onChange={setDevice} />}
          </div>
          {wa ? (
            <WhatsAppPreview text={preview.data?.rendered?.text ?? c.text} businessName={tenant.name} attachments={c.attachments} />
          ) : (
            <EmailPreview
              html={preview.data?.rendered?.html ?? null}
              device={device}
              fromName={c.sender?.fromName ?? ''}
              subject={preview.data?.rendered?.subject ?? c.subject ?? ''}
              previewText={c.previewText}
              attachments={c.attachments}
            />
          )}
        </Panel>
      </div>

      <Dialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Stop sending?"
        description={`${n(s.sent)} already sent stay sent. The ${n(pending)} still waiting won’t get it.`}
        footer={
          <>
            <Button onClick={() => setConfirmCancel(false)}>Keep sending</Button>
            <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              Stop sending
            </Button>
          </>
        }
      />
    </>
  );
}

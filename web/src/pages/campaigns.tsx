import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Copy, MessageCircle, MoreHorizontal, Pencil, Plus, Send, Trash2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, LinkButton } from '@/components/ui/button';
import { Tabs } from '@/components/ui/controls';
import { EmptyState, PageHeader, Panel, Skeleton } from '@/components/ui/display';
import { Dialog, Menu, MenuItem, MenuSeparator } from '@/components/ui/overlay';
import { api, qs } from '@/lib/api';
import { cn } from '@/lib/cn';
import { date, dateTime, n, pct } from '@/lib/format';
import { campaignHref, CampaignStatusBadge } from '@/lib/status';
import { PrettyTags } from '@/lib/tags';
import type { Campaign, CampaignStatus } from '@/lib/types';

type Tab = 'ALL' | 'DRAFT' | 'SCHEDULED' | 'SENT';
interface Page {
  campaigns: Campaign[];
  page: number;
  total: number;
  pages: number;
}

function when(c: Campaign) {
  if (c.status === 'SCHEDULED' && c.scheduledAt) return { label: 'Sends', value: dateTime(c.scheduledAt) };
  if (c.status === 'SENDING') return { label: 'Started', value: dateTime(c.startedAt) };
  if (c.startedAt) return { label: 'Sent', value: date(c.startedAt, { day: 'numeric', month: 'short', year: 'numeric' }) };
  return { label: 'Edited', value: date(c.updatedAt, { day: 'numeric', month: 'short' }) };
}

function Engagement({ c }: { c: Campaign }) {
  if (!c.startedAt) return <span className="text-[13px] text-faint">Not sent yet</span>;
  return (
    <div className="tnum grid max-w-[240px] grid-cols-2 gap-4 text-[13px]">
      <span className="flex flex-col">
        <span className="font-semibold">{pct(c.rates.delivery)}</span>
        <span className="text-xs text-muted">delivered</span>
      </span>
      <span className="flex flex-col">
        <span className="font-semibold">{pct(c.channel === 'WHATSAPP' ? c.rates.open : c.rates.click)}</span>
        <span className="text-xs text-muted">{c.channel === 'WHATSAPP' ? 'read' : `clicked, of ${n(c.stats.delivered)}`}</span>
      </span>
    </div>
  );
}

export function CampaignsPage({ channel, embedded }: { channel?: 'EMAIL' | 'WHATSAPP'; embedded?: boolean } = {}) {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const tab = (params.get('tab') as Tab | null) ?? 'ALL';
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const [deleting, setDeleting] = useState<Campaign | null>(null);
  const [cancelling, setCancelling] = useState<Campaign | null>(null);

  const q = useQuery({
    queryKey: ['campaigns', channel ?? 'ALL', tab, page],
    queryFn: () => api.get<Page>(`/api/campaigns${qs({ status: tab === 'ALL' ? undefined : tab, channel, page, pageSize: 20 })}`),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.campaigns.some((c) => c.status === 'SENDING') ? 4000 : false),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['campaigns'] });
    qc.invalidateQueries({ queryKey: ['overview'] });
  };
  const duplicate = useMutation({
    mutationFn: (c: Campaign) => api.post<{ campaign: Campaign }>(`/api/campaigns/${c.id}/duplicate`),
    onSuccess: ({ campaign }) => {
      refresh();
      toast.success('Copy created');
      nav(`/campaigns/${campaign.id}/edit`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (c: Campaign) => api.del(`/api/campaigns/${c.id}`),
    onSuccess: () => {
      refresh();
      setDeleting(null);
      toast.success('Broadcast deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: (c: Campaign) => api.post(`/api/campaigns/${c.id}/cancel`),
    onSuccess: () => {
      refresh();
      setCancelling(null);
      toast.success('Broadcast cancelled. Nothing more will be sent.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const newHref = channel === 'WHATSAPP' ? '/campaigns/new?channel=WHATSAPP' : '/campaigns/new';
  const setTab = (t: Tab) => setParams(t === 'ALL' ? {} : { tab: t }, { replace: true });
  const rows = q.data?.campaigns ?? [];
  const isEmptyAccount = tab === 'ALL' && q.data && q.data.total === 0;

  return (
    <>
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-2">{channel === 'WHATSAPP' ? 'One WhatsApp message to many customers, now or at a time you pick.' : 'One email to many customers, now or at a time you pick.'}</p>
          <LinkButton to={newHref} variant="primary">
            <Plus className="h-4 w-4" strokeWidth={2.4} /> New {channel === 'WHATSAPP' ? 'WhatsApp' : 'email'} broadcast
          </LinkButton>
        </div>
      ) : (
        <PageHeader title="Broadcasts" description="One message to many customers, by email or WhatsApp, now or at a time you pick." />
      )}

      {isEmptyAccount ? (
        <Panel>
          <EmptyState
            icon={<Send />}
            title={channel === 'WHATSAPP' ? 'Send your first WhatsApp broadcast' : 'Send your first broadcast'}
            action={
              <LinkButton to={newHref} variant="primary">
                {channel === 'WHATSAPP' ? 'Write the message' : 'Start from a design'}
              </LinkButton>
            }
          >
            {channel === 'WHATSAPP'
              ? 'Write one message, add a photo or PDF if you like, choose who gets it, and send it now or schedule it for later.'
              : 'Pick a ready-made design, change the words, choose who gets it, and send it now or schedule it for later.'}
          </EmptyState>
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="px-5 pt-2 sm:px-6">
            <Tabs<Tab>
              label="Filter broadcasts"
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'ALL', label: 'All' },
                { value: 'DRAFT', label: 'Drafts' },
                { value: 'SCHEDULED', label: 'Scheduled' },
                { value: 'SENT', label: 'Sent' },
              ]}
            />
          </div>
          <ul className={cn('stagger flex flex-col transition-opacity', q.isPlaceholderData && 'opacity-60')}>
            {q.isPending &&
              Array.from({ length: 5 }, (_, i) => (
                <li key={i} className="border-t border-line-soft px-6 py-4 first:border-0">
                  <Skeleton className="h-10" />
                </li>
              ))}
            {rows.map((c) => {
              const w = when(c);
              const editable = c.status === 'DRAFT' || c.status === 'SCHEDULED';
              const deletable = !c.startedAt && c.status !== 'SENDING';
              return (
                <li key={c.id} className="group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 border-t border-line-soft px-5 py-4 first:border-0 hover:bg-sunken sm:px-6 lg:grid-cols-[minmax(0,1fr)_120px_170px_240px_40px]">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Link to={campaignHref(c)} className="truncate text-sm font-semibold after:absolute after:inset-0 after:content-[''] hover:underline">
                      {c.name}
                    </Link>
                    <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
                      {c.channel === 'WHATSAPP' && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[#e7f8ee] px-1.5 text-[11px] font-semibold text-[#0f6b3a]">
                          <MessageCircle className="h-3 w-3" aria-hidden />
                          WhatsApp
                        </span>
                      )}
                      <span className="truncate">
                        {c.channel === 'WHATSAPP' ? (c.text ? <PrettyTags text={c.text.split('\n')[0]!} /> : 'No message yet') : c.subject ? <PrettyTags text={c.subject} /> : 'No subject yet'}
                      </span>
                    </span>
                  </div>
                  <div className="justify-self-end lg:justify-self-start">
                    <CampaignStatusBadge status={c.status as CampaignStatus} />
                  </div>
                  <div className="hidden flex-col lg:flex">
                    <span className="text-xs text-muted">{w.label}</span>
                    <span className="tnum text-[13px] font-medium">{w.value}</span>
                  </div>
                  <div className="hidden lg:block">
                    {c.status === 'SENDING' ? (
                      <div className="flex max-w-[220px] flex-col gap-1.5">
                        <span className="tnum text-[13px]">
                          <span className="font-semibold">{n(c.stats.sent)}</span> <span className="text-muted">of {n(c.stats.recipients)} sent</span>
                        </span>
                        <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
                          <div className="h-full animate-pulse rounded-full bg-accent" style={{ width: `${c.stats.recipients ? (c.stats.sent / c.stats.recipients) * 100 : 0}%` }} />
                        </div>
                      </div>
                    ) : (
                      <Engagement c={c} />
                    )}
                  </div>
                  <div className="relative z-10 hidden justify-self-end lg:block">
                    <Menu
                      trigger={
                        <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink" aria-label={`Options for ${c.name}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      }
                    >
                      {editable && (
                        <MenuItem icon={<Pencil />} onSelect={() => nav(`/campaigns/${c.id}/edit`)}>
                          Edit
                        </MenuItem>
                      )}
                      <MenuItem icon={<Copy />} onSelect={() => duplicate.mutate(c)}>
                        Duplicate
                      </MenuItem>
                      {(c.status === 'SCHEDULED' || c.status === 'SENDING') && (
                        <>
                          <MenuSeparator />
                          <MenuItem icon={<XCircle />} danger onSelect={() => setCancelling(c)}>
                            Cancel sending
                          </MenuItem>
                        </>
                      )}
                      {deletable && (
                        <>
                          <MenuSeparator />
                          <MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(c)}>
                            Delete
                          </MenuItem>
                        </>
                      )}
                    </Menu>
                  </div>
                </li>
              );
            })}
          </ul>
          {q.data && rows.length === 0 && (
            <EmptyState title={tab === 'DRAFT' ? 'No drafts' : tab === 'SCHEDULED' ? 'Nothing scheduled' : 'Nothing sent yet'}>
              {tab === 'SCHEDULED' ? 'Broadcasts you schedule wait here until their time comes.' : undefined}
            </EmptyState>
          )}
          {q.data && q.data.pages > 1 && (
            <div className="flex items-center justify-end gap-1 border-t border-line-soft px-5 py-3">
              <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => setParams({ ...(tab !== 'ALL' && { tab }), page: String(page - 1) })}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="tnum px-2 text-[13px] text-ink-2">
                Page {page} of {q.data.pages}
              </span>
              <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= q.data.pages} onClick={() => setParams({ ...(tab !== 'ALL' && { tab }), page: String(page + 1) })}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </Panel>
      )}

      <Dialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        description="This draft and its design are removed. This can’t be undone."
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Keep it</Button>
            <Button variant="danger" loading={del.isPending} onClick={() => deleting && del.mutate(deleting)}>
              Delete broadcast
            </Button>
          </>
        }
      />
      <Dialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={`Cancel “${cancelling?.name}”?`}
        description={
          cancelling?.status === 'SENDING'
            ? 'Emails already sent stay sent. Everyone else won’t get it.'
            : 'It won’t be sent. To send it later, duplicate it and schedule the copy.'
        }
        footer={
          <>
            <Button onClick={() => setCancelling(null)}>Keep sending</Button>
            <Button variant="danger" loading={cancel.isPending} onClick={() => cancelling && cancel.mutate(cancelling)}>
              Cancel broadcast
            </Button>
          </>
        }
      />
    </>
  );
}

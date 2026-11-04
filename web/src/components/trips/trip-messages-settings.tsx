import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Plane, Star, Sunrise } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/controls';
import { Panel, PanelHeader, Skeleton } from '@/components/ui/display';
import { Field, Input, NativeSelect } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';
import { ReminderText } from './payment-settings';

type Kind = 'PRE_TRIP' | 'REVIEW' | 'WHERE_NEXT';
interface One {
  enabled: boolean;
  days: number;
  text: string;
}
export interface TripMessages {
  channel: 'AUTO' | 'WHATSAPP' | 'EMAIL';
  preTrip: One;
  review: One & { url: string | null };
  whereNext: One;
  defaults: Record<Kind, string>;
  tags: string[];
}
type Draft = Pick<TripMessages, 'channel' | 'preTrip' | 'review' | 'whereNext'>;
const pick = (s: TripMessages): Draft => ({ channel: s.channel, preTrip: s.preTrip, review: s.review, whereNext: s.whereNext });

const SAMPLE = { destination: 'Kerala', trip: 'Kerala backwaters', start_date: '12 Dec 2026', return_date: '16 Dec 2026' };

function MessageCard({
  icon,
  title,
  description,
  enabled,
  onToggle,
  canEdit,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  canEdit: boolean;
  children: ReactNode;
}) {
  return (
    <Panel className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-[12px]', enabled ? 'bg-accent-soft text-accent-strong' : 'bg-line-soft text-muted')}>{icon}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
          <p className="text-[13px] leading-relaxed text-muted">{description}</p>
        </div>
        <Switch label={title} checked={enabled} disabled={!canEdit} onCheckedChange={onToggle} />
      </div>
      {enabled && <div className="flex flex-col gap-5 border-t border-line-soft pt-5">{children}</div>}
    </Panel>
  );
}

export function TripMessagesSettings() {
  const qc = useQueryClient();
  const { tenant, user } = useSession();
  const canEdit = user.role !== 'MEMBER';
  const q = useQuery({ queryKey: ['trip-messages'], queryFn: () => api.get<{ settings: TripMessages }>('/api/trips/messages').then((r) => r.settings) });
  const [d, setD] = useState<Draft | null>(null);
  useEffect(() => {
    if (q.data && !d) setD(pick(q.data));
  }, [q.data, d]);
  const save = useMutation({
    mutationFn: () => api.patch<{ settings: TripMessages }>('/api/trips/messages', { ...d, review: { ...d!.review, url: d!.review.url?.trim() || null } }),
    onSuccess: ({ settings }) => {
      qc.setQueryData(['trip-messages'], settings);
      setD(pick(settings));
      toast.success('Trip messages saved');
    },
  });
  if (!q.data || !d) return <Skeleton className="h-96 rounded-[var(--radius-panel)]" />;
  const s = q.data;
  const err = (k: string) => (save.error instanceof ApiError ? save.error.field(k) : undefined);
  const dirty = JSON.stringify(d) !== JSON.stringify(pick(s));
  const set = <K extends 'preTrip' | 'review' | 'whereNext'>(k: K, patch: Partial<Draft[K]>) => setD({ ...d, [k]: { ...d[k], ...patch } });

  return (
    <div className="flex flex-col gap-5">
      <PanelHeader
        title="Trip messages"
        description="Sent by themselves around each booked trip, at 10 am. The trip-starting message goes to every traveller; the review request and “where next?” only go to people who agreed to hear offers from you."
        action={
          <div className="w-full sm:w-72">
            <Field label="Send by">
              {(p) => (
                <NativeSelect {...p} disabled={!canEdit} value={d.channel} onChange={(e) => setD({ ...d, channel: e.target.value as Draft['channel'] })}>
                  <option value="AUTO">WhatsApp if linked, else email</option>
                  <option value="WHATSAPP">WhatsApp only</option>
                  <option value="EMAIL">Email only</option>
                </NativeSelect>
              )}
            </Field>
          </div>
        }
      />

      <MessageCard
        icon={<Plane className="h-5 w-5" />}
        title="Before the trip"
        description="A warm “your trip starts soon” a few days before departure. Customers notice."
        enabled={d.preTrip.enabled}
        onToggle={(v) => set('preTrip', { enabled: v })}
        canEdit={canEdit}
      >
        <Field label="Days before departure" error={err('preTrip.days')} className="sm:w-56">
          {(p) => <Input {...p} type="number" min={1} max={14} disabled={!canEdit} value={d.preTrip.days} onChange={(e) => set('preTrip', { days: Number(e.target.value) })} />}
        </Field>
        <ReminderText label="Message" value={d.preTrip.text} onChange={(v) => set('preTrip', { text: v })} fallback={s.defaults.PRE_TRIP} tags={s.tags} error={err('preTrip.text')} company={tenant.name} vars={SAMPLE} />
      </MessageCard>

      <MessageCard
        icon={<Star className="h-5 w-5" />}
        title="Ask for a Google review"
        description="The day after they’re back, while the trip is fresh. Reviews are how small agencies win new customers."
        enabled={d.review.enabled}
        onToggle={(v) => set('review', { enabled: v })}
        canEdit={canEdit}
      >
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
          <Field label="Your Google review link" hint="Google Business Profile → Ask for reviews → copy the link." error={err('review.url')}>
            {(p) => <Input {...p} disabled={!canEdit} leading={<Link2 className="h-4 w-4" />} value={d.review.url ?? ''} onChange={(e) => set('review', { url: e.target.value })} placeholder="https://g.page/r/…/review" />}
          </Field>
          <Field label="Days after return" error={err('review.days')}>
            {(p) => <Input {...p} type="number" min={0} max={14} disabled={!canEdit} value={d.review.days} onChange={(e) => set('review', { days: Number(e.target.value) })} />}
          </Field>
        </div>
        <ReminderText label="Message" value={d.review.text} onChange={(v) => set('review', { text: v })} fallback={s.defaults.REVIEW} tags={s.tags} error={err('review.text')} company={tenant.name} vars={{ ...SAMPLE, review_link: d.review.url || 'https://g.page/r/…' }} />
      </MessageCard>

      <MessageCard
        icon={<Sunrise className="h-5 w-5" />}
        title="“Where next?”"
        description="A few months after they’re back, an invitation to plan the next trip. Repeat customers cost nothing to find."
        enabled={d.whereNext.enabled}
        onToggle={(v) => set('whereNext', { enabled: v })}
        canEdit={canEdit}
      >
        <Field label="Days after return" hint="90 is about three months." error={err('whereNext.days')} className="sm:w-56">
          {(p) => <Input {...p} type="number" min={14} max={730} disabled={!canEdit} value={d.whereNext.days} onChange={(e) => set('whereNext', { days: Number(e.target.value) })} />}
        </Field>
        <ReminderText label="Message" value={d.whereNext.text} onChange={(v) => set('whereNext', { text: v })} fallback={s.defaults.WHERE_NEXT} tags={s.tags} error={err('whereNext.text')} company={tenant.name} vars={SAMPLE} />
      </MessageCard>

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

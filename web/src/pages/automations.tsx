import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CakeSlice, CalendarClock, ChevronRight, Plane, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LinkButton } from '@/components/ui/button';
import { Switch } from '@/components/ui/controls';
import { Badge, PageHeader, Panel, Skeleton } from '@/components/ui/display';
import { Tooltip } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { date, n, pct } from '@/lib/format';
import type { Automation } from '@/lib/types';

export interface Upcoming {
  days: { day: string; count: number; people: { name: string; email: string; occurrenceDate: string }[] }[];
  total: number;
  audience: { matching: number; withDate: number };
}

/** Next 7 days as seven small columns: how many emails go out each day. */
function WeekStrip({ id, tz }: { id: string; tz: string }) {
  const q = useQuery({ queryKey: ['automation-upcoming', id, 7], queryFn: () => api.get<Upcoming>(`/api/automations/${id}/upcoming?days=7`) });
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() + i * 86_400_000);
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    return { key, d, entry: q.data?.days.find((x) => x.day === key) };
  });
  const max = Math.max(1, ...days.map((x) => x.entry?.count ?? 0));
  if (!q.data) return <Skeleton className="h-[74px]" />;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-medium text-ink-2">Next 7 days</span>
        <span className="tnum text-muted">
          {q.data.total ? `${n(q.data.total)} email${q.data.total === 1 ? '' : 's'}` : 'Nothing due'}
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map(({ key, d, entry }, i) => {
          const c = entry?.count ?? 0;
          const names = entry?.people.map((p) => p.name).join(', ');
          return (
            <Tooltip key={key} content={c ? `${date(d, { weekday: 'short', day: 'numeric', month: 'short' })}: ${names}${c > (entry?.people.length ?? 0) ? ` and ${c - entry!.people.length} more` : ''}` : `${date(d, { weekday: 'short', day: 'numeric', month: 'short' })}: none`}>
              <div tabIndex={0} className="flex flex-col items-center gap-1 rounded-md outline-offset-2">
                <div className="flex h-9 w-full items-end overflow-hidden rounded-[6px] bg-line-soft">
                  <div className="w-full rounded-[6px] bg-[var(--color-chart-1)] transition-[height]" style={{ height: c ? `${Math.max(18, (c / max) * 100)}%` : 0 }} />
                </div>
                <span className={cn('text-[11px]', i === 0 ? 'font-semibold text-ink' : 'text-muted')}>{i === 0 ? 'Today' : date(d, { weekday: 'narrow' })}</span>
              </div>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  birthday: <CakeSlice className="h-5 w-5" />,
  trip_date: <Plane className="h-5 w-5" />,
};

function AutomationCard({ a }: { a: Automation }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: (on: boolean) => api.post<{ automation: Automation }>(`/api/automations/${a.id}/${on ? 'activate' : 'pause'}`),
    onSuccess: ({ automation }) => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      toast.success(automation.status === 'ACTIVE' ? `“${a.name}” is on` : `“${a.name}” is paused`, {
        description: automation.status === 'ACTIVE' ? 'Dates that already passed are skipped. It starts from now.' : 'Nothing goes out until you switch it back on.',
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const on = a.status === 'ACTIVE';
  return (
    <Panel className={cn('relative flex flex-col gap-5 p-5 transition-shadow hover:shadow-[var(--shadow-lift)]', !on && 'bg-sunken')}>
      <div className="flex items-start gap-4">
        <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-[12px]', on ? 'bg-accent-soft text-accent' : 'bg-line-soft text-muted')}>
          {ICONS[a.dateField.key] ?? <CalendarClock className="h-5 w-5" />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Link to={`/automations/${a.id}`} className="truncate text-[15px] font-semibold after:absolute after:inset-0 after:content-[''] hover:underline">
            {a.name}
          </Link>
          <span className="text-[13px] text-muted">{a.rule.replace(/ · /g, ', ')}</span>
        </div>
        <div className="relative z-10 flex items-center gap-2.5">
          <span className={cn('text-xs font-semibold', on ? 'text-accent-strong' : 'text-muted')}>{on ? 'On' : a.status === 'DRAFT' ? 'Draft' : 'Paused'}</span>
          <Switch label={on ? `Pause ${a.name}` : `Switch on ${a.name}`} checked={on} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate(v)} />
        </div>
      </div>
      {on ? <WeekStrip id={a.id} tz={a.timezone} /> : <p className="text-[13px] text-muted">{a.status === 'DRAFT' ? 'Finish setting it up, then switch it on.' : 'Paused. Nobody gets it until you switch it back on.'}</p>}
      <div className="tnum flex items-center gap-5 border-t border-line-soft pt-4 text-[13px]">
        <span>
          <span className="font-semibold">{n(a.stats.sent)}</span> <span className="text-muted">sent so far</span>
        </span>
        <span>
          <span className="font-semibold">{pct(a.stats.clickRate)}</span> <span className="text-muted">clicked</span>
        </span>
        {a.template && <span className="ml-auto hidden truncate text-muted sm:inline">{a.template.name}</span>}
      </div>
    </Panel>
  );
}

function Recipe({ icon, title, body, to }: { icon: React.ReactNode; title: string; body: string; to: string }) {
  return (
    <Link to={to} className="group flex items-start gap-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5 transition-[border,box-shadow] hover:border-accent hover:shadow-[var(--shadow-lift)]">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-accent-soft text-accent">{icon}</span>
      <span className="flex flex-1 flex-col gap-1">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-[13px] leading-relaxed text-muted">{body}</span>
      </span>
      <ChevronRight className="mt-3 h-4 w-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
    </Link>
  );
}

export function AutomationsPage() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['automations'], queryFn: () => api.get<{ automations: Automation[] }>('/api/automations') });
  const list = q.data?.automations ?? [];
  const has = (key: string) => list.some((a) => a.dateField.key === key);

  return (
    <>
      <PageHeader
        title="Automations"
        description="Emails that go out by themselves on each person’s own date, like a reminder before their trip or wishes on their birthday."
        actions={
          <LinkButton to="/automations/new" variant="primary">
            <Plus className="h-4 w-4" strokeWidth={2.4} />
            New automation
          </LinkButton>
        }
      />
      {q.isPending ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-56 rounded-[var(--radius-panel)]" />
          <Skeleton className="h-56 rounded-[var(--radius-panel)]" />
        </div>
      ) : (
        <>
          {list.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {list.map((a) => (
                <AutomationCard key={a.id} a={a} />
              ))}
            </div>
          )}
          {(!has('trip_date') || !has('birthday') || list.length === 0) && (
            <section className="flex flex-col gap-3">
              <h2 className="text-[15px] font-semibold">{list.length ? 'Ideas' : 'Start with one of these'}</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {!has('trip_date') && <Recipe icon={<Plane className="h-5 w-5" />} title="Trip reminder" body="3 days before each traveller’s trip date, at 9 AM: what to carry, pickup time, who to call." to="/automations/new?recipe=trip" />}
                {!has('birthday') && <Recipe icon={<CakeSlice className="h-5 w-5" />} title="Birthday wishes" body="On each customer’s birthday, every year, at 8:30 AM. A warm note, maybe a small offer." to="/automations/new?recipe=birthday" />}
                {list.length === 0 && (
                  <button type="button" onClick={() => nav('/automations/new')} className="flex items-center gap-4 rounded-[var(--radius-panel)] border border-dashed border-[#cfd5d1] p-5 text-left hover:border-accent hover:bg-accent-soft/30">
                    <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-line-soft text-muted">
                      <Plus className="h-5 w-5" />
                    </span>
                    <span className="flex flex-col gap-1">
                      <span className="text-[15px] font-semibold">Something else</span>
                      <span className="text-[13px] text-muted">Any date you keep for your contacts: anniversaries, passport expiry, last trip.</span>
                    </span>
                  </button>
                )}
              </div>
            </section>
          )}
          {list.some((a) => a.status === 'ACTIVE') && (
            <p className="flex items-center gap-2 text-[13px] text-muted">
              <Badge tone="green" dot>
                On
              </Badge>
              automations check every minute, in India time, even when nobody is signed in.
            </p>
          )}
        </>
      )}
    </>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, CheckCircle2, Info, XCircle } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { play } from '@/lib/motion';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ago } from '@/lib/format';
import type { Notification } from '@/lib/types';
import { Popover } from './ui/overlay';

const ICON = {
  SUCCESS: <CheckCircle2 className="h-4 w-4 text-success" />,
  INFO: <Info className="h-4 w-4 text-blue-ink" />,
  WARNING: <AlertTriangle className="h-4 w-4 text-warm" />,
  ERROR: <XCircle className="h-4 w-4 text-danger" />,
};

export function NotificationsButton() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ notifications: Notification[]; unread: number }>('/api/notifications'),
    refetchInterval: 60_000,
  });
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api.post<{ unread: number }>('/api/notifications/read', ids ? { ids } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = q.data?.unread ?? 0;
  // A new alert rings the bell once
  const bell = useRef<SVGSVGElement>(null);
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (!q.data) return;
    if (seen.current !== null && unread > seen.current) {
      play(bell.current, [{ transform: 'rotate(0)' }, { transform: 'rotate(16deg)' }, { transform: 'rotate(-13deg)' }, { transform: 'rotate(9deg)' }, { transform: 'rotate(-5deg)' }, { transform: 'rotate(0)' }], { duration: 700, easing: 'ease-in-out' });
    }
    seen.current = unread;
  }, [q.data, unread]);

  return (
    <Popover
      className="w-[min(380px,calc(100vw-24px))]"
      trigger={
        <button type="button" className="relative grid h-11 w-11 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-ink-2 transition-transform duration-200 hover:bg-sunken active:scale-95" aria-label={unread ? `Alerts, ${unread} unread` : 'Alerts'}>
          <Bell ref={bell} className="h-[18px] w-[18px] origin-top" />
          {unread > 0 && (
            <span key={unread} className="tnum absolute -right-1 -top-1 grid h-5 min-w-5 animate-check place-items-center rounded-full bg-warm px-1 text-[11px] font-bold text-white ring-2 ring-ground">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      }
    >
      <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
        <span className="text-sm font-semibold">Alerts</span>
        {unread > 0 && (
          <button type="button" className="text-[13px] font-semibold text-accent hover:text-accent-strong" onClick={() => markRead.mutate(undefined)}>
            Mark all as read
          </button>
        )}
      </div>
      <div className="max-h-[420px] overflow-y-auto p-1.5">
        {q.data?.notifications.length ? (
          q.data.notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                if (!n.readAt) markRead.mutate([n.id]);
                if (n.link) nav(n.link);
              }}
              className={cn('flex w-full gap-3 rounded-[10px] px-3 py-3 text-left hover:bg-hover', !n.readAt && 'bg-sunken')}
            >
              <span className="mt-0.5 shrink-0">{ICON[n.level]}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-start justify-between gap-3">
                  <span className={cn('text-[13px] leading-snug', n.readAt ? 'font-medium text-ink-2' : 'font-semibold')}>{n.title}</span>
                  {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                </span>
                {n.body && <span className="line-clamp-2 text-xs leading-relaxed text-muted">{n.body}</span>}
                <span className="text-[11px] text-faint">{ago(n.createdAt)}</span>
              </span>
            </button>
          ))
        ) : (
          <p className="px-4 py-10 text-center text-sm text-muted">Nothing new. Finished broadcasts and anything that needs your attention will show up here.</p>
        )}
      </div>
    </Popover>
  );
}

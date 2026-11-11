import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Hand, Loader2, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { n } from '@/lib/format';
import { useSession } from '@/lib/session';

type Autopilot = { linked: boolean; connected: boolean; on: boolean; aiReady: boolean; allowed: boolean; chats: number; today: { sent: number; waiting: number } };

/**
 * The Autopilot switch at the top of WhatsApp. On: Drona AI answers this employee's customers by
 * itself within seconds, and hands anything tricky back as a draft. Off: replies are only suggested.
 */
export function AutopilotBar() {
  const { user } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ai', 'autopilot'], queryFn: () => api.get<Autopilot>('/api/ai/autopilot'), refetchInterval: 30_000 });
  const flip = useMutation({
    mutationFn: (on: boolean) => api.put<Autopilot>('/api/ai/autopilot', { on }),
    onSuccess: (r) => {
      qc.setQueryData(['ai', 'autopilot'], r);
      toast.success(r.on ? 'Autopilot is on. Drona AI will answer your customers in seconds ✨' : 'Autopilot is off. You answer, Drona AI suggests.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Couldn’t change Autopilot'),
  });
  const a = q.data;
  // Owners don't chat with customers themselves; Autopilot lives on each employee's own number
  if (!a || !a.aiReady || (!a.linked && user.role === 'OWNER')) return null;
  const on = (a.on || a.chats > 0) && a.connected;
  const blocked = !a.linked || !a.allowed;

  return (
    <section
      className={cn(
        'relative mb-4 overflow-hidden rounded-[20px] p-4 transition-[background,box-shadow] duration-500 sm:p-5',
        on ? 'bg-[linear-gradient(120deg,#0e9466_0%,#4a3fd1_60%,#a2348f_100%)] text-white shadow-[0_18px_40px_-22px_#4a3fd1]' : 'border border-line bg-surface',
      )}
    >
      {on && <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-highlight/35 blur-3xl [animation:glow-drift_8s_ease-in-out_infinite]" />}
      <div className="relative flex flex-wrap items-center gap-4">
        <span className={cn('relative grid h-12 w-12 shrink-0 place-items-center rounded-[16px]', on ? 'bg-white text-accent' : 'bg-accent-soft text-accent')}>
          <Bot className={cn('h-6 w-6', on && '[animation:nav-wiggle_2.4s_ease-in-out_infinite]')} />
          {on && <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-[#3ee6a5] ring-2 ring-white animate-pulse" />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="flex items-center gap-2 text-[16px] font-extrabold tracking-[-0.01em]">
            Drona AI Autopilot
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide', on ? 'bg-white/20' : 'bg-line-soft text-muted')}>{a.on ? 'All chats' : a.chats ? `${a.chats} chat${a.chats > 1 ? 's' : ''}` : 'Off'}</span>
          </h2>
          <p className={cn('text-[13px] leading-relaxed', on ? 'text-white/85' : 'text-muted')}>
            {!a.linked ? (
              <>
                <Link to="/whatsapp/setup" className="font-semibold text-accent underline underline-offset-4">Link your WhatsApp</Link> and Drona AI can answer your customers by itself, day and night.
              </>
            ) : !a.allowed ? (
              <>
                Autopilot comes with Drona AI. <Link to="/agency/billing" className="font-semibold text-accent underline underline-offset-4">See plans</Link>
              </>
            ) : on ? (
              a.on
                ? 'Answering every customer by itself in seconds. Anything it can’t handle comes to you with a notification.'
                : 'Answering the ticked chats by itself. Tick more in the inbox, or switch on for all chats.'
            ) : a.on && !a.connected ? (
              'Waiting for your WhatsApp to reconnect.'
            ) : (
              'Tick chats in the inbox, or switch on for all chats, and Drona AI answers by itself within seconds, even at night. Anything it can’t handle comes to you.'
            )}
          </p>
        </div>
        {a.linked && (a.on || a.today.sent > 0 || a.today.waiting > 0) && (
          <div className="flex gap-2">
            <Stat on={on} icon={<Zap />} value={n(a.today.sent)} label="answered today" />
            <Stat on={on} icon={<Hand />} value={n(a.today.waiting)} label="need you" hot={a.today.waiting > 0} />
          </div>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={a.on}
          aria-label="Drona AI Autopilot for all chats"
          disabled={blocked || flip.isPending}
          onClick={() => flip.mutate(!a.on)}
          className={cn(
            'group relative h-11 w-[92px] shrink-0 rounded-full p-1 transition-colors duration-300 disabled:opacity-50',
            a.on ? 'bg-white/25 ring-1 ring-white/50' : 'bg-line-soft ring-1 ring-line',
          )}
        >
          <span
            className={cn(
              'grid h-9 w-9 place-items-center rounded-full shadow-[0_4px_12px_-4px_rgb(0_0_0/0.4)] transition-transform duration-300 ease-[cubic-bezier(0.22,1.4,0.36,1)] group-active:scale-90',
              a.on ? 'translate-x-[48px] bg-white text-accent' : 'translate-x-0 bg-surface text-muted',
            )}
          >
            {flip.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : a.on ? <Sparkles className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
          </span>
        </button>
      </div>
      {on && (
        <p className="relative mt-3 flex items-center gap-1.5 text-[11.5px] text-white/70">
          <ShieldCheck className="h-3.5 w-3.5" /> Goes quiet in a chat for 30 minutes after you write in it, so it never talks over you.
        </p>
      )}
    </section>
  );
}

function Stat({ on, icon, value, label, hot }: { on: boolean; icon: React.ReactNode; value: string; label: string; hot?: boolean }) {
  return (
    <div className={cn('flex min-w-[96px] flex-col rounded-[14px] px-3 py-2', on ? 'bg-white/12' : 'bg-sunken', hot && (on ? 'ring-1 ring-highlight' : 'ring-1 ring-warm/50'))}>
      <span className="flex items-center gap-1.5 text-[18px] font-extrabold leading-tight [&>svg]:h-3.5 [&>svg]:w-3.5">
        {icon}
        {value}
      </span>
      <span className={cn('text-[11px] font-medium', on ? 'text-white/75' : 'text-muted')}>{label}</span>
    </div>
  );
}

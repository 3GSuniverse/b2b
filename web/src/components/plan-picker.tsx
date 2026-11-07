import { Check, Crown, Minus, Plus, Sparkles, Users, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { Segmented } from '@/components/ui/controls';
import { PLAN_FEATURES, PLANS, periodPrice, SEATS, type Plan, type PlanId } from '@/lib/brand';
import { cn } from '@/lib/cn';

export type Period = 'month' | 'year';
const inr = (v: number) => `₹${v.toLocaleString('en-IN')}`;

const LOOK: Record<PlanId, { card: string; head: string; icon: ReactNode; tick: string; sub: string; dash: string }> = {
  basic: {
    card: 'bg-surface border border-line',
    head: 'bg-[linear-gradient(135deg,#dff4ff,#e9e7ff)]',
    icon: <Zap className="h-4 w-4" />,
    tick: 'text-success',
    sub: 'text-muted',
    dash: 'text-faint',
  },
  professional: {
    card: 'bg-surface shadow-[0_0_0_2px_var(--color-accent),var(--shadow-lift)]',
    head: 'bg-[linear-gradient(135deg,#4a3fd1,#7b5cff_60%,#b06bff)] text-white',
    icon: <Sparkles className="h-4 w-4" />,
    tick: 'text-accent',
    sub: 'text-white/80',
    dash: 'text-faint',
  },
  ultra: {
    card: 'bg-nav text-nav-ink shadow-[var(--shadow-lift)]',
    head: 'bg-[linear-gradient(135deg,#2a2468,#1d1a4d_55%,#3a1f4d)] text-white',
    icon: <Crown className="h-4 w-4 text-highlight" />,
    tick: 'text-highlight',
    sub: 'text-nav-muted',
    dash: 'text-white/25',
  },
};

/** "How many employees need a login?": a dropdown with − and + beside it. */
export function SeatPicker({ value, onChange, min = SEATS.min }: { value: number; onChange: (n: number) => void; min?: number }) {
  const options = Array.from({ length: SEATS.max - SEATS.min + 1 }, (_, i) => i + SEATS.min);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="flex items-center gap-2 text-[15px] font-semibold">
        <Users className="h-[18px] w-[18px] text-accent" /> Employee logins
      </span>
      <div className="flex items-center rounded-[14px] border border-line bg-surface p-1 shadow-[var(--panel-shadow)]">
        <button
          type="button"
          aria-label="One login fewer"
          disabled={value <= Math.max(SEATS.min, min)}
          onClick={() => onChange(value - 1)}
          className="grid h-9 w-9 place-items-center rounded-[10px] text-ink-2 transition-colors hover:bg-hover disabled:opacity-35"
        >
          <Minus className="h-4 w-4" />
        </button>
        <select
          aria-label="Employee logins"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="tnum h-9 cursor-pointer appearance-none rounded-[10px] bg-accent-soft px-4 text-center text-[16px] font-bold text-accent outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {options.map((n) => (
            <option key={n} value={n} disabled={n < min}>
              {n} {n === 1 ? 'login' : 'logins'}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="One login more"
          disabled={value >= SEATS.max}
          onClick={() => onChange(value + 1)}
          className="grid h-9 w-9 place-items-center rounded-[10px] text-ink-2 transition-colors hover:bg-hover disabled:opacity-35"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <span className="text-[13px] text-muted">You, the owner, are always free.</span>
    </div>
  );
}

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <Segmented
      label="Pay monthly or yearly"
      value={value}
      onChange={onChange}
      options={[
        { value: 'month', label: 'Monthly' },
        { value: 'year', label: 'Yearly · 2 months free' },
      ]}
    />
  );
}

/** The three plans side by side, priced for the chosen number of logins. */
export function PlanCards({
  seats,
  period,
  gstPercent = 0,
  current,
  action,
  cardRef,
}: {
  seats: number;
  period: Period;
  gstPercent?: number;
  current?: PlanId | null;
  action: (plan: Plan, price: number) => ReactNode;
  cardRef?: (id: PlanId, el: HTMLElement | null) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-3">
      {PLANS.map((p) => {
        const look = LOOK[p.id];
        const price = periodPrice(p, seats, period);
        const dark = p.id === 'ultra';
        return (
          <article key={p.id} ref={(el) => cardRef?.(p.id, el)} className={cn('lift relative flex flex-col overflow-hidden rounded-[20px]', look.card)}>
            <div className={cn('relative flex flex-col gap-3 px-5 pb-5 pt-5', look.head)}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-[17px] font-bold tracking-[-0.01em]">
                  <span className={cn('grid h-7 w-7 place-items-center rounded-full', p.id === 'basic' ? 'bg-white text-accent' : 'bg-white/15')}>{look.icon}</span>
                  {p.name}
                </h3>
                {current === p.id ? (
                  <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-semibold', p.id === 'basic' ? 'bg-accent text-on-primary' : 'bg-white text-accent')}>Your plan</span>
                ) : (
                  p.popular && <span className="rounded-full bg-highlight px-2.5 py-0.5 text-[11px] font-semibold text-white">Most agencies pick this</span>
                )}
              </div>
              <p className="flex items-baseline gap-1.5">
                <span key={`${p.id}-${period}-${seats}`} className="dispatch-pop tnum text-[34px] font-extrabold leading-none tracking-[-0.03em]">
                  {inr(price)}
                </span>
                <span className={cn('whitespace-nowrap text-sm', look.sub)}>{period === 'month' ? 'a month' : 'a year'}</span>
              </p>
              <p className={cn('text-[12.5px] leading-snug', look.sub)}>
                {inr(p.first)} with 1 login, {inr(p.extra)} for each more{gstPercent ? `, plus ${gstPercent}% GST` : ''}.
              </p>
            </div>
            <div className="flex flex-1 flex-col gap-4 px-5 pb-5 pt-4">
              <p className={cn('text-[13px]', dark ? 'text-nav-muted' : 'text-ink-2')}>{p.forWho}</p>
              <ul className="flex flex-col gap-2 text-[13.5px]">
                {PLAN_FEATURES.map((f) => {
                  const v = f.values[p.id];
                  const shown = typeof v === 'function' ? v(seats) : v;
                  return (
                    <li key={f.label} className={cn('flex items-start gap-2', shown === false && (dark ? 'text-white/35' : 'text-faint'))}>
                      {shown === false ? (
                        <Minus className={cn('mt-0.5 h-4 w-4 shrink-0', look.dash)} aria-label="Not included" />
                      ) : (
                        <Check className={cn('mt-0.5 h-4 w-4 shrink-0', look.tick)} aria-label="Included" />
                      )}
                      <span className="min-w-0">
                        {f.label}
                        {typeof shown === 'string' && <b className={cn('tnum ml-1 font-semibold', dark ? 'text-white' : 'text-ink')}>{shown}</b>}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-auto flex flex-col gap-2 pt-1">{action(p, price)}</div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

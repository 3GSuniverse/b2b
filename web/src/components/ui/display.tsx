import { Check, Copy } from 'lucide-react';
import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { avatarTone, initials } from '@/lib/format';

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-[var(--radius-panel)] border border-line bg-surface', className)} {...props} />;
}

export function PanelHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-[13px] leading-relaxed text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        {back}
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em]">{title}</h1>
        {description && <p className="max-w-2xl text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

const TONES = {
  green: 'bg-accent-soft text-accent-strong',
  orange: 'bg-warm-soft text-warm-strong',
  grey: 'bg-line-soft text-ink-2',
  red: 'bg-danger-soft text-danger',
  blue: 'bg-blue-soft text-blue-ink',
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = 'grey', dot, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} aria-hidden />;
}

export function Avatar({ name, email, size = 34, className }: { name?: string | null; email?: string | null; size?: number; className?: string }) {
  const label = initials(name, email);
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold', avatarTone(email || name || label), className)}
    >
      {label}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="font-sans rounded-md border border-line bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-muted">{children}</kbd>;
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      {icon && <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent [&>svg]:h-6 [&>svg]:w-6">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <p className="max-w-sm text-sm leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ProgressBar({ value, max = 100, tone = 'accent', label }: { value: number; max?: number; tone?: 'accent' | 'warm' | 'danger'; label: string }) {
  const p = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  const color = tone === 'warm' ? 'bg-warm' : tone === 'danger' ? 'bg-danger' : 'bg-accent';
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-2 overflow-hidden rounded-full bg-line-soft">
      <div className={cn('h-full rounded-full transition-[width] duration-700 ease-out', color)} style={{ width: `${Math.max(p, value > 0 ? 2 : 0)}%` }} />
    </div>
  );
}

/** Circular gauge — how much of an allowed limit is used. */
export function RingGauge({ value, limit, label, display, sub }: { value: number; limit: number; label: string; display: string; sub: string }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, limit ? value / limit : 0);
  const tone = frac >= 0.8 ? 'var(--color-danger)' : frac >= 0.5 ? 'var(--color-warm)' : 'var(--color-accent)';
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-[108px] w-[108px]">
        <svg viewBox="0 0 108 108" className="h-full w-full -rotate-90" role="img" aria-label={`${label}: ${display} of ${sub}`}>
          <circle cx="54" cy="54" r={r} fill="none" stroke="var(--color-line-soft)" strokeWidth="10" />
          {frac > 0 && <circle
            cx="54"
            cy="54"
            r={r}
            fill="none"
            stroke={tone}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(frac * c, 0.001)} ${c}`}
            className="transition-[stroke-dasharray] duration-1000 ease-out"
          />}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum text-lg font-semibold tracking-tight">{display}</span>
          <span className="text-[11px] text-muted">{sub}</span>
        </div>
      </div>
      <span className="text-[13px] font-semibold">{label}</span>
    </div>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors',
        done ? 'border-accent-soft bg-accent-soft text-accent-strong' : 'border-line bg-surface text-ink-2 hover:bg-sunken',
      )}
      aria-label={done ? 'Copied' : `${label}: ${value}`}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? 'Copied' : label}
    </button>
  );
}

export function Stat({ label, value, note, noteTone }: { label: ReactNode; value: ReactNode; note?: ReactNode; noteTone?: 'up' | 'down' | 'neutral' }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      <span className="tnum text-[32px] font-semibold leading-none tracking-[-0.03em]">{value}</span>
      {note && <span className={cn('text-[13px]', noteTone === 'up' ? 'text-accent-strong' : noteTone === 'down' ? 'text-warm-strong' : 'text-muted')}>{note}</span>}
    </div>
  );
}

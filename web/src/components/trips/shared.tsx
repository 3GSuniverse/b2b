import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { Badge, type Tone } from '@/components/ui/display';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { inr, inrShort, shortDate } from '@/lib/format';
import type { DueState, PaymentMethod, TeamMember, TripSource, TripStatus, TripSummary } from '@/lib/types';

export const STATUS: Record<TripStatus, { label: string; tone: Tone; hint: string }> = {
  ENQUIRY: { label: 'Enquiry', tone: 'blue', hint: 'Asked, not quoted yet' },
  QUOTED: { label: 'Quoted', tone: 'orange', hint: 'Price sent, waiting for a yes' },
  BOOKED: { label: 'Booked', tone: 'green', hint: 'Confirmed' },
  COMPLETED: { label: 'Completed', tone: 'grey', hint: 'Back home' },
  LOST: { label: 'Lost', tone: 'grey', hint: 'Didn’t book' },
  CANCELLED: { label: 'Cancelled', tone: 'red', hint: 'Booked, then cancelled' },
};

export function TripStatusBadge({ status }: { status: TripStatus }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

export const SOURCES: Record<TripSource, string> = {
  PHONE: 'Phone call',
  WHATSAPP: 'WhatsApp',
  WALK_IN: 'Walk-in',
  WEBSITE: 'Website',
  REFERRAL: 'Referral',
  CALL_AGENT: 'AI call agent',
  EMAIL: 'Email',
  OTHER: 'Other',
};

export const METHODS: Record<PaymentMethod, string> = {
  UPI: 'UPI',
  CASH: 'Cash',
  BANK: 'Bank transfer',
  CARD: 'Card',
  ONLINE: 'Online',
  OTHER: 'Other',
};

export const DUE_STATE: Record<DueState, { label: string; tone: Tone }> = {
  PAID: { label: 'Paid', tone: 'green' },
  PART_PAID: { label: 'Part paid', tone: 'blue' },
  OVERDUE: { label: 'Overdue', tone: 'red' },
  DUE_TODAY: { label: 'Due today', tone: 'orange' },
  UPCOMING: { label: 'Upcoming', tone: 'grey' },
};

/** One line on what the customer owes next. Shown on cards and rows. */
export function PaymentChip({ trip, className, compact }: { trip: Pick<TripSummary, 'money' | 'price' | 'status'>; className?: string; compact?: boolean }) {
  const { money } = trip;
  const fmt = compact ? inrShort : inr;
  className = cn('whitespace-nowrap', className);
  if (trip.status === 'LOST') return null;
  if (money.overdue > 0) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-[12px] font-semibold text-danger', className)}>
        <AlertCircle className="h-3.5 w-3.5" aria-hidden />
        {fmt(money.overdue)} overdue
      </span>
    );
  }
  if (money.nextDue) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-[12px] font-medium', money.nextDue.state === 'DUE_TODAY' ? 'text-warm-strong' : 'text-muted', className)}>
        <Clock className="h-3.5 w-3.5" aria-hidden />
        {fmt(money.nextDue.amount)} {money.nextDue.state === 'DUE_TODAY' ? 'due today' : `due ${shortDate(money.nextDue.dueDate)}`}
      </span>
    );
  }
  if (trip.price > 0 && money.balance <= 0) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-[12px] font-medium text-accent-strong', className)}>
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        Fully paid
      </span>
    );
  }
  if (money.paid > 0) return <span className={cn('text-[12px] text-muted', className)}>{inr(money.paid)} received</span>;
  return null;
}

export function travellers(t: { adults: number; children: number }) {
  const a = `${t.adults} adult${t.adults === 1 ? '' : 's'}`;
  return t.children ? `${a}, ${t.children} child${t.children === 1 ? '' : 'ren'}` : a;
}

export function useTeam() {
  return useQuery({ queryKey: ['team'], queryFn: () => api.get<{ team: TeamMember[] }>('/api/team').then((r) => r.team), staleTime: 5 * 60_000 });
}

/** A rupee text box: digits and commas only, ₹ in front */
export function sanitizeRupees(v: string) {
  return v.replace(/[^\d.,]/g, '');
}

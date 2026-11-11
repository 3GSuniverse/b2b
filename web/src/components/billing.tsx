import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, CalendarClock, Check, CreditCard, Lock, Mail, Receipt, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PeriodPicker, PlanCards, SeatPicker, type Period } from '@/components/plan-picker';
import { Button } from '@/components/ui/button';
import { Panel, PanelHeader, Skeleton } from '@/components/ui/display';
import { api, ApiError } from '@/lib/api';
import { BRAND, planName, type Plan, type PlanId } from '@/lib/brand';
import { burst } from '@/lib/celebrate';
import { cn } from '@/lib/cn';
import { CountUp, useMounted } from '@/lib/motion';
import { useSession } from '@/lib/session';
import type { Entitlements } from '@/lib/types';
import { tx } from '../lib/words';

type Kind = 'NEW' | 'RENEW' | 'CHANGE';
type Billing = {
  enabled: boolean;
  gstPercent: number;
  limits: { minSeats: number; maxSeats: number; yearMonths: number; windowDays: number };
  seats: { used: number; limit: number };
  entitlements: Entitlements;
  current: { plan: 'TRIAL' | 'PAID'; planId: PlanId | null; seats: number | null; period: Period; paidUntil: string | null; monthlyQuota: number; trialEndsAt: string | null };
  change: {
    state: 'open' | 'locked' | 'paid';
    startsAt: string;
    opensAt: string | null;
    next: { planId: PlanId; seats: number; period: Period; periodStart: string; periodEnd: string } | null;
  };
  payments: { id: string; planId: string; seats: number; period: Period; kind: Kind; amount: number; gst: number; paidAt: string; periodStart: string; periodEnd: string; paymentId: string | null }[];
};
type Order = { orderId: string; amount: number; currency: string; keyId: string; kind: Kind };
type CheckoutResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void; on(event: string, cb: (r: { error?: { description?: string } }) => void): void };
  }
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;
const logins = (n: number) => `${n} employee login${n === 1 ? '' : 's'}`;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// Razorpay's payment window: loaded only when someone pays, from Razorpay itself
let checkoutScript: Promise<void> | null = null;
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  checkoutScript ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      checkoutScript = null;
      reject(new Error('Couldn’t open Razorpay. Check your internet connection and try again.'));
    };
    document.head.appendChild(s);
  });
  return checkoutScript;
}

/** Where the plan stands: the trial, or the paid plan and how much of its period is left. */
function CurrentPlan({ b }: { b: Billing }) {
  const mounted = useMounted();
  const c = b.current;
  const now = Date.now();
  const applied = b.payments.find((p) => new Date(p.periodStart).getTime() <= now);
  const next = b.change.next;
  if (c.plan === 'PAID' && c.paidUntil) {
    // The period running now ends where the next one (if already paid) starts
    const end = new Date(next ? next.periodStart : c.paidUntil).getTime();
    const start = applied ? new Date(applied.periodStart).getTime() : now;
    const left = Math.max(0, Math.ceil((end - now) / 86_400_000));
    const used = end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 0;
    return (
      <Panel className="relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent-soft blur-2xl" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-muted">Your plan</span>
            <span className="flex items-center gap-2 text-[26px] font-extrabold tracking-[-0.02em]">
              {c.planId ? planName(c.planId) : 'Everything'}
              <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success-strong">
                <Check className="h-3 w-3" /> Active
              </span>
            </span>
            <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
              <span className="flex items-center gap-1.5">
                <Users className="h-4 w-4 text-accent" /> <span className="tnum font-semibold">{b.seats.used}</span> of {logins(b.seats.limit)} in use
              </span>
              <span className="flex items-center gap-1.5">
                <Mail className="h-4 w-4 text-accent" />{' '}
                {b.entitlements.emailsPerDay ? (
                  <>
                    <span className="tnum font-semibold">{b.entitlements.emailsPerDay.toLocaleString('en-IN')}</span> emails and{' '}
                    <span className="tnum font-semibold">{(b.entitlements.whatsappPerDay ?? 0).toLocaleString('en-IN')}</span> WhatsApp messages a day
                  </>
                ) : (
                  <>
                    <span className="tnum font-semibold">{c.monthlyQuota.toLocaleString('en-IN')}</span> emails a month
                  </>
                )}
              </span>
            </span>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <span className="text-[13px] text-muted">This billing cycle ends</span>
            <span className="text-lg font-semibold">{day(new Date(end).toISOString())}</span>
            <span className={cn('text-xs font-medium', left <= 5 && !next ? 'text-warm-strong' : 'text-muted')}>
              <CountUp value={left} /> {left === 1 ? 'day' : 'days'} left
            </span>
          </div>
        </div>
        <div className="relative mt-5 h-2 overflow-hidden rounded-full bg-line-soft" aria-hidden>
          <span className={cn('block h-full rounded-full transition-[width] duration-1000 ease-out', left <= 5 && !next ? 'bg-warm-chart' : 'bg-accent')} style={{ width: mounted ? `${used * 100}%` : '0%' }} />
        </div>
        {next && (
          <p className="relative mt-4 flex items-center gap-2 rounded-[12px] bg-success-soft px-3.5 py-2.5 text-[13px] text-success-strong">
            <CalendarCheck className="h-4 w-4 shrink-0" />
            <span>
              Next billing cycle paid: <b>{planName(next.planId)}, {logins(next.seats)}</b>, {day(next.periodStart)} to {day(next.periodEnd)}.
            </span>
          </p>
        )}
      </Panel>
    );
  }
  const ended = c.trialEndsAt ? new Date(c.trialEndsAt).getTime() <= now : false;
  const daysLeft = c.trialEndsAt ? Math.max(0, Math.ceil((new Date(c.trialEndsAt).getTime() - now) / 86_400_000)) : null;
  return (
    <Panel className={cn('flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6', ended && 'bg-ink text-white')}>
      <div className="flex flex-col gap-1">
        <span className={cn('text-[13px] font-semibold', ended ? 'text-white/70' : 'text-muted')}>Your plan</span>
        <span className="text-[22px] font-extrabold tracking-[-0.02em]">
          {c.planId ? (ended ? `${planName(c.planId)} plan has ended` : 'Plan ending') : ended ? 'Free trial has ended' : 'Free trial'}
        </span>
        <span className={cn('text-sm', ended ? 'text-white/75' : 'text-ink-2')}>
          {ended
            ? 'Sending is off. Choose a plan below to turn it back on; nothing you’ve saved is lost.'
            : `${daysLeft === 0 ? 'Ends today' : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`}, with every feature. Choose a plan any time; your trial data carries over.`}{' '}
          The trial has room for {logins(b.seats.limit)} ({b.seats.used} in use).
        </span>
      </div>
    </Panel>
  );
}

export function BillingSettings() {
  const { user } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['billing'], queryFn: () => api.get<Billing>('/api/billing') });
  const [period, setPeriod] = useState<Period>('month');
  const [seats, setSeats] = useState(1);
  const [paying, setPaying] = useState<PlanId | null>(null);
  const cards = useRef<Partial<Record<PlanId, HTMLElement | null>>>({});
  const canPay = user.role === 'OWNER';

  // Start from what they have: their plan's logins, or the logins already in use
  const loaded = q.data;
  useEffect(() => {
    if (!loaded) return;
    setSeats(Math.max(1, loaded.current.plan === 'PAID' && loaded.current.seats ? loaded.current.seats : loaded.seats.used));
    if (loaded.current.plan === 'PAID') setPeriod(loaded.current.period);
  }, [loaded]);

  const verify = useMutation({
    mutationFn: (r: CheckoutResponse) => api.post<{ ok: true; paidUntil: string; plan: PlanId; seats: number; startsAt: string }>('/api/billing/verify', r),
    onSuccess: (r) => {
      burst(cards.current[r.plan] ?? null);
      setTimeout(() => burst(cards.current[r.plan] ?? null, '#ff8a1f'), 220);
      const later = new Date(r.startsAt).getTime() > Date.now() + 60_000;
      toast.success('Payment received. Thank you!', {
        description: later ? `${planName(r.plan)} with ${logins(r.seats)} starts on ${day(r.startsAt)}.` : `${planName(r.plan)} with ${logins(r.seats)} is active until ${day(r.paidUntil)}.`,
      });
      for (const k of ['billing', 'me', 'agency']) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e: Error) => toast.error('We couldn’t confirm the payment', { description: e.message, duration: 15_000 }),
    onSettled: () => setPaying(null),
  });

  async function pay(plan: Plan) {
    setPaying(plan.id);
    try {
      const [order] = await Promise.all([api.post<Order>('/api/billing/orders', { plan: plan.id, seats, period }), loadCheckout()]);
      const rzp = new window.Razorpay!({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: BRAND.name,
        description: `${plan.name}, ${logins(seats)}, ${period === 'month' ? '30 days' : '1 year'}`,
        image: `${location.origin}/brand/dhrona-mark-512.png`,
        prefill: { name: user.name ?? '', email: user.email ?? '' },
        notes: { plan: plan.id, seats: String(seats), period },
        theme: { color: '#4A3FD1' },
        handler: (r: CheckoutResponse) => verify.mutate(r),
        modal: {
          ondismiss: () => {
            setPaying(null);
            toast.message('Payment cancelled', { description: 'Nothing was charged.' });
          },
        },
      });
      rzp.on('payment.failed', (r) => toast.error('The payment didn’t go through', { description: r.error?.description ?? 'Try again, or use another method.' }));
      rzp.open();
    } catch (e) {
      setPaying(null);
      toast.error(e instanceof ApiError ? e.message : (e as Error).message);
    }
  }

  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.isError || !q.data) return <p className="text-sm text-danger">Couldn’t load your plan. Refresh to try again.</p>;
  const b = q.data;
  const paid = b.current.plan === 'PAID' && b.current.planId;
  const w = b.change;
  const renewing = paid && w.state === 'open' && b.current.paidUntil && new Date(b.current.paidUntil).getTime() > Date.now();
  const tooFew = seats < b.seats.used;

  return (
    <div className="flex flex-col gap-6">
      <CurrentPlan b={b} />

      <Panel className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-[17px] font-semibold">{paid ? 'Your next billing cycle' : 'Choose your plan'}</h2>
          <p className="max-w-[70ch] text-[13px] text-muted">
            Pick a plan and exactly how many employees need a login. Your plan and logins stay the same for the whole billing cycle you pay for (30 days, or a year). You can change both when you pay for
            the next cycle, from {b.limits.windowDays} days before the current one ends.
          </p>
        </div>

        {w.state === 'locked' && (
          <div className="flex items-start gap-3 rounded-[14px] border border-accent/25 bg-accent-soft px-4 py-3.5 text-[13.5px] text-ink">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <p>
              Your plan and logins are fixed until <b>{day(w.startsAt)}</b>. From <b>{day(w.opensAt!)}</b> you can pay for the next billing cycle, with any plan and number of logins. Look around
              meanwhile: the prices below update as you choose.
            </p>
          </div>
        )}
        {w.state === 'open' && renewing && (
          <div className="flex items-start gap-3 rounded-[14px] bg-warm-soft px-4 py-3.5 text-[13.5px] text-warm-strong">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Your billing cycle ends on <b>{day(w.startsAt)}</b>. Pay for the next one now; it starts on that day, with the plan and logins you choose here.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[16px] bg-sunken px-4 py-3.5">
          <SeatPicker value={seats} onChange={setSeats} />
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
        {tooFew && (
          <p className="-mt-2 text-[13px] text-warm-strong">
            {b.seats.used} employee logins are switched on now. Switch off {b.seats.used - seats} in Team before paying for {logins(seats)}.
          </p>
        )}

        <PlanCards
          seats={seats}
          period={period}
          gstPercent={b.gstPercent}
          current={paid ? b.current.planId : null}
          cardRef={(id, el) => {
            cards.current[id] = el;
          }}
          action={(p, price) => {
            const base = price * 100;
            const gst = Math.round((base * b.gstPercent) / 100);
            const same = paid && b.current.planId === p.id && b.current.seats === seats;
            const dark = p.id === 'ultra';
            if (!canPay) return <p className={cn('text-xs', dark ? 'text-nav-muted' : 'text-muted')}>{tx("Only the agency owner can pay.")}</p>;
            if (w.state === 'paid') return <p className={cn('text-xs', dark ? 'text-nav-muted' : 'text-muted')}>Your next billing cycle is already paid.</p>;
            if (w.state === 'locked')
              return (
                <Button variant="secondary" disabled>
                  <Lock className="h-4 w-4" /> From {day(w.opensAt!)}
                </Button>
              );
            return (
              <>
                <Button
                  variant={p.popular || same ? 'primary' : 'secondary'}
                  className={cn(dark && 'bg-highlight text-white hover:bg-highlight/90')}
                  loading={paying === p.id}
                  disabled={!b.enabled || tooFew || (paying !== null && paying !== p.id)}
                  onClick={() => pay(p)}
                >
                  <CreditCard className="h-4 w-4" />
                  {renewing ? (same ? 'Renew' : 'Switch to this') : 'Pay'} {rupees(base + gst)}
                </Button>
                {gst > 0 && <span className={cn('text-center text-[11px]', dark ? 'text-nav-muted' : 'text-muted')}>Includes {rupees(gst)} GST</span>}
              </>
            );
          }}
        />

        <p className="text-[13px] text-ink-2">
          More than 50 employees? Write to{' '}
          <a className="font-semibold text-accent" href={`mailto:${BRAND.supportEmail}?subject=${encodeURIComponent('Plan for a large team')}`}>
            {BRAND.supportEmail}
          </a>{' '}
          and we’ll set up a plan for you.
        </p>
        {!b.enabled ? (
          <p className="rounded-[12px] bg-warm-soft px-4 py-3 text-[13px] text-warm-strong">
            Online payment isn’t switched on yet. To upgrade now, write to <a className="font-semibold underline" href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Lock className="h-3.5 w-3.5" /> Payments are handled by Razorpay. Your card or UPI details never reach {BRAND.name}.
          </p>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Payments" className="px-5 pb-3 pt-5 sm:px-6 sm:pt-6" />
        {b.payments.length === 0 ? (
          <p className="flex items-center gap-2 px-5 pb-5 text-[13px] text-muted sm:px-6">
            <Receipt className="h-4 w-4" /> Your payments will be listed here, with the dates each one covers.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line-soft">
                  <th className="px-5 py-2.5 font-medium sm:px-6">Paid on</th>
                  <th className="px-3 py-2.5 font-medium">Plan</th>
                  <th className="px-3 py-2.5 font-medium">Covers</th>
                  <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-5 py-2.5 font-medium sm:px-6">Payment ID</th>
                </tr>
              </thead>
              <tbody className="stagger">
                {b.payments.map((p) => (
                  <tr key={p.id} className="border-b border-line-soft last:border-0">
                    <td className="whitespace-nowrap px-5 py-3 font-medium sm:px-6">{day(p.paidAt)}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {planName(p.planId)}, {logins(p.seats)}
                      <span className="block text-[11px] text-muted">{p.period === 'month' ? '30 days' : '1 year'}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-ink-2">
                      <CalendarClock className="mr-1 inline h-3.5 w-3.5 text-muted" />
                      {day(p.periodStart)} to {day(p.periodEnd)}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-3 text-right font-semibold">
                      {rupees(p.amount)}
                      {p.gst > 0 && <span className="block text-[11px] font-normal text-muted">incl. {rupees(p.gst)} GST</span>}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-muted sm:px-6">{p.paymentId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

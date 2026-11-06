import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Check, CreditCard, Lock, Mail, Receipt, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/controls';
import { Panel, PanelHeader, Skeleton } from '@/components/ui/display';
import { api, ApiError } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { burst } from '@/lib/celebrate';
import { cn } from '@/lib/cn';
import { CountUp, useMounted } from '@/lib/motion';
import { useSession } from '@/lib/session';

type Period = 'month' | 'year';
type BillingPlan = { id: string; name: string; month: number; year: number; emails: number };
type Billing = {
  enabled: boolean;
  plans: BillingPlan[];
  current: { plan: 'TRIAL' | 'PAID'; planId: string | null; paidUntil: string | null; monthlyQuota: number; trialEndsAt: string | null };
  payments: { id: string; planId: string; period: Period; amount: number; paidAt: string; periodStart: string; periodEnd: string; paymentId: string | null }[];
};
type Order = { orderId: string; amount: number; currency: string; keyId: string };
type CheckoutResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void; on(event: string, cb: (r: { error?: { description?: string } }) => void): void };
  }
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;
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
  const plan = b.plans.find((p) => p.id === c.planId);
  const now = Date.now();
  const last = b.payments[0];
  if (c.plan === 'PAID' && c.paidUntil) {
    const start = last ? new Date(last.periodStart).getTime() : now;
    const end = new Date(c.paidUntil).getTime();
    const left = Math.max(0, Math.ceil((end - now) / 86_400_000));
    const used = end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 0;
    return (
      <Panel className="relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent-soft blur-2xl" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-muted">Your plan</span>
            <span className="flex items-center gap-2 text-[26px] font-extrabold tracking-[-0.02em]">
              {plan?.name ?? 'Paid'}
              <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success-strong">
                <Check className="h-3 w-3" /> Active
              </span>
            </span>
            <span className="text-sm text-ink-2">
              <span className="tnum font-semibold">{c.monthlyQuota.toLocaleString('en-IN')}</span> emails a month
            </span>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <span className="text-[13px] text-muted">Paid until</span>
            <span className="text-lg font-semibold">{day(c.paidUntil)}</span>
            <span className={cn('text-xs font-medium', left <= 3 ? 'text-warm-strong' : 'text-muted')}>
              <CountUp value={left} /> {left === 1 ? 'day' : 'days'} left
            </span>
          </div>
        </div>
        <div className="relative mt-5 h-2 overflow-hidden rounded-full bg-line-soft" aria-hidden>
          <span className={cn('block h-full rounded-full transition-[width] duration-1000 ease-out', left <= 3 ? 'bg-warm-chart' : 'bg-accent')} style={{ width: mounted ? `${used * 100}%` : '0%' }} />
        </div>
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
          {c.planId ? (ended ? `${plan?.name ?? 'Your'} plan has ended` : 'Plan ending') : ended ? 'Free trial has ended' : 'Free trial'}
        </span>
        <span className={cn('text-sm', ended ? 'text-white/75' : 'text-ink-2')}>
          {ended ? 'Sending is off. Choose a plan below to turn it back on; nothing you’ve saved is lost.' : `${daysLeft === 0 ? 'Ends today' : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`}. Choose a plan any time; your trial data carries over.`}
        </span>
      </div>
    </Panel>
  );
}

export function BillingSettings() {
  const { user } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['billing'], queryFn: () => api.get<Billing>('/api/billing') });
  const [period, setPeriod] = useState<Period>('year');
  const [paying, setPaying] = useState<string | null>(null);
  const cards = useRef<Record<string, HTMLElement | null>>({});
  const canPay = user.role !== 'MEMBER';

  const verify = useMutation({
    mutationFn: (r: CheckoutResponse) => api.post<{ ok: true; paidUntil: string; plan: string }>('/api/billing/verify', r),
    onSuccess: (r, _v) => {
      burst(cards.current[r.plan]);
      setTimeout(() => burst(cards.current[r.plan], '#ff8a1f'), 220);
      toast.success('Payment received. Thank you!', { description: `Your plan is active until ${day(r.paidUntil)}.` });
      qc.invalidateQueries({ queryKey: ['billing'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: Error) => toast.error('We couldn’t confirm the payment', { description: e.message, duration: 15_000 }),
    onSettled: () => setPaying(null),
  });

  async function pay(plan: BillingPlan) {
    setPaying(plan.id);
    try {
      const [order] = await Promise.all([api.post<Order>('/api/billing/orders', { plan: plan.id, period }), loadCheckout()]);
      const rzp = new window.Razorpay!({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: BRAND.name,
        description: `${plan.name} plan, ${period === 'month' ? 'monthly' : 'yearly'}`,
        image: `${location.origin}/brand/dhrona-mark-512.png`,
        prefill: { name: user.name ?? '', email: user.email },
        notes: { plan: plan.id, period },
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
  const activePlan = b.current.plan === 'PAID' ? b.current.planId : null;

  return (
    <div className="flex flex-col gap-6">
      <CurrentPlan b={b} />

      <Panel className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[17px] font-semibold">{activePlan ? 'Renew your plan' : 'Choose a plan'}</h2>
            <p className="text-[13px] text-muted">Pay by UPI, card or net banking. Renewing early adds to the time you have left.</p>
          </div>
          <Segmented
            label="Billing period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'month', label: 'Monthly' },
              { value: 'year', label: 'Yearly · 2 months free' },
            ]}
          />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          {b.plans.map((p) => {
            const price = p[period] * 100;
            const current = activePlan === p.id;
            return (
              <article
                key={p.id}
                ref={(el) => {
                  cards.current[p.id] = el;
                }}
                className={cn(
                  'lift relative flex flex-col gap-4 rounded-[16px] border p-5 transition-[border-color,box-shadow]',
                  current ? 'border-accent shadow-[0_0_0_1px_var(--color-accent)]' : 'border-line hover:border-accent/50',
                )}
              >
                {p.id === 'growth' && !current && (
                  <span className="absolute -top-2.5 right-4 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-on-primary">
                    <Sparkles className="h-3 w-3" /> Most agencies pick this
                  </span>
                )}
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-[16px] font-semibold">{p.name}</h3>
                  {current && <span className="text-xs font-semibold text-accent">Your plan</span>}
                </div>
                <p className="flex items-baseline gap-1.5">
                  <span key={`${p.id}-${period}`} className="dispatch-pop tnum text-[32px] font-extrabold tracking-[-0.03em]">
                    {rupees(price)}
                  </span>
                  <span className="text-sm text-muted">{period === 'month' ? 'a month' : 'a year'}</span>
                </p>
                <p className="flex items-center gap-2 text-sm text-ink-2">
                  <Mail className="h-4 w-4 text-accent" /> <span className="tnum font-semibold">{p.emails.toLocaleString('en-IN')}</span> emails a month
                </p>
                {activePlan && !current ? (
                  <p className="mt-auto text-xs leading-relaxed text-muted">
                    To move to {p.name} while your plan is running, write to{' '}
                    <a className="font-semibold text-accent" href={`mailto:${BRAND.supportEmail}?subject=${encodeURIComponent(`Change plan to ${p.name}`)}`}>
                      {BRAND.supportEmail}
                    </a>
                    . You keep the days you’ve paid for.
                  </p>
                ) : canPay ? (
                  <Button
                    variant={p.id === 'growth' || current ? 'primary' : 'secondary'}
                    loading={paying === p.id || (verify.isPending && paying === p.id)}
                    disabled={!b.enabled || (paying !== null && paying !== p.id)}
                    onClick={() => pay(p)}
                    className="mt-auto"
                  >
                    <CreditCard className="h-4 w-4" />
                    {current ? 'Renew' : 'Pay'} {rupees(price)}
                  </Button>
                ) : (
                  <p className="mt-auto text-xs text-muted">Ask the account owner or an admin to pay.</p>
                )}
              </article>
            );
          })}
        </div>
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
            <Receipt className="h-4 w-4" /> Your payments will be listed here, with the period each one covers.
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
                      {b.plans.find((x) => x.id === p.planId)?.name ?? p.planId}, {p.period === 'month' ? 'monthly' : 'yearly'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-ink-2">
                      <CalendarClock className="mr-1 inline h-3.5 w-3.5 text-muted" />
                      {day(p.periodStart)} to {day(p.periodEnd)}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-3 text-right font-semibold">{rupees(p.amount)}</td>
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

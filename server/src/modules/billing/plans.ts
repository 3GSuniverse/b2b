/**
 * What agencies can buy, and what it costs. The server's numbers are the ones charged;
 * the public Pricing page shows the same plans from web/src/lib/brand.ts (a test keeps them equal).
 */
export const BILLING_PLANS = {
  starter: { name: 'Starter', month: 999, year: 9_990, emails: 5_000 },
  growth: { name: 'Growth', month: 2_499, year: 24_990, emails: 25_000 },
} as const;

export type PlanId = keyof typeof BILLING_PLANS;
export type Period = 'month' | 'year';
export const PLAN_IDS = Object.keys(BILLING_PLANS) as PlanId[];

/** Rupees → paise, the unit Razorpay charges in. */
export const pricePaise = (plan: PlanId, period: Period) => BILLING_PLANS[plan][period] * 100;

/** The paid period a payment buys, starting where the current one ends (renewing early loses nothing). */
export function nextPeriod(paidUntil: Date | null, period: Period, now = new Date()) {
  const start = paidUntil && paidUntil.getTime() > now.getTime() ? paidUntil : now;
  const end = new Date(start);
  if (period === 'month') end.setMonth(end.getMonth() + 1);
  else end.setFullYear(end.getFullYear() + 1);
  return { start, end };
}

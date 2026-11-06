/**
 * What agencies can buy: plans by the number of employee logins, each with an email allowance.
 * The server's numbers are the ones charged; the public Pricing page shows the same plans from
 * web/src/lib/brand.ts (a test keeps them equal). Prices are before GST.
 */
export const BILLING_PLANS = {
  team5: { name: 'Team 5', seats: 5, month: 1_999, year: 19_990, emails: 10_000 },
  team10: { name: 'Team 10', seats: 10, month: 3_499, year: 34_990, emails: 25_000 },
  team20: { name: 'Team 20', seats: 20, month: 5_999, year: 59_990, emails: 50_000 },
  team50: { name: 'Team 50', seats: 50, month: 11_999, year: 1_19_990, emails: 1_00_000 },
} as const;

export type PlanId = keyof typeof BILLING_PLANS;
export type Period = 'month' | 'year';
export const PLAN_IDS = Object.keys(BILLING_PLANS) as PlanId[];

/** Employee logins on the free trial, and for agencies the operator set to paid by hand */
export const TRIAL_SEATS = 5;
export const MANUAL_PAID_SEATS = 50;

export const isPlanId = (v: unknown): v is PlanId => typeof v === 'string' && v in BILLING_PLANS;

/** The smallest plan with room for this many employee logins. */
export const planForSeats = (n: number): PlanId => PLAN_IDS.find((id) => BILLING_PLANS[id].seats >= n) ?? 'team50';

/** Rupees → paise, the unit Razorpay charges in (before GST). */
export const pricePaise = (plan: PlanId, period: Period) => BILLING_PLANS[plan][period] * 100;

/** The paid period a payment buys, starting where the current one ends (renewing early loses nothing). */
export function nextPeriod(paidUntil: Date | null, period: Period, now = new Date()) {
  const start = paidUntil && paidUntil.getTime() > now.getTime() ? paidUntil : now;
  const end = new Date(start);
  if (period === 'month') end.setMonth(end.getMonth() + 1);
  else end.setFullYear(end.getFullYear() + 1);
  return { start, end };
}

/**
 * Moving up a plan mid-period: pay only the difference, for the days left.
 * (from, to) = plan prices for the period; the paid-until date doesn't change.
 */
export function upgradePaise(from: PlanId, to: PlanId, period: Period, periodStart: Date, paidUntil: Date, now = new Date()) {
  const total = paidUntil.getTime() - periodStart.getTime();
  const left = Math.max(0, paidUntil.getTime() - now.getTime());
  const diff = pricePaise(to, period) - pricePaise(from, period);
  if (diff <= 0 || total <= 0) return 0;
  return Math.max(100, Math.round((diff * left) / total / 100) * 100); // whole rupees, at least ₹1
}

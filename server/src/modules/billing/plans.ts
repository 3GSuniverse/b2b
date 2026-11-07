/**
 * What agencies buy: a plan (Basic, Professional, Ultra Premium) × the number of employee logins
 * they choose (1 to 50; the owner is always free). The plan and the logins stay fixed for the
 * whole paid period (30 days, or a year); changes are made when paying for the next period.
 *
 * The server's numbers are the ones charged. The public Pricing page shows the same numbers from
 * web/src/lib/brand.ts (a test keeps them equal). Prices are in rupees, before GST.
 */
export const BILLING_PLANS = {
  basic: {
    name: 'Basic',
    first: 1_499, // a month, with one employee login
    extra: 400, // a month, for each login after the first
    emailsPerDay: 350, // per login, a day
    whatsappPerDay: 350, // per login, a day, from the agency's linked number
    aiPerLogin: 0, // Drona AI replies and quote drafts, a day
    domains: 1,
    automations: false,
    groups: false,
    leadApi: false,
    prioritySupport: false,
  },
  professional: {
    name: 'Professional',
    first: 2_999,
    extra: 600,
    emailsPerDay: 600,
    whatsappPerDay: 500,
    aiPerLogin: 40,
    domains: 3,
    automations: true,
    groups: true,
    leadApi: false,
    prioritySupport: false,
  },
  ultra: {
    name: 'Ultra Premium',
    first: 4_999,
    extra: 900,
    emailsPerDay: 1_000,
    whatsappPerDay: 750,
    aiPerLogin: 100,
    domains: 10,
    automations: true,
    groups: true,
    leadApi: true,
    prioritySupport: true,
  },
} as const;

export type PlanId = keyof typeof BILLING_PLANS;
export type Period = 'month' | 'year';
export const PLAN_IDS = Object.keys(BILLING_PLANS) as PlanId[];

export const MIN_SEATS = 1;
export const MAX_SEATS = 50;
/** Paid yearly: 10 months' price for 12. */
export const YEAR_MONTHS = 10;
/** Days in a paid period. A "month" is always 30 days, so every bill covers the same time. */
export const PERIOD_DAYS: Record<Period, number> = { month: 30, year: 365 };
/** Payment for the next period opens this many days before the current one ends. */
export const CHANGE_WINDOW_DAYS = 5;

/** Employee logins on the free trial, and for agencies the operator set to paid by hand */
export const TRIAL_SEATS = 5;
export const MANUAL_PAID_SEATS = 50;

export const isPlanId = (v: unknown): v is PlanId => typeof v === 'string' && v in BILLING_PLANS;
export const validSeats = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= MIN_SEATS && (n as number) <= MAX_SEATS;

/** Rupees a month for this plan with this many employee logins. */
export const monthlyPrice = (plan: PlanId, seats: number) => BILLING_PLANS[plan].first + BILLING_PLANS[plan].extra * Math.max(0, seats - 1);

/** Rupees for the period. */
export const periodPrice = (plan: PlanId, seats: number, period: Period) => monthlyPrice(plan, seats) * (period === 'month' ? 1 : YEAR_MONTHS);

/** Rupees → paise, the unit Razorpay charges in (before GST). */
export const pricePaise = (plan: PlanId, seats: number, period: Period) => periodPrice(plan, seats, period) * 100;

/** Emails a day for the agency: the plan's number per login × logins. */
export const emailsPerDayFor = (plan: PlanId, seats: number) => BILLING_PLANS[plan].emailsPerDay * seats;
/** The monthly email allowance (30 days of the daily one). */
export const emailsFor = (plan: PlanId, seats: number) => emailsPerDayFor(plan, seats) * 30;
/** WhatsApp messages a day from the agency's linked number. */
export const whatsappPerDayFor = (plan: PlanId, seats: number) => BILLING_PLANS[plan].whatsappPerDay * seats;
export const aiPerDayFor = (plan: PlanId, seats: number) => BILLING_PLANS[plan].aiPerLogin * seats;

/** The paid period a payment buys: from where the current one ends (or now), for 30 or 365 days. */
export function nextPeriod(paidUntil: Date | null, period: Period, now = new Date()) {
  const start = paidUntil && paidUntil.getTime() > now.getTime() ? paidUntil : now;
  const end = new Date(start.getTime() + PERIOD_DAYS[period] * 86_400_000);
  return { start, end };
}

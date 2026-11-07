// The product name and the details the public pages and legal text depend on live here only.
export const BRAND = {
  name: 'Dhrona',
  supportEmail: 'support@kurukshetra-travels.in',
  // Who runs Drona, as named in the Privacy Policy, Terms and the policy pages. Use the registered business name.
  operator: 'Kurukshetra Travels',
  // Shown on Contact. Leave null to hide a line; payment providers expect a phone number and an address.
  phone: null as string | null,
  address: null as string | null,
  // Free trial length shown on the public pages and sign-up. Keep it equal to TRIAL_DAYS on the server.
  trialDays: 15,
  supportHours: 'Monday to Saturday, 10 AM to 7 PM India time',
  // Where disputes under the Terms are heard
  courts: 'Vijayawada, Andhra Pradesh',
  // Shown at the top of the Privacy Policy, Terms and policy pages; change it whenever any of them changes
  legalUpdated: '7 November 2026',
};

export type PlanId = 'basic' | 'professional' | 'ultra';
export type Plan = {
  id: PlanId;
  name: string;
  /** Rupees a month, before GST, with one employee login */
  first: number;
  /** Rupees a month for each login after the first */
  extra: number;
  emailsPerLogin: number;
  /** Drona AI answers a day, per login */
  aiPerLogin: number;
  domains: number;
  forWho: string;
  popular?: boolean;
};

// Shown on the Pricing page and in Plan & billing. Must match server/src/modules/billing/plans.ts (a test checks).
export const PLANS: Plan[] = [
  { id: 'basic', name: 'Basic', first: 1_499, extra: 400, emailsPerLogin: 3_000, aiPerLogin: 0, domains: 1, forWho: 'Trips, payments and broadcasts, without the extras.' },
  { id: 'professional', name: 'Professional', first: 2_999, extra: 600, emailsPerLogin: 5_000, aiPerLogin: 40, domains: 3, forWho: 'Drona AI, automatic messages and group departures.', popular: true },
  { id: 'ultra', name: 'Ultra Premium', first: 4_999, extra: 900, emailsPerLogin: 10_000, aiPerLogin: 100, domains: 10, forWho: 'Everything, with the most room and help first.' },
];

export const SEATS = { min: 1, max: 50 };
/** Paid yearly: 10 months' price for 12 */
export const YEAR_MONTHS = 10;

export const monthlyPrice = (p: Plan, seats: number) => p.first + p.extra * Math.max(0, seats - 1);
export const periodPrice = (p: Plan, seats: number, period: 'month' | 'year') => monthlyPrice(p, seats) * (period === 'month' ? 1 : YEAR_MONTHS);

/** What each plan has. A string is shown as the value; true/false as a tick or a dash. */
export const PLAN_FEATURES: { label: string; values: Record<PlanId, boolean | string | ((seats: number) => string)> }[] = [
  { label: 'Trips, quotes, payments and receipts', values: { basic: true, professional: true, ultra: true } },
  { label: 'Payment reminders and trip messages', values: { basic: true, professional: true, ultra: true } },
  { label: 'Email and WhatsApp broadcasts', values: { basic: true, professional: true, ultra: true } },
  { label: 'WhatsApp inbox: see and answer replies', values: { basic: true, professional: true, ultra: true } },
  { label: 'Emails a month', values: { basic: (n) => (3_000 * n).toLocaleString('en-IN'), professional: (n) => (5_000 * n).toLocaleString('en-IN'), ultra: (n) => (10_000 * n).toLocaleString('en-IN') } },
  { label: 'Your own sending domains', values: { basic: '1', professional: '3', ultra: '10' } },
  { label: 'Drona AI: replies and quote drafts', values: { basic: false, professional: (n) => `${40 * n} a day`, ultra: (n) => `${100 * n} a day` } },
  { label: 'Automatic messages on any date', values: { basic: false, professional: true, ultra: true } },
  { label: 'Group departures with seat and room lists', values: { basic: false, professional: true, ultra: true } },
  { label: 'Leads API for website forms and call agents', values: { basic: false, professional: false, ultra: true } },
  { label: 'Priority support on WhatsApp and phone', values: { basic: false, professional: false, ultra: true } },
  { label: 'New features first, like official WhatsApp', values: { basic: false, professional: false, ultra: true } },
];

export const planName = (id: string | null | undefined) => PLANS.find((p) => p.id === id)?.name ?? 'Paid';

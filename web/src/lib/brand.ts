// The product name and the details the public pages and legal text depend on live here only.
export const BRAND = {
  name: 'Dhrona',
  supportEmail: 'support@kurukshetra-travels.in',
  // Who runs Drona, as named in the Privacy Policy, Terms and the policy pages. Use the registered business name.
  operator: 'Kurukshetra Travels',
  // Shown on Contact. Leave null to hide a line; payment providers expect a phone number and an address.
  phone: null as string | null,
  address: null as string | null,
  supportHours: 'Monday to Saturday, 10 AM to 7 PM India time',
  // Where disputes under the Terms are heard
  courts: 'Vijayawada, Andhra Pradesh',
  // Shown at the top of the Privacy Policy, Terms and policy pages; change it whenever any of them changes
  legalUpdated: '5 November 2026',
};

export type Plan = {
  id: string;
  name: string;
  /** Employee logins included (the owner is free) */
  seats: number;
  /** Per month, in rupees, before GST */
  price: number;
  /** Per year, in rupees, when paid yearly */
  yearly: number;
  forWho: string;
  emails: number;
  popular?: boolean;
};

// Shown on the Pricing page. Must match server/src/modules/billing/plans.ts (a test checks).
export const PLANS: Plan[] = [
  { id: 'team5', name: 'Team 5', seats: 5, price: 1_999, yearly: 19_990, emails: 10_000, forWho: 'For a small agency: 1 to 5 employees.' },
  { id: 'team10', name: 'Team 10', seats: 10, price: 3_499, yearly: 34_990, emails: 25_000, forWho: 'For a growing agency: 6 to 10 employees.', popular: true },
  { id: 'team20', name: 'Team 20', seats: 20, price: 5_999, yearly: 59_990, emails: 50_000, forWho: 'For a busy agency: 11 to 20 employees.' },
  { id: 'team50', name: 'Team 50', seats: 50, price: 11_999, yearly: 1_19_990, emails: 1_00_000, forWho: 'For a large agency: 21 to 50 employees.' },
];

/** What every plan includes, whatever its size. */
export const EVERY_PLAN = [
  'Your own agency console: employee logins, and what each person sends',
  'Trips, quotes and payments',
  'Payment reminders and trip messages',
  'Email and WhatsApp broadcasts, with attachments',
  'Group departures with seat and room lists',
  'AI quote drafts in English, Telugu and Hindi',
];

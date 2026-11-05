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
  /** Per month, in rupees */
  price: number;
  /** Per year, in rupees, when paid yearly */
  yearly: number;
  forWho: string;
  emails: number;
  features: string[];
  popular?: boolean;
};

// Shown on the Pricing page. Change the numbers here; everything else follows.
export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: 999,
    yearly: 9_990,
    forWho: 'For an agency with one or two people.',
    emails: 5_000,
    features: ['Trips, quotes and payments', 'Payment reminders and trip messages', 'Email and WhatsApp broadcasts', 'Group departures with seat and room lists', 'AI quote drafts in English, Telugu and Hindi'],
  },
  {
    id: 'growth',
    name: 'Growth',
    price: 2_499,
    yearly: 24_990,
    forWho: 'For a busy agency with group tours.',
    emails: 25_000,
    popular: true,
    features: ['Everything in Starter', 'Five times the emails, for big broadcasts', 'Priority support'],
  },
];

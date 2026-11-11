// The words on screen. A travel agency sees the travel words; every other kind of business sees the same
// screens in everyday words: a trip is an order, a destination is a product, a package is a product.
export const BUSINESS_TYPES = [
  { value: 'TRAVEL', label: 'Travel agency' },
  { value: 'RETAIL', label: 'Shop or retail' },
  { value: 'REAL_ESTATE', label: 'Real estate' },
  { value: 'EDUCATION', label: 'Education or coaching' },
  { value: 'HEALTH', label: 'Clinic or wellness' },
  { value: 'SERVICES', label: 'Services or agency' },
  { value: 'OTHER', label: 'Something else' },
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number]['value'];

let current: string = 'TRAVEL';

/** Called once the signed-in session is known */
export function setBusiness(type: string | undefined) {
  current = type ?? 'TRAVEL';
}
export const isTravelBusiness = () => current === 'TRAVEL';

const RULES: [RegExp, string][] = [
  [/\bPre-trip\b/g, 'Order'],
  [/\bpre-trip\b/g, 'order'],
  [/\bTrips\b/g, 'Orders'],
  [/\btrips\b/g, 'orders'],
  [/\bTrip\b/g, 'Order'],
  [/\btrip\b/g, 'order'],
  [/\bDestinations\b/g, 'Products'],
  [/\bdestinations\b/g, 'products'],
  [/\bDestination\b/g, 'Product'],
  [/\bdestination\b/g, 'product'],
  [/\bPackages\b/g, 'Products'],
  [/\bpackages\b/g, 'products'],
  [/\bPackage\b/g, 'Product'],
  [/\bpackage\b/g, 'product'],
  [/\bAgency\b/g, 'Business'],
  [/\bagency\b/g, 'business'],
  [/\bagencies\b/g, 'businesses'],
  [/\bTravellers\b/g, 'People'],
  [/\btravellers\b/g, 'people'],
  [/\bItinerary\b/g, 'Details'],
  [/\bitinerary\b/g, 'details'],
];

/** The same words for one named kind of business (customer care looks at many businesses at once) */
export function txFor(type: string | undefined, text: string): string {
  if (!type || type === 'TRAVEL') return text;
  let out = text;
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out;
}

/** Wraps a screen word or sentence: unchanged for travel agencies, in everyday words for everyone else. */
export function tx(text: string): string {
  return txFor(current, text);
}

/** Customer care serves every kind of business, so it says "business" where a screen would say "agency" */
export function nb(text: string): string {
  return text.replace(/\bAgenc(y|ies)\b/g, (_, e) => (e === 'y' ? 'Business' : 'Businesses')).replace(/\bagenc(y|ies)\b/g, (_, e) => (e === 'y' ? 'business' : 'businesses'));
}

export const businessLabel = (type: string | undefined) => BUSINESS_TYPES.find((b) => b.value === type)?.label ?? 'Travel agency';

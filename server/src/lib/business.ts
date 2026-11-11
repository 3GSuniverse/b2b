// What kind of business signed up. Travel agencies get the full travel product; every other kind gets the same
// product under everyday words (a "trip" becomes an "order", a "destination" becomes a "product").
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
export const BUSINESS_VALUES = BUSINESS_TYPES.map((b) => b.value) as [BusinessType, ...BusinessType[]];
export const isTravel = (t: { businessType: string }) => t.businessType === 'TRAVEL';

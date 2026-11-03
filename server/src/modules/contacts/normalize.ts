import { z } from 'zod';

const emailSchema = z.email();

/** Lower-cased, trimmed, valid — or null. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase().replace(/^mailto:/, '');
  if (!e) return null;
  return emailSchema.safeParse(e).success ? e : null;
}

/**
 * Phone numbers to E.164 (+919848012345), assuming India when no country code is given.
 * Accepts "98480 12345", "098480-12345", "+91 98480 12345", "919848012345".
 */
export function normalizePhone(raw: unknown, defaultCountry = '91'): string | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const plus = s.startsWith('+') || s.startsWith('00');
  let digits = s.replace(/\D/g, '');
  if (s.startsWith('00')) digits = digits.slice(2);
  if (!plus) {
    if (defaultCountry === '91') {
      if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
      if (digits.length === 10 && /^[6-9]/.test(digits)) digits = `91${digits}`;
    } else if (digits.length <= 10) {
      digits = `${defaultCountry}${digits.replace(/^0+/, '')}`;
    }
  }
  s = `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Dates the way Indian spreadsheets write them → "YYYY-MM-DD".
 * Day-first (20/11/2026, 20-11-2026, 20.11.2026), ISO (2026-11-20), and "20 Nov 2026".
 * Ambiguous US-style input is read day-first, as in India.
 */
export function parseDateValue(raw: unknown): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = String(raw).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) return iso(+m[3]!, +m[2]!, +m[1]!);
  m = s.match(/^(\d{1,2})[\s-]+([a-z]{3,9})[\s,-]+(\d{2,4})$/i);
  if (m) {
    const mon = MONTHS[m[2]!.toLowerCase().slice(0, m[2]!.toLowerCase().startsWith('sept') ? 4 : 3)];
    if (mon) return iso(+m[3]!, mon, +m[1]!);
  }
  m = s.match(/^([a-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})$/i);
  if (m) {
    const mon = MONTHS[m[1]!.toLowerCase().slice(0, 3)];
    if (mon) return iso(+m[3]!, mon, +m[2]!);
  }
  return null;
}

/** "Trip Date" → "trip_date". Used for custom field keys and merge tags. */
export function fieldKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'f_$1')
    .slice(0, 40);
}

export const RESERVED_KEYS = new Set([
  'email', 'phone', 'first_name', 'last_name', 'full_name', 'company_name', 'unsubscribe_url', 'id', 'status',
]);

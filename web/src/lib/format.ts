const TZ = 'Asia/Kolkata';

export const n = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-IN');
export const pct = (v: number | null | undefined, digits = 1) => `${(v ?? 0).toFixed(v && v % 1 !== 0 ? digits : 0)}%`;

export function date(iso: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { timeZone: TZ, ...opts });
}

export function dateTime(iso: string | Date | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function time(iso: string | Date | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
}

/** "2 hours ago", "yesterday", "3 Nov" */
export function ago(iso: string | Date | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 0) return `in ${relative(-s)}`;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hour${Math.round(s / 3600) > 1 ? 's' : ''} ago`;
  if (s < 2 * 86400) return 'yesterday';
  if (s < 7 * 86400) return `${Math.round(s / 86400)} days ago`;
  return date(d);
}

function relative(s: number) {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}

/** Countdown parts for "Sends in 4 days 18 h" */
export function until(iso: string | Date) {
  const ms = new Date(iso).getTime() - Date.now();
  const d = Math.max(0, Math.floor(ms / 86_400_000));
  const h = Math.max(0, Math.floor((ms % 86_400_000) / 3_600_000));
  const m = Math.max(0, Math.floor((ms % 3_600_000) / 60_000));
  const s = Math.max(0, Math.floor((ms % 60_000) / 1000));
  return { d, h, m, s, past: ms <= 0 };
}

export const initials = (name?: string | null, email?: string | null) => {
  const src = (name || email || '?').trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
};

const AVATAR = [
  ['bg-accent-soft', 'text-accent-strong'],
  ['bg-warm-soft', 'text-warm-strong'],
  ['bg-blue-soft', 'text-blue-ink'],
  ['bg-plum-soft', 'text-plum-ink'],
] as const;
export function avatarTone(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length]!.join(' ');
}

/** +919848022338 → +91 98480 22338. Other countries are shown as stored. */
export function phone(p: string | null | undefined) {
  if (!p) return '';
  const m = /^\+91(\d{5})(\d{5})$/.exec(p);
  return m ? `+91 ${m[1]} ${m[2]}` : p;
}

/** Paise → "₹18,500" (paise shown only when there are any). */
export function inr(paise: number | null | undefined) {
  const p = paise ?? 0;
  const sign = p < 0 ? '−' : '';
  const r = Math.abs(p) / 100;
  return `${sign}₹${r.toLocaleString('en-IN', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** Short form for tight spaces: ₹4.5L, ₹1.2Cr, ₹18.5k */
export function inrShort(paise: number | null | undefined) {
  const r = (paise ?? 0) / 100;
  if (r >= 1e7) return `₹${+(r / 1e7).toFixed(2)}Cr`;
  if (r >= 1e5) return `₹${+(r / 1e5).toFixed(2)}L`;
  if (r >= 1e3) return `₹${+(r / 1e3).toFixed(1)}k`;
  return `₹${r.toLocaleString('en-IN')}`;
}

/** Paise → the rupee value for an input box ("18500", "18500.5") */
export const rupeesInput = (paise: number | null | undefined) => (paise ? (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '');

/** Today in the browser, YYYY-MM-DD */
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "12–18 Dec 2026", "28 Dec – 3 Jan 2027", "12 Dec 2026" */
export function dateRange(start: string | null | undefined, end: string | null | undefined) {
  if (!start) return null;
  const s = new Date(`${start}T00:00:00`);
  const e = end ? new Date(`${end}T00:00:00`) : null;
  const year = (d: Date) => d.getFullYear();
  const dm = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  if (!e || start === end) return `${dm(s)} ${year(s)}`;
  if (year(s) !== year(e)) return `${dm(s)} ${year(s)} – ${dm(e)} ${year(e)}`;
  if (s.getMonth() === e.getMonth()) return `${s.getDate()}–${dm(e)} ${year(e)}`;
  return `${dm(s)} – ${dm(e)} ${year(e)}`;
}

/** Days and nights: 12–18 Dec → "7 days" */
export function tripLength(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return null;
  const days = Math.round((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86_400_000) + 1;
  return days === 1 ? 'Day trip' : `${days} days`;
}

/** "12 Dec" with the year only when it isn't this year */
export function shortDate(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

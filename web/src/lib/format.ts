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
  return { d, h, m, past: ms <= 0 };
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

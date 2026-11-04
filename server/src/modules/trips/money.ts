/**
 * Money for a trip, worked out from the schedule and the payments received.
 * Pure functions: no database, so every case is easy to test.
 *
 * Amounts are integers in paise. Payments are applied to dues in date order:
 * the advance is paid off first, then the next instalment, and so on.
 */

export type DueState = 'PAID' | 'PART_PAID' | 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING';

export interface DueInput {
  id: string;
  label: string;
  amount: number;
  dueDate: string; // YYYY-MM-DD
  position: number;
}

export interface DueView extends DueInput {
  paid: number; // how much of this due is covered
  remaining: number;
  state: DueState;
}

export interface TripMoney {
  price: number;
  paid: number; // all valid payments
  balance: number; // price - paid; negative means overpaid (refund due)
  scheduled: number; // total of the schedule
  unscheduled: number; // price not yet covered by any due (0 when the schedule matches the price)
  dues: DueView[];
  overdue: number; // sum still unpaid on dues whose date has passed
  nextDue: DueView | null; // the first due that isn't fully paid
}

/** Today's date (YYYY-MM-DD) in the company's time zone. */
export function localDate(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function sortDues<T extends { dueDate: string; position: number }>(dues: T[]) {
  return [...dues].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.position - b.position);
}

export function tripMoney(input: { price: number; dues: DueInput[]; payments: { amount: number; voidedAt?: Date | string | null }[] }, today: string): TripMoney {
  const paid = input.payments.filter((p) => !p.voidedAt).reduce((a, p) => a + p.amount, 0);
  let left = paid;
  const dues: DueView[] = sortDues(input.dues).map((d) => {
    const covered = Math.max(0, Math.min(d.amount, left));
    left -= covered;
    const remaining = d.amount - covered;
    const state: DueState =
      remaining === 0 ? 'PAID' : d.dueDate < today ? 'OVERDUE' : d.dueDate === today ? 'DUE_TODAY' : covered > 0 ? 'PART_PAID' : 'UPCOMING';
    return { ...d, paid: covered, remaining, state };
  });
  const scheduled = input.dues.reduce((a, d) => a + d.amount, 0);
  return {
    price: input.price,
    paid,
    balance: input.price - paid,
    scheduled,
    unscheduled: Math.max(0, input.price - scheduled),
    dues,
    overdue: dues.filter((d) => d.state === 'OVERDUE').reduce((a, d) => a + d.remaining, 0),
    nextDue: dues.find((d) => d.remaining > 0) ?? null,
  };
}

/** Rupees as typed by a person ("18,500", "18500.50", "₹ 18,500") → paise. Null if it isn't a sensible amount. */
export function rupeesToPaise(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** ₹18,500 or ₹18,500.50, Indian digit grouping. */
export function formatInr(paise: number) {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/**
 * A sensible default schedule for a price: an advance now, the balance before departure.
 * Advance is 25% rounded to the nearest ₹500; the balance is due 15 days before the trip
 * (or today, if the trip is sooner).
 */
export function suggestSchedule(price: number, startDate: string | null, today: string) {
  if (price <= 0) return [];
  const advance = Math.min(price, Math.max(50_000, Math.round((price * 0.25) / 50_000) * 50_000));
  const balanceDate = startDate ? addDays(startDate, -15) : addDays(today, 30);
  const rows = [{ label: 'Advance', amount: advance, dueDate: today }];
  if (price - advance > 0) rows.push({ label: 'Balance', amount: price - advance, dueDate: balanceDate < today ? today : balanceDate });
  return rows;
}

export function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

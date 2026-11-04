import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, or, sql, sum, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { auditLogs, contacts, tenants, tripDues, tripPayments, trips, users, type Trip } from '../../db/schema.js';
import { db, type Tx } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { ensureField } from '../contacts/fields.js';
import { normalizeEmail, normalizePhone } from '../contacts/normalize.js';
import { payPageUrl, receiptUrl, remindersFor } from '../payments/reminders.js';
import { formatInr, localDate, rupeesToPaise, suggestSchedule, tripMoney, type DueInput } from './money.js';

export interface Actor {
  tenantId: string;
  userId: string | null; // null: the system (maintenance) or an API key
}

export const TRIP_STATUSES = ['ENQUIRY', 'QUOTED', 'BOOKED', 'COMPLETED', 'LOST', 'CANCELLED'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
export const OPEN_STATUSES: TripStatus[] = ['ENQUIRY', 'QUOTED', 'BOOKED'];
export const TRIP_SOURCES = ['PHONE', 'WHATSAPP', 'WALK_IN', 'WEBSITE', 'REFERRAL', 'CALL_AGENT', 'EMAIL', 'OTHER'] as const;

// ---------------------------------------------------------------------
//  Validation
// ---------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-20');
/** Rupees from a form ("18,500" or 18500) → paise */
const money = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const p = rupeesToPaise(v);
  if (p === null) {
    ctx.addIssue({ code: 'custom', message: 'Enter an amount like 18,500' });
    return z.NEVER;
  }
  return p;
});
const optionalMoney = z.union([money, z.literal('').transform(() => null), z.null()]).optional();

const customerInput = z.union([
  z.object({ contactId: z.string().min(1) }),
  z
    .object({
      name: z.string().trim().min(1, 'Enter the customer’s name').max(120),
      phone: z.string().trim().max(30).optional(),
      email: z.string().trim().max(254).optional(),
      whatsappOptIn: z.boolean().default(false),
    })
    .refine((v) => v.phone || v.email, { message: 'Enter a phone number or an email', path: ['phone'] }),
]);

const tripFields = {
  title: z.string().trim().min(1, 'Give the trip a name').max(120),
  destination: z.string().trim().max(120).nullable().optional(),
  startDate: isoDate.nullable().optional(),
  endDate: isoDate.nullable().optional(),
  adults: z.coerce.number().int().min(0).max(500).optional(),
  children: z.coerce.number().int().min(0).max(500).optional(),
  budget: optionalMoney,
  price: optionalMoney,
  source: z.enum(TRIP_SOURCES).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  assignedToId: z.string().nullable().optional(),
};

const datesInOrder = (v: { startDate?: string | null; endDate?: string | null }) => !v.startDate || !v.endDate || v.endDate >= v.startDate;
const datesMessage = { message: 'The return date is before the start date', path: ['endDate'] };

export const createTripBody = z
  .object({
    customer: customerInput,
    ...tripFields,
    title: tripFields.title.optional(), // defaults to "<destination> trip"
    status: z.enum(['ENQUIRY', 'QUOTED', 'BOOKED']).default('ENQUIRY'),
  })
  .refine(datesInOrder, datesMessage);

export const updateTripBody = z
  .object({
    ...tripFields,
    title: tripFields.title.optional(),
    status: z.enum(TRIP_STATUSES).optional(),
    lostReason: z.string().trim().max(300).nullable().optional(),
  })
  .refine(datesInOrder, datesMessage);

export const duesBody = z.object({
  dues: z
    .array(
      z.object({
        label: z.string().trim().min(1, 'Name this payment').max(60),
        amount: money.refine((p) => p > 0, 'Enter an amount above zero'),
        dueDate: isoDate,
      }),
    )
    .max(24, 'Up to 24 payments'),
});

export const paymentBody = z.object({
  amount: money.refine((p) => p > 0, 'Enter an amount above zero'),
  method: z.enum(['UPI', 'CASH', 'BANK', 'CARD', 'ONLINE', 'OTHER']),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(300).optional(),
  paidAt: z.iso.datetime({ offset: true }).optional(),
});

export const listTripsQuery = z.object({
  status: z.union([z.enum(TRIP_STATUSES), z.literal('OPEN'), z.literal('CLOSED')]).optional(),
  search: z.string().trim().max(100).optional(),
  contactId: z.string().optional(),
  payments: z.enum(['overdue', 'due']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

// ---------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------

async function tenantTz(tenantId: string) {
  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId), columns: { timezone: true } });
  return t?.timezone ?? 'Asia/Kolkata';
}

function isUniqueViolation(err: unknown) {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === '23505';
}

/** Next per-company number. Two people saving at the same moment: the second one retries. */
async function withNextNumber<T>(next: () => Promise<number>, insert: (n: number) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await insert(await next());
    } catch (err) {
      if (attempt < 4 && isUniqueViolation(err)) continue;
      throw err;
    }
  }
}

const nextTripNumber = (tenantId: string) => async () =>
  ((await db.select({ n: sql<number>`coalesce(max(${trips.number}), 0)::int` }).from(trips).where(eq(trips.tenantId, tenantId)))[0]?.n ?? 0) + 1;

const nextReceiptNumber = (tenantId: string) => async () =>
  ((await db.select({ n: sql<number>`coalesce(max(${tripPayments.receiptNumber}), 0)::int` }).from(tripPayments).where(eq(tripPayments.tenantId, tenantId)))[0]?.n ?? 0) + 1;

async function audit(actor: Actor, action: string, tripId: string, meta?: Record<string, unknown>, dbx: Tx | typeof db = db) {
  await dbx.insert(auditLogs).values({ tenantId: actor.tenantId, userId: actor.userId, action, entity: 'trip', entityId: tripId, meta: meta ?? null });
}

function fullName(c: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null }) {
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.phone || 'Customer';
}

function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] ?? null, lastName: parts.length > 1 ? parts.slice(1).join(' ') : null };
}

/** The contact for a trip: picked from Contacts, or found by phone/email, or created. */
export async function resolveCustomer(tenantId: string, input: z.infer<typeof customerInput>, consentSource = 'trip enquiry') {
  if ('contactId' in input) {
    const c = await db.query.contacts.findFirst({ where: and(eq(contacts.id, input.contactId), eq(contacts.tenantId, tenantId)) });
    if (!c) throw new AppError(404, 'contact_not_found', 'Contact not found');
    return c;
  }
  const email = input.email ? normalizeEmail(input.email) : null;
  if (input.email && !email) throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: { 'customer.email': 'Enter a valid email address' } });
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.phone && !phone) throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: { 'customer.phone': 'Enter a valid phone number' } });

  const existing = await db.query.contacts.findFirst({
    where: and(eq(contacts.tenantId, tenantId), or(phone ? eq(contacts.phone, phone) : undefined, email ? eq(contacts.email, email) : undefined)),
  });
  if (existing) {
    // Fill in what we didn't know, never overwrite what we did
    const patch: Partial<typeof contacts.$inferInsert> = {};
    const { firstName, lastName } = splitName(input.name);
    if (!existing.firstName && firstName) Object.assign(patch, { firstName, lastName });
    if (!existing.phone && phone) patch.phone = phone;
    if (!existing.email && email) patch.email = email;
    if (input.whatsappOptIn && (existing.phone || phone) && existing.whatsappStatus === 'UNSUBSCRIBED') patch.whatsappStatus = 'SUBSCRIBED';
    if (Object.keys(patch).length) {
      try {
        const [row] = await db.update(contacts).set(patch).where(eq(contacts.id, existing.id)).returning();
        return row!;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err; // the phone/email belongs to another contact: keep this one as it was
      }
    }
    return existing;
  }
  const [row] = await db
    .insert(contacts)
    .values({
      tenantId,
      email,
      phone,
      ...splitName(input.name),
      whatsappStatus: input.whatsappOptIn && phone ? 'SUBSCRIBED' : 'UNSUBSCRIBED',
      consentSource,
      consentAt: new Date(),
    })
    .returning();
  return row!;
}

/**
 * Writes the customer's trip onto their contact ("Trip date", "Return date", "Destination"),
 * so automations like "3 days before the trip" and "the day after they're back" just work.
 * The trip used is their next upcoming booked trip, or else their latest one.
 * A cancelled or lost trip removes its dates, so no reminder goes out for a trip that isn't happening.
 */
export async function syncContactTripFields(tenantId: string, contactId: string | null, removed?: Pick<Trip, 'startDate'>) {
  if (!contactId) return;
  const contact = await db.query.contacts.findFirst({ where: and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)) });
  if (!contact) return;
  const today = localDate(await tenantTz(tenantId));
  const booked = await db
    .select({ startDate: trips.startDate, endDate: trips.endDate, destination: trips.destination })
    .from(trips)
    .where(and(eq(trips.tenantId, tenantId), eq(trips.contactId, contactId), inArray(trips.status, ['BOOKED', 'COMPLETED']), sql`${trips.startDate} is not null`))
    .orderBy(asc(trips.startDate));
  const pick = booked.find((t) => (t.endDate ?? t.startDate)! >= today) ?? booked.at(-1);

  const attrs = { ...(contact.attributes as Record<string, unknown>) };
  if (pick) {
    await Promise.all([ensureField(db, tenantId, 'Trip date', 'DATE'), ensureField(db, tenantId, 'Return date', 'DATE'), ensureField(db, tenantId, 'Destination', 'TEXT')]);
    attrs.trip_date = pick.startDate;
    attrs.return_date = pick.endDate ?? pick.startDate;
    if (pick.destination) attrs.destination = pick.destination;
  } else if (removed?.startDate && attrs.trip_date === removed.startDate) {
    delete attrs.trip_date;
    delete attrs.return_date;
  } else {
    return;
  }
  await db.update(contacts).set({ attributes: attrs }).where(eq(contacts.id, contactId));
}

// ---------------------------------------------------------------------
//  Read
// ---------------------------------------------------------------------

type TripWithMoney = Trip & {
  dues: (typeof tripDues.$inferSelect)[];
  payments: (typeof tripPayments.$inferSelect)[];
  contact: typeof contacts.$inferSelect | null;
  assignedTo: { id: string; name: string } | null;
};

const tripWith = {
  dues: true,
  payments: true,
  contact: true,
  assignedTo: { columns: { id: true, name: true } },
} as const;

function tripSummaryDto(t: TripWithMoney, today: string) {
  const m = tripMoney({ price: t.price, dues: t.dues as DueInput[], payments: t.payments }, today);
  return {
    id: t.id,
    number: t.number,
    kind: t.kind,
    status: t.status,
    title: t.title,
    destination: t.destination,
    startDate: t.startDate,
    endDate: t.endDate,
    adults: t.adults,
    children: t.children,
    budget: t.budget,
    price: t.price,
    source: t.source,
    customer: {
      id: t.contact?.id ?? null,
      name: t.contact ? fullName(t.contact) : t.customerName,
      phone: t.contact?.phone ?? null,
      email: t.contact?.email ?? null,
      whatsappStatus: t.contact?.whatsappStatus ?? null,
    },
    assignedTo: t.assignedTo,
    money: { paid: m.paid, balance: m.balance, overdue: m.overdue, nextDue: m.nextDue && { label: m.nextDue.label, amount: m.nextDue.remaining, dueDate: m.nextDue.dueDate, state: m.nextDue.state } },
    statusChangedAt: t.statusChangedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export async function listTrips(tenantId: string, q: z.infer<typeof listTripsQuery>) {
  const today = localDate(await tenantTz(tenantId));
  const where: SQL[] = [eq(trips.tenantId, tenantId)];
  if (q.status === 'OPEN') where.push(inArray(trips.status, OPEN_STATUSES));
  else if (q.status === 'CLOSED') where.push(inArray(trips.status, ['COMPLETED', 'LOST', 'CANCELLED']));
  else if (q.status) where.push(eq(trips.status, q.status));
  if (q.contactId) where.push(eq(trips.contactId, q.contactId));
  if (q.search) {
    const term = `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const digits = q.search.replace(/\D/g, '');
    const num = /^#?\d+$/.test(q.search.trim()) ? Number(q.search.replace('#', '')) : null;
    where.push(
      or(
        ilike(trips.title, term),
        ilike(trips.destination, term),
        ilike(trips.customerName, term),
        ...(num !== null ? [eq(trips.number, num)] : []),
        ...(digits.length >= 4 ? [sql`exists (select 1 from contacts c where c.id = "trips"."contact_id" and c.phone like ${`%${digits}%`})`] : []),
      )!,
    );
  }
  if (q.payments) {
    // Trips with an unpaid due on or before today ('overdue') / within the next 7 days ('due')
    const until = q.payments === 'overdue' ? sql`${today}::date - 1` : sql`${today}::date + 7`;
    where.push(sql`exists (select 1 from trip_dues d where d.trip_id = "trips"."id" and d.due_date <= ${until})`);
    where.push(inArray(trips.status, ['BOOKED', 'QUOTED', 'ENQUIRY', 'COMPLETED']));
  }
  const condition = and(...where);

  // Payment filters need the computed balance, so they're applied after loading; everything else pages in SQL
  const rows = await db.query.trips.findMany({
    where: condition,
    with: tripWith,
    orderBy: [desc(trips.updatedAt), desc(trips.id)],
    limit: q.payments ? 1000 : q.pageSize,
    offset: q.payments ? 0 : (q.page - 1) * q.pageSize,
  });
  let items = (rows as TripWithMoney[]).map((t) => tripSummaryDto(t, today));
  let total: number;
  if (q.payments) {
    items = items.filter((t) => (q.payments === 'overdue' ? t.money.overdue > 0 : t.money.nextDue !== null));
    items.sort((a, b) => (a.money.nextDue?.dueDate ?? '').localeCompare(b.money.nextDue?.dueDate ?? ''));
    total = items.length;
    items = items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
  } else {
    total = (await db.select({ n: count() }).from(trips).where(condition))[0]?.n ?? 0;
  }
  return { trips: items, page: q.page, pageSize: q.pageSize, total, pages: Math.max(1, Math.ceil(total / q.pageSize)) };
}

/** Numbers for the top of the Trips page. */
export async function tripStats(tenantId: string) {
  const tz = await tenantTz(tenantId);
  const today = localDate(tz);
  const byStatus = await db.select({ status: trips.status, n: count(), value: sum(trips.price).mapWith(Number) }).from(trips).where(eq(trips.tenantId, tenantId)).groupBy(trips.status);
  const s = Object.fromEntries(byStatus.map((r) => [r.status, r]));
  const monthStart = `${today.slice(0, 7)}-01`;
  const [collected] = await db
    .select({ total: sql<number>`coalesce(sum(${tripPayments.amount}), 0)::bigint`.mapWith(Number) })
    .from(tripPayments)
    .where(and(eq(tripPayments.tenantId, tenantId), isNull(tripPayments.voidedAt), sql`(${tripPayments.paidAt} at time zone ${tz})::date >= ${monthStart}::date`));

  // Money owed: computed per trip, across trips that have a schedule
  const withDues = (await db.query.trips.findMany({
    where: and(eq(trips.tenantId, tenantId), inArray(trips.status, ['ENQUIRY', 'QUOTED', 'BOOKED', 'COMPLETED']), sql`exists (select 1 from trip_dues d where d.trip_id = "trips"."id")`),
    with: { dues: true, payments: true },
  })) as TripWithMoney[];
  let overdue = 0;
  let overdueTrips = 0;
  let dueThisWeek = 0;
  const weekEnd = new Date(`${today}T00:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  const weekEndIso = weekEnd.toISOString().slice(0, 10);
  for (const t of withDues) {
    const m = tripMoney({ price: t.price, dues: t.dues as DueInput[], payments: t.payments }, today);
    if (m.overdue > 0) {
      overdue += m.overdue;
      overdueTrips++;
    }
    dueThisWeek += m.dues.filter((d) => d.remaining > 0 && d.dueDate >= today && d.dueDate <= weekEndIso).reduce((a, d) => a + d.remaining, 0);
  }

  const departing = await db
    .select({ n: count() })
    .from(trips)
    .where(and(eq(trips.tenantId, tenantId), eq(trips.status, 'BOOKED'), sql`${trips.startDate} between ${today}::date and ${weekEndIso}::date`));

  return {
    counts: Object.fromEntries(TRIP_STATUSES.map((st) => [st, s[st]?.n ?? 0])) as Record<TripStatus, number>,
    pipelineValue: (s.QUOTED?.value ?? 0) as number, // quoted, not yet booked
    collectedThisMonth: collected?.total ?? 0,
    overdue,
    overdueTrips,
    dueThisWeek,
    departingThisWeek: departing[0]?.n ?? 0,
  };
}

async function ownedTrip(tenantId: string, id: string) {
  const t = await db.query.trips.findFirst({ where: and(eq(trips.id, id), eq(trips.tenantId, tenantId)), with: tripWith });
  if (!t) throw new AppError(404, 'trip_not_found', 'Trip not found');
  return t as TripWithMoney;
}

export async function getTrip(tenantId: string, id: string) {
  const t = await ownedTrip(tenantId, id);
  const today = localDate(await tenantTz(tenantId));
  const m = tripMoney({ price: t.price, dues: t.dues as DueInput[], payments: t.payments }, today);
  const recordedBy = new Map(
    (await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.tenantId, tenantId))).map((u) => [u.id, u.name]),
  );
  const activity = await db
    .select({ id: auditLogs.id, action: auditLogs.action, meta: auditLogs.meta, userId: auditLogs.userId, createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.entity, 'trip'), eq(auditLogs.entityId, id)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(50);
  return {
    ...tripSummaryDto(t, today),
    notes: t.notes,
    lostReason: t.lostReason,
    bookedAt: t.bookedAt,
    money: {
      price: m.price,
      paid: m.paid,
      balance: m.balance,
      overdue: m.overdue,
      scheduled: m.scheduled,
      unscheduled: m.unscheduled,
      nextDue: m.nextDue && { label: m.nextDue.label, amount: m.nextDue.remaining, dueDate: m.nextDue.dueDate, state: m.nextDue.state },
      dues: m.dues.map((d) => ({ id: d.id, label: d.label, amount: d.amount, dueDate: d.dueDate, paid: d.paid, remaining: d.remaining, state: d.state, remindedAt: (t.dues.find((x) => x.id === d.id)?.remindedAt ?? null) })),
    },
    payments: [...t.payments]
      .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime())
      .map((p) => ({
        id: p.id,
        receiptNumber: p.receiptNumber,
        amount: p.amount,
        method: p.method,
        reference: p.reference,
        note: p.note,
        paidAt: p.paidAt,
        recordedBy: p.recordedById ? (recordedBy.get(p.recordedById) ?? null) : null,
        voidedAt: p.voidedAt,
        voidReason: p.voidReason,
        receiptUrl: receiptUrl(p.publicToken),
      })),
    suggestedSchedule: t.dues.length ? null : suggestSchedule(t.price, t.startDate, today),
    payPageUrl: payPageUrl(t.publicToken),
    reminders: (await remindersFor(t.id)).map((r) => ({ ...r, dueLabel: t.dues.find((d) => d.id === r.dueId)?.label ?? null })),
    activity: activity.map((a) => ({ ...a, by: a.userId ? (recordedBy.get(a.userId) ?? null) : null })),
  };
}

// ---------------------------------------------------------------------
//  Write
// ---------------------------------------------------------------------

async function assertAssignee(tenantId: string, userId: string | null | undefined) {
  if (!userId) return;
  const u = await db.query.users.findFirst({ where: and(eq(users.id, userId), eq(users.tenantId, tenantId)), columns: { id: true } });
  if (!u) throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: { assignedToId: 'Choose someone from your team' } });
}

export async function createTrip(actor: Actor, input: z.infer<typeof createTripBody>, opts: { consentSource?: string } = {}) {
  await assertAssignee(actor.tenantId, input.assignedToId);
  const contact = await resolveCustomer(actor.tenantId, input.customer, opts.consentSource);
  const title = input.title || (input.destination ? `${input.destination} trip` : `Trip for ${fullName(contact)}`);
  const now = new Date();
  const trip = await withNextNumber(nextTripNumber(actor.tenantId), async (number) => {
    const [row] = await db
      .insert(trips)
      .values({
        tenantId: actor.tenantId,
        number,
        status: input.status,
        contactId: contact.id,
        customerName: fullName(contact),
        title,
        destination: input.destination || null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        adults: input.adults ?? 1,
        children: input.children ?? 0,
        budget: input.budget ?? null,
        price: input.price ?? 0,
        source: input.source ?? null,
        notes: input.notes || null,
        assignedToId: input.assignedToId ?? actor.userId,
        createdById: actor.userId,
        statusChangedAt: now,
        bookedAt: input.status === 'BOOKED' ? now : null,
      })
      .returning();
    return row!;
  });
  await audit(actor, 'trip.create', trip.id, { status: trip.status, source: trip.source });
  if (trip.status === 'BOOKED') await syncContactTripFields(actor.tenantId, trip.contactId);
  return getTrip(actor.tenantId, trip.id);
}

export async function updateTrip(actor: Actor, id: string, input: z.infer<typeof updateTripBody>) {
  const before = await ownedTrip(actor.tenantId, id);
  await assertAssignee(actor.tenantId, input.assignedToId);
  const start = input.startDate !== undefined ? input.startDate : before.startDate;
  const end = input.endDate !== undefined ? input.endDate : before.endDate;
  if (start && end && end < start) throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: { endDate: 'The return date is before the start date' } });

  const patch: Partial<typeof trips.$inferInsert> = {};
  for (const k of ['title', 'destination', 'startDate', 'endDate', 'adults', 'children', 'budget', 'price', 'source', 'notes', 'assignedToId'] as const) {
    if (input[k] !== undefined) (patch as Record<string, unknown>)[k] = input[k] === '' ? null : input[k];
  }
  if (input.status && input.status !== before.status) {
    if (input.status === 'COMPLETED' && !['BOOKED', 'COMPLETED'].includes(before.status)) {
      throw new AppError(409, 'not_booked', 'Only a booked trip can be marked as completed');
    }
    patch.status = input.status;
    patch.statusChangedAt = new Date();
    if (input.status === 'BOOKED' && !before.bookedAt) patch.bookedAt = new Date();
    if (input.status === 'LOST' || input.status === 'CANCELLED') patch.lostReason = input.lostReason ?? null;
    else patch.lostReason = null;
  } else if (input.lostReason !== undefined && (before.status === 'LOST' || before.status === 'CANCELLED')) {
    patch.lostReason = input.lostReason;
  }
  if (!Object.keys(patch).length) return getTrip(actor.tenantId, id);

  await db.update(trips).set(patch).where(eq(trips.id, id));
  const changed = Object.keys(patch).filter((k) => !['statusChangedAt', 'bookedAt'].includes(k));
  await audit(actor, patch.status ? 'trip.status' : 'trip.update', id, patch.status ? { from: before.status, to: patch.status, reason: patch.lostReason ?? undefined } : { fields: changed });

  const status = patch.status ?? before.status;
  if (status === 'LOST' || status === 'CANCELLED') await syncContactTripFields(actor.tenantId, before.contactId, before);
  else if (status === 'BOOKED' || status === 'COMPLETED') await syncContactTripFields(actor.tenantId, before.contactId, before);
  return getTrip(actor.tenantId, id);
}

export async function deleteTrip(actor: Actor, id: string) {
  const t = await ownedTrip(actor.tenantId, id);
  if (t.payments.length) {
    throw new AppError(409, 'trip_has_payments', 'This trip has payments recorded, so it can’t be deleted. Mark it as cancelled instead.');
  }
  await db.delete(trips).where(eq(trips.id, id));
  await audit(actor, 'trip.delete', id, { number: t.number, title: t.title });
  await syncContactTripFields(actor.tenantId, t.contactId, t);
}

export async function setDues(actor: Actor, id: string, input: z.infer<typeof duesBody>) {
  const t = await ownedTrip(actor.tenantId, id);
  const total = input.dues.reduce((a, d) => a + d.amount, 0);
  await db.transaction(async (tx) => {
    // Instalments that didn't change keep their identity, so reminders already sent for them aren't sent again
    const keyOf = (d: { label: string; amount: number; dueDate: string }) => `${d.label}|${d.amount}|${d.dueDate}`;
    const existing = new Map(t.dues.map((d) => [keyOf(d), d.id]));
    const keep = new Set<string>();
    for (const [i, d] of input.dues.entries()) {
      const id = existing.get(keyOf(d));
      if (id && !keep.has(id)) {
        keep.add(id);
        await tx.update(tripDues).set({ position: i }).where(eq(tripDues.id, id));
      } else {
        await tx.insert(tripDues).values({ tenantId: actor.tenantId, tripId: t.id, label: d.label, amount: d.amount, dueDate: d.dueDate, position: i });
      }
    }
    const gone = t.dues.filter((d) => !keep.has(d.id)).map((d) => d.id);
    if (gone.length) await tx.delete(tripDues).where(inArray(tripDues.id, gone));
    // A schedule with no price yet sets the price
    if (t.price === 0 && total > 0) await tx.update(trips).set({ price: total }).where(eq(trips.id, id));
    await audit(actor, 'trip.schedule', id, { count: input.dues.length, total: formatInr(total) }, tx);
  });
  return getTrip(actor.tenantId, id);
}

export async function recordPayment(actor: Actor, id: string, input: z.infer<typeof paymentBody> & { providerPaymentId?: string }) {
  const t = await ownedTrip(actor.tenantId, id);
  if (t.status === 'LOST') throw new AppError(409, 'trip_lost', 'This enquiry is marked as lost. Reopen it before recording a payment.');
  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
  if (paidAt.getTime() > Date.now() + 86_400_000) {
    throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: { paidAt: 'That date is in the future' } });
  }
  const payment = await withNextNumber(nextReceiptNumber(actor.tenantId), async (receiptNumber) => {
    const [row] = await db
      .insert(tripPayments)
      .values({
        tenantId: actor.tenantId,
        tripId: id,
        receiptNumber,
        amount: input.amount,
        method: input.method,
        reference: input.reference || null,
        note: input.note || null,
        paidAt,
        providerPaymentId: input.providerPaymentId ?? null,
        recordedById: actor.userId,
      })
      .returning();
    return row!;
  });
  await audit(actor, 'trip.payment', id, { receipt: payment.receiptNumber, amount: formatInr(payment.amount), method: payment.method });

  // Money received for an enquiry or quote means it's booked
  if (t.status === 'ENQUIRY' || t.status === 'QUOTED') {
    await db.update(trips).set({ status: 'BOOKED', statusChangedAt: new Date(), bookedAt: t.bookedAt ?? new Date() }).where(eq(trips.id, id));
    await audit(actor, 'trip.status', id, { from: t.status, to: 'BOOKED', reason: 'payment received' });
    await syncContactTripFields(actor.tenantId, t.contactId);
  }
  return { payment, trip: await getTrip(actor.tenantId, id) };
}

export async function voidPayment(actor: Actor, tripId: string, paymentId: string, reason: string) {
  await ownedTrip(actor.tenantId, tripId);
  const [row] = await db
    .update(tripPayments)
    .set({ voidedAt: new Date(), voidReason: reason })
    .where(and(eq(tripPayments.id, paymentId), eq(tripPayments.tripId, tripId), eq(tripPayments.tenantId, actor.tenantId), isNull(tripPayments.voidedAt)))
    .returning();
  if (!row) throw new AppError(404, 'payment_not_found', 'Payment not found, or already cancelled');
  await audit(actor, 'trip.payment_void', tripId, { receipt: row.receiptNumber, amount: formatInr(row.amount), reason });
  return getTrip(actor.tenantId, tripId);
}

/**
 * Maintenance: booked trips whose return date has passed become completed, and the
 * customer's contact keeps the dates so "after the trip" automations fire.
 */
export async function completeFinishedTrips(now = new Date()) {
  const rows = await db
    .select({ id: trips.id, tenantId: trips.tenantId, timezone: tenants.timezone, endDate: trips.endDate, startDate: trips.startDate })
    .from(trips)
    .innerJoin(tenants, eq(tenants.id, trips.tenantId))
    .where(and(eq(trips.status, 'BOOKED'), lt(sql`coalesce(${trips.endDate}, ${trips.startDate})`, sql`${now.toISOString().slice(0, 10)}::date + 1`)));
  let completed = 0;
  for (const r of rows) {
    const last = r.endDate ?? r.startDate;
    if (!last || last >= localDate(r.timezone, now)) continue; // still travelling today, in their time zone
    const [done] = await db
      .update(trips)
      .set({ status: 'COMPLETED', statusChangedAt: now })
      .where(and(eq(trips.id, r.id), eq(trips.status, 'BOOKED')))
      .returning({ id: trips.id });
    if (done) {
      completed++;
      await audit({ tenantId: r.tenantId, userId: null }, 'trip.status', r.id, { from: 'BOOKED', to: 'COMPLETED', reason: 'trip ended' });
    }
  }
  return completed;
}

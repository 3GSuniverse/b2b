import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditLogs, messages, packages, quotes, rateItems, senders, tenants, tripDues, trips, type Quote, type QuoteLine } from '../../db/schema.js';
import { env } from '../../config/env.js';
import { db } from '../../lib/db.js';
import { senderFor } from '../senders/service.js';
import { AppError } from '../../lib/http.js';
import { enqueueEmails } from '../../queues/index.js';
import { addDays, formatInr, localDate, rupeesToPaise, suggestSchedule } from '../trips/money.js';
import { notify } from '../notifications/service.js';
import type { Actor } from '../trips/service.js';
import { customerLink } from '../../lib/links.js';

// ---------------------------------------------------------------------
//  Money
// ---------------------------------------------------------------------

export const lineTotal = (l: Pick<QuoteLine, 'quantity' | 'times' | 'unitPrice'>) => Math.round(l.quantity * l.times * l.unitPrice);
export function quoteTotals(lines: QuoteLine[], discount: number, travellers: number) {
  const subtotal = lines.reduce((a, l) => a + lineTotal(l), 0);
  const total = Math.max(0, subtotal - discount);
  const cost = lines.reduce((a, l) => a + Math.round(l.quantity * l.times * (l.unitCost ?? 0)), 0);
  const costKnown = lines.length > 0 && lines.every((l) => l.unitCost !== undefined && l.unitCost !== null);
  return {
    subtotal,
    discount,
    total,
    perPerson: travellers > 0 ? Math.round(total / travellers) : null,
    margin: costKnown ? total - cost : null, // private: never on the customer's page
  };
}

export function quoteUrl(token: string) {
  return customerLink(`/q/${token}`);
}

// ---------------------------------------------------------------------
//  Price list
// ---------------------------------------------------------------------

const moneyIn = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const p = rupeesToPaise(v);
  if (p === null) {
    ctx.addIssue({ code: 'custom', message: 'Enter an amount like 4,500' });
    return z.NEVER;
  }
  return p;
});

export const rateBody = z.object({
  kind: z.enum(['HOTEL', 'TRANSPORT', 'ACTIVITY', 'TRAVEL', 'OTHER']),
  name: z.string().trim().min(1, 'Name it, e.g. “Houseboat, deluxe room”').max(120),
  destination: z.string().trim().max(80).nullable().optional(),
  unit: z.enum(['PER_NIGHT', 'PER_DAY', 'PER_PERSON', 'PER_GROUP']),
  price: moneyIn,
  cost: z.union([moneyIn, z.literal('').transform(() => null), z.null()]).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export async function listRates(tenantId: string, q: { destination?: string; search?: string }) {
  const where = [eq(rateItems.tenantId, tenantId), isNull(rateItems.archivedAt)];
  if (q.search) {
    const term = `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(rateItems.name, term), ilike(rateItems.destination, term))!);
  }
  const rows = await db.select().from(rateItems).where(and(...where)).orderBy(asc(rateItems.destination), asc(rateItems.kind), asc(rateItems.name));
  // While quoting for a destination, its own rates come first
  if (q.destination) {
    const d = q.destination.trim().toLowerCase();
    rows.sort((a, b) => Number((b.destination ?? '').toLowerCase() === d) - Number((a.destination ?? '').toLowerCase() === d));
  }
  return rows;
}

export async function createRate(tenantId: string, input: z.infer<typeof rateBody>) {
  const [row] = await db
    .insert(rateItems)
    .values({ tenantId, kind: input.kind, name: input.name, destination: input.destination || null, unit: input.unit, price: input.price, cost: input.cost ?? null, notes: input.notes || null })
    .returning();
  return row!;
}

export async function updateRate(tenantId: string, id: string, input: Partial<z.infer<typeof rateBody>>) {
  const [row] = await db
    .update(rateItems)
    .set({ ...input, destination: input.destination === '' ? null : input.destination })
    .where(and(eq(rateItems.id, id), eq(rateItems.tenantId, tenantId)))
    .returning();
  if (!row) throw new AppError(404, 'rate_not_found', 'Price not found');
  return row;
}

/** Archived, not deleted: quotes already made from it keep their own copy of the price anyway. */
export async function archiveRate(tenantId: string, id: string) {
  const [row] = await db.update(rateItems).set({ archivedAt: new Date() }).where(and(eq(rateItems.id, id), eq(rateItems.tenantId, tenantId))).returning();
  if (!row) throw new AppError(404, 'rate_not_found', 'Price not found');
}

// ---------------------------------------------------------------------
//  Quotes
// ---------------------------------------------------------------------

const DEFAULT_INCLUSIONS = ['Accommodation as listed, with breakfast', 'All transfers and sightseeing by private vehicle', 'Driver’s allowance, tolls and parking'];
const DEFAULT_EXCLUSIONS = ['Flights or train tickets unless listed', 'Lunch and dinner unless mentioned', 'Entry tickets and personal expenses', 'Anything not listed under “Included”'];
const DEFAULT_TERMS = 'Prices are subject to availability at the time of booking. A 25% advance confirms the booking; the balance is due 15 days before departure.';

const lineIn = z.object({
  label: z.string().trim().min(1, 'Describe this item').max(200),
  kind: z.enum(['HOTEL', 'TRANSPORT', 'ACTIVITY', 'TRAVEL', 'OTHER']),
  unit: z.enum(['PER_NIGHT', 'PER_DAY', 'PER_PERSON', 'PER_GROUP']),
  quantity: z.coerce.number().min(0).max(1000),
  times: z.coerce.number().int().min(1).max(365),
  unitPrice: z.coerce.number().int().min(0), // paise
  unitCost: z.coerce.number().int().min(0).nullable().optional(),
  rateItemId: z.string().nullable().optional(),
});

export const quoteBody = z.object({
  intro: z.string().trim().max(2000).nullable().optional(),
  days: z.array(z.object({ title: z.string().trim().max(120), description: z.string().trim().max(3000) })).max(60).optional(),
  lines: z.array(lineIn).max(100).optional(),
  inclusions: z.array(z.string().trim().min(1).max(200)).max(40).optional(),
  exclusions: z.array(z.string().trim().min(1).max(200)).max(40).optional(),
  terms: z.string().trim().max(3000).nullable().optional(),
  discount: z.coerce.number().int().min(0).optional(), // paise
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

async function ownedTrip(tenantId: string, tripId: string) {
  const t = await db.query.trips.findFirst({ where: and(eq(trips.id, tripId), eq(trips.tenantId, tenantId)), with: { contact: true } });
  if (!t) throw new AppError(404, 'trip_not_found', 'Trip not found');
  return t;
}

async function ownedQuote(tenantId: string, id: string) {
  const q = await db.query.quotes.findFirst({ where: and(eq(quotes.id, id), eq(quotes.tenantId, tenantId)), with: { trip: { with: { contact: true } } } });
  if (!q) throw new AppError(404, 'quote_not_found', 'Quote not found');
  return q;
}

export function quoteDto(q: Quote, travellers: number) {
  return {
    id: q.id,
    tripId: q.tripId,
    version: q.version,
    status: q.status,
    intro: q.intro,
    days: q.days,
    lines: q.lines.map((l) => ({ ...l, total: lineTotal(l) })),
    inclusions: q.inclusions,
    exclusions: q.exclusions,
    terms: q.terms,
    validUntil: q.validUntil,
    totals: quoteTotals(q.lines, q.discount, travellers),
    url: quoteUrl(q.publicToken),
    sentAt: q.sentAt,
    viewedAt: q.viewedAt,
    respondedAt: q.respondedAt,
    responseNote: q.responseNote,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

export async function listQuotes(tenantId: string, tripId: string) {
  const t = await ownedTrip(tenantId, tripId);
  const rows = await db.select().from(quotes).where(eq(quotes.tripId, tripId)).orderBy(desc(quotes.version));
  return rows.map((q) => quoteDto(q, t.adults + t.children));
}

export async function getQuote(tenantId: string, id: string) {
  const q = await ownedQuote(tenantId, id);
  return quoteDto(q, q.trip.adults + q.trip.children);
}

/** A new version: a copy of the latest one, or a starting point built from the trip. */
export async function createQuote(actor: Actor, tripId: string) {
  const t = await ownedTrip(actor.tenantId, tripId);
  const tenant = (await db.query.tenants.findFirst({ where: eq(tenants.id, actor.tenantId) }))!;
  const latest = await db.query.quotes.findFirst({ where: eq(quotes.tripId, tripId), orderBy: [desc(quotes.version)] });
  const today = localDate(tenant.timezone);
  const nights = t.startDate && t.endDate ? Math.max(0, Math.round((Date.parse(t.endDate) - Date.parse(t.startDate)) / 86_400_000)) : 0;
  const pkg = !latest && t.packageId ? await db.query.packages.findFirst({ where: eq(packages.id, t.packageId) }) : null;
  const base = latest
    ? { intro: latest.intro, days: latest.days, lines: latest.lines, inclusions: latest.inclusions, exclusions: latest.exclusions, terms: latest.terms, discount: latest.discount }
    : pkg
      ? {
          // Sold as a package: its plan and its prices, for this party
          intro: `Thank you for choosing ${tenant.name}. Here is our ${pkg.name} package${pkg.summary ? `: ${pkg.summary}` : '.'}`,
          days: pkg.days.length ? pkg.days : Array.from({ length: pkg.nights + 1 }, () => ({ title: '', description: '' })),
          lines: [
            { label: `${pkg.name}, per adult`, kind: 'OTHER' as const, unit: 'PER_PERSON' as const, quantity: t.adults, times: 1, unitPrice: pkg.pricePerAdult, unitCost: pkg.costPerPerson, rateItemId: null },
            ...(t.children
              ? [{ label: `${pkg.name}, per child`, kind: 'OTHER' as const, unit: 'PER_PERSON' as const, quantity: t.children, times: 1, unitPrice: pkg.pricePerChild ?? pkg.pricePerAdult, unitCost: pkg.costPerPerson, rateItemId: null }]
              : []),
          ] as QuoteLine[],
          inclusions: pkg.inclusions.length ? pkg.inclusions : DEFAULT_INCLUSIONS,
          exclusions: pkg.exclusions.length ? pkg.exclusions : DEFAULT_EXCLUSIONS,
          terms: DEFAULT_TERMS,
          discount: 0,
        }
      : {
        intro: `Thank you for choosing ${tenant.name}. Here is the plan we’ve put together for your ${t.destination ? `${t.destination} ` : ''}trip.`,
        days: Array.from({ length: Math.min(30, nights + 1 || 1) }, (_, i) => ({ title: i === 0 ? 'Arrival' : i === nights ? 'Departure' : '', description: '' })),
        lines: [] as QuoteLine[],
        inclusions: DEFAULT_INCLUSIONS,
        exclusions: DEFAULT_EXCLUSIONS,
          terms: DEFAULT_TERMS,
          discount: 0,
        };
  for (let attempt = 0; ; attempt++) {
    try {
      const [q] = await db
        .insert(quotes)
        .values({ tenantId: actor.tenantId, tripId, version: (latest?.version ?? 0) + 1 + attempt, ...base, total: quoteTotals(base.lines, base.discount, 1).total, validUntil: addDays(today, 7), createdById: actor.userId })
        .returning();
      await db.insert(auditLogs).values({ tenantId: actor.tenantId, userId: actor.userId, action: 'trip.quote', entity: 'trip', entityId: tripId, meta: { version: q!.version, step: 'created' } });
      return quoteDto(q!, t.adults + t.children);
    } catch (err) {
      if (attempt < 3 && (err as { code?: string }).code === '23505') continue;
      throw err;
    }
  }
}

export async function updateQuote(actor: Actor, id: string, input: z.infer<typeof quoteBody>) {
  const q = await ownedQuote(actor.tenantId, id);
  if (q.status !== 'DRAFT') throw new AppError(409, 'quote_sent', 'This quote has been sent, so it can’t change. Make a new version instead.');
  const patch: Partial<typeof quotes.$inferInsert> = {};
  for (const k of ['intro', 'days', 'lines', 'inclusions', 'exclusions', 'terms', 'discount', 'validUntil'] as const) {
    if (input[k] !== undefined) (patch as Record<string, unknown>)[k] = input[k];
  }
  const lines = (patch.lines ?? q.lines) as QuoteLine[];
  patch.total = quoteTotals(lines, patch.discount ?? q.discount, 1).total;
  const [row] = await db.update(quotes).set(patch).where(eq(quotes.id, id)).returning();
  return quoteDto(row!, q.trip.adults + q.trip.children);
}

export async function deleteQuote(actor: Actor, id: string) {
  const q = await ownedQuote(actor.tenantId, id);
  if (q.status !== 'DRAFT') throw new AppError(409, 'quote_sent', 'A sent quote stays on record.');
  await db.delete(quotes).where(eq(quotes.id, id));
}

/**
 * Marks the quote as sent (and the trip as quoted, at this price). By email, it's sent from here;
 * on WhatsApp, the agent sends the link from their own phone (the dashboard opens WhatsApp with it).
 */
export async function sendQuote(actor: Actor, id: string, via: 'EMAIL' | 'MANUAL') {
  const q = await ownedQuote(actor.tenantId, id);
  if (q.status === 'ACCEPTED' || q.status === 'DECLINED') throw new AppError(409, 'quote_answered', 'The customer has already answered this quote.');
  if (!q.lines.length || q.total <= 0) throw new AppError(400, 'quote_empty', 'Add at least one priced item before sending.');
  const trip = q.trip;
  if (via === 'EMAIL') {
    const c = trip.contact;
    if (!c?.email) throw new AppError(400, 'no_email', 'This customer has no email address. Send the link on WhatsApp instead.');
    if (c.emailStatus === 'BOUNCED' || c.emailStatus === 'COMPLAINED') throw new AppError(400, 'email_blocked', 'This customer’s email address doesn’t accept mail. Send the link on WhatsApp instead.');
    const sender =
      await senderFor(actor.tenantId, [actor.userId, trip.assignedToId]);
    if (!sender) throw new AppError(400, 'no_sender', 'Set up a sending address in Settings first, or send the link on WhatsApp.');
    const tenant = (await db.query.tenants.findFirst({ where: eq(tenants.id, actor.tenantId) }))!;
    const [msg] = await db
      .insert(messages)
      .values({
        tenantId: actor.tenantId,
        tripId: trip.id,
        contactId: c.id,
        senderId: sender.id,
        sentById: actor.userId,
        channel: 'EMAIL',
        toAddress: c.email,
        service: true, // they asked for this quote
        subject: `Your quote: ${trip.title}`,
        body: `Hi ${c.firstName ?? trip.customerName.split(' ')[0]},\n\nThank you for your enquiry. Here is your quote for ${trip.title}: ${formatInr(q.total)} in total.\n\nSee the day-by-day plan and accept it here: ${quoteUrl(q.publicToken)}\n\n${tenant.name}`,
      })
      .returning({ id: messages.id });
    await enqueueEmails([msg!.id]);
  }
  const now = new Date();
  await db.update(quotes).set({ status: 'SENT', sentAt: q.sentAt ?? now }).where(eq(quotes.id, id));
  // The trip is quoted, at this price (unless it's already booked)
  if (trip.status === 'ENQUIRY' || trip.status === 'QUOTED') {
    await db.update(trips).set({ status: 'QUOTED', price: q.total, statusChangedAt: trip.status === 'ENQUIRY' ? now : trip.statusChangedAt }).where(eq(trips.id, trip.id));
    if (trip.status === 'ENQUIRY') await db.insert(auditLogs).values({ tenantId: actor.tenantId, userId: actor.userId, action: 'trip.status', entity: 'trip', entityId: trip.id, meta: { from: 'ENQUIRY', to: 'QUOTED', reason: `quote v${q.version} sent` } });
  }
  await db.insert(auditLogs).values({ tenantId: actor.tenantId, userId: actor.userId, action: 'trip.quote', entity: 'trip', entityId: trip.id, meta: { version: q.version, step: 'sent', via, total: formatInr(q.total) } });
  return getQuote(actor.tenantId, id);
}

/** The customer accepted (from their quote page). Sets the price and, if there's no schedule yet, the usual advance and balance. */
export async function acceptQuote(token: string) {
  const q = await db.query.quotes.findFirst({ where: eq(quotes.publicToken, token), with: { trip: true, tenant: true } });
  if (!q || q.status !== 'SENT') return q;
  const now = new Date();
  await db.update(quotes).set({ status: 'ACCEPTED', respondedAt: now }).where(and(eq(quotes.id, q.id), eq(quotes.status, 'SENT')));
  const trip = q.trip;
  if (trip.status === 'ENQUIRY' || trip.status === 'QUOTED') {
    await db.update(trips).set({ price: q.total }).where(eq(trips.id, trip.id));
    const hasDues = await db.query.tripDues.findFirst({ where: eq(tripDues.tripId, trip.id), columns: { id: true } });
    if (!hasDues) {
      const schedule = suggestSchedule(q.total, trip.startDate, localDate(q.tenant.timezone));
      if (schedule.length) await db.insert(tripDues).values(schedule.map((d, i) => ({ tenantId: trip.tenantId, tripId: trip.id, label: d.label, amount: d.amount, dueDate: d.dueDate, position: i })));
    }
  }
  await db.insert(auditLogs).values({ tenantId: trip.tenantId, userId: null, action: 'trip.quote', entity: 'trip', entityId: trip.id, meta: { version: q.version, step: 'accepted', total: formatInr(q.total) } });
  await notify(trip.tenantId, {
    userId: trip.assignedToId ?? trip.createdById,
    type: 'quotes.accepted',
    level: 'SUCCESS',
    title: `${trip.customerName} accepted the quote for ${trip.title}`,
    body: `${formatInr(q.total)}. They can pay the advance from their trip page; record it when it arrives, and the trip is booked.`,
    link: `/trips/${trip.id}`,
    dedupeKey: `quote.accepted:${q.id}`,
  });
  return q;
}

export async function declineQuote(token: string, note: string) {
  const q = await db.query.quotes.findFirst({ where: eq(quotes.publicToken, token), with: { trip: true } });
  if (!q || q.status !== 'SENT') return q;
  await db.update(quotes).set({ status: 'DECLINED', respondedAt: new Date(), responseNote: note || null }).where(eq(quotes.id, q.id));
  await db.insert(auditLogs).values({ tenantId: q.tenantId, userId: null, action: 'trip.quote', entity: 'trip', entityId: q.tripId, meta: { version: q.version, step: 'declined', note: note || undefined } });
  await notify(q.tenantId, {
    userId: q.trip.assignedToId ?? q.trip.createdById,
    type: 'quotes.declined',
    level: 'WARNING',
    title: `${q.trip.customerName} asked for changes to the quote for ${q.trip.title}`,
    body: note || 'They didn’t say why. A quick call usually helps.',
    link: `/trips/${q.tripId}`,
    dedupeKey: `quote.declined:${q.id}`,
  });
  return q;
}

export async function markViewed(id: string) {
  await db.update(quotes).set({ viewedAt: sql`coalesce(${quotes.viewedAt}, now())` }).where(eq(quotes.id, id));
}


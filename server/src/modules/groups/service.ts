import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditLogs, messages, senders, suppressions, tenants, tripTravellers, trips, type Trip } from '../../db/schema.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { enqueueEmails, enqueueWhatsApp } from '../../queues/index.js';
import { normalizePhone } from '../contacts/normalize.js';
import { whatsappWebAllowed } from '../plans/entitlements.js';
import { addDays, localDate, rupeesToPaise, tripMoney, type DueInput } from '../trips/money.js';
import { ownedPackage } from '../packages/service.js';
import { createTrip, createTripBody, type Actor } from '../trips/service.js';
import { getSession } from '../whatsapp/service.js';

/**
 * Group departures (yatras, group tours). The group is a trip of kind GROUP with seats and a
 * price per person. Each family's booking is an ordinary trip pointing at it, so payments,
 * reminders, the customer's page and receipts all work exactly as for any trip.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-05-10');
const money = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const p = rupeesToPaise(v);
  if (p === null) {
    ctx.addIssue({ code: 'custom', message: 'Enter an amount like 45,000' });
    return z.NEVER;
  }
  return p;
});

export const groupBody = z.object({
  title: z.string().trim().min(1, 'Name the departure, e.g. “Char Dham Yatra, May 2027”').max(120),
  destination: z.string().trim().max(120).nullable().optional(),
  startDate: isoDate.nullable().optional(),
  endDate: isoDate.nullable().optional(),
  capacity: z.coerce.number().int().min(1, 'At least 1 seat').max(2000).nullable().optional(),
  perPersonPrice: z.union([money, z.literal('').transform(() => null), z.null()]).optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  packageId: z.string().nullable().optional(),
});

async function ownedGroup(tenantId: string, id: string) {
  const g = await db.query.trips.findFirst({ where: and(eq(trips.id, id), eq(trips.tenantId, tenantId), eq(trips.kind, 'GROUP')) });
  if (!g) throw new AppError(404, 'group_not_found', 'Group departure not found');
  return g;
}

const seatsOf = (t: Pick<Trip, 'adults' | 'children'>) => t.adults + t.children;
const ACTIVE = ['ENQUIRY', 'QUOTED', 'BOOKED', 'COMPLETED'] as const;

export async function createGroup(actor: Actor, input: z.infer<typeof groupBody>) {
  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: { endDate: 'The return date is before the start date' } });
  }
  // A departure of a package: its destination, length and price per person fill in what wasn't given
  const pkg = input.packageId ? await ownedPackage(actor.tenantId, input.packageId) : null;
  if (pkg) {
    input.destination ??= pkg.destination;
    if (input.startDate && !input.endDate) input.endDate = addDays(input.startDate, pkg.nights);
    if (input.perPersonPrice === undefined || input.perPersonPrice === null) input.perPersonPrice = pkg.pricePerAdult;
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`coalesce(max(${trips.number}), 0)::int` }).from(trips).where(eq(trips.tenantId, actor.tenantId));
      const [g] = await db
        .insert(trips)
        .values({
          tenantId: actor.tenantId,
          number: n + 1,
          kind: 'GROUP',
          status: 'BOOKED', // the departure is running; families inside it have their own status
          customerName: 'Group',
          title: input.title,
          destination: input.destination ?? null,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          adults: 0,
          capacity: input.capacity ?? null,
          perPersonPrice: input.perPersonPrice ?? null,
          notes: input.notes ?? null,
          packageId: pkg?.id ?? null,
          createdById: actor.userId,
          assignedToId: actor.userId,
          statusChangedAt: new Date(),
        })
        .returning();
      await db.insert(auditLogs).values({ tenantId: actor.tenantId, userId: actor.userId, action: 'group.create', entity: 'trip', entityId: g!.id, meta: { title: g!.title } });
      return g!;
    } catch (err) {
      if (attempt < 4 && (err as { code?: string }).code === '23505') continue;
      throw err;
    }
  }
}

export async function updateGroup(actor: Actor, id: string, input: Partial<z.infer<typeof groupBody>> & { status?: 'BOOKED' | 'CANCELLED' | 'COMPLETED' }) {
  const g = await ownedGroup(actor.tenantId, id);
  const patch: Partial<typeof trips.$inferInsert> = {};
  for (const k of ['title', 'destination', 'startDate', 'endDate', 'capacity', 'perPersonPrice', 'notes', 'packageId'] as const) if (input[k] !== undefined) (patch as Record<string, unknown>)[k] = input[k];
  if (input.packageId) await ownedPackage(actor.tenantId, input.packageId);
  if (input.status && input.status !== g.status) Object.assign(patch, { status: input.status, statusChangedAt: new Date() });
  if (Object.keys(patch).length) await db.update(trips).set(patch).where(eq(trips.id, id));
  // Dates and destination move with the departure for every family in it
  const shared: Partial<typeof trips.$inferInsert> = {};
  for (const k of ['destination', 'startDate', 'endDate'] as const) if (input[k] !== undefined) (shared as Record<string, unknown>)[k] = input[k];
  if (Object.keys(shared).length) await db.update(trips).set(shared).where(and(eq(trips.groupId, id), inArray(trips.status, ['ENQUIRY', 'QUOTED', 'BOOKED'])));
  await db.insert(auditLogs).values({ tenantId: actor.tenantId, userId: actor.userId, action: 'group.update', entity: 'trip', entityId: id, meta: { fields: Object.keys(patch) } });
  return getGroup(actor.tenantId, id);
}

export async function listGroups(tenantId: string) {
  const today = localDate((await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId), columns: { timezone: true } }))!.timezone);
  const groups = await db.query.trips.findMany({ where: and(eq(trips.tenantId, tenantId), eq(trips.kind, 'GROUP')), orderBy: [desc(trips.startDate)] });
  if (!groups.length) return [];
  const bookings = await db.query.trips.findMany({ where: and(eq(trips.tenantId, tenantId), inArray(trips.groupId, groups.map((g) => g.id))), with: { dues: true, payments: true } });
  return groups.map((g) => {
    const mine = bookings.filter((b) => b.groupId === g.id && (ACTIVE as readonly string[]).includes(b.status));
    const money = mine.map((b) => tripMoney({ price: b.price, dues: b.dues as DueInput[], payments: b.payments }, today));
    return {
      id: g.id,
      number: g.number,
      status: g.status,
      title: g.title,
      destination: g.destination,
      startDate: g.startDate,
      endDate: g.endDate,
      capacity: g.capacity,
      perPersonPrice: g.perPersonPrice,
      packageId: g.packageId,
      seatsTaken: mine.reduce((a, b) => a + seatsOf(b), 0),
      families: mine.length,
      expected: mine.reduce((a, b) => a + b.price, 0),
      collected: money.reduce((a, m) => a + m.paid, 0),
      overdue: money.reduce((a, m) => a + m.overdue, 0),
    };
  });
}

function travellerDto(t: typeof tripTravellers.$inferSelect) {
  return {
    id: t.id,
    tripId: t.tripId,
    position: t.position,
    name: t.name,
    age: t.age,
    gender: t.gender,
    phone: t.phone,
    idType: t.idType,
    idLast4: t.idLast4,
    food: t.food,
    needs: t.needs,
    emergencyName: t.emergencyName,
    emergencyPhone: t.emergencyPhone,
    room: t.room,
    seat: t.seat,
  };
}

export async function getGroup(tenantId: string, id: string) {
  const g = await ownedGroup(tenantId, id);
  const summary = (await listGroups(tenantId)).find((x) => x.id === id)!;
  const today = localDate((await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId), columns: { timezone: true } }))!.timezone);
  const bookings = await db.query.trips.findMany({
    where: and(eq(trips.tenantId, tenantId), eq(trips.groupId, id)),
    with: { dues: true, payments: true, contact: true, travellers: { orderBy: [asc(tripTravellers.position)] } },
    orderBy: [asc(trips.createdAt)],
  });
  return {
    ...summary,
    notes: g.notes,
    bookings: bookings.map((b) => {
      const m = tripMoney({ price: b.price, dues: b.dues as DueInput[], payments: b.payments }, today);
      return {
        id: b.id,
        number: b.number,
        status: b.status,
        customer: { name: b.customerName, phone: b.contact?.phone ?? null, email: b.contact?.email ?? null },
        seats: seatsOf(b),
        adults: b.adults,
        children: b.children,
        price: b.price,
        paid: m.paid,
        balance: m.balance,
        overdue: m.overdue,
        nextDue: m.nextDue && { amount: m.nextDue.remaining, dueDate: m.nextDue.dueDate, state: m.nextDue.state },
        travellers: b.travellers.map(travellerDto),
        detailsMissing: Math.max(0, seatsOf(b) - b.travellers.length),
      };
    }),
  };
}

/** A family joins: an ordinary trip inside the group, priced per person. */
export const groupBookingBody = z.object({
  customer: createTripBody.shape.customer,
  adults: z.coerce.number().int().min(1, 'At least 1 adult').max(200),
  children: z.coerce.number().int().min(0).max(200).default(0),
  notes: z.string().trim().max(5000).nullable().optional(),
  status: z.enum(['ENQUIRY', 'BOOKED']).default('BOOKED'),
});

export async function addBooking(actor: Actor, groupId: string, input: z.infer<typeof groupBookingBody>) {
  const g = await ownedGroup(actor.tenantId, groupId);
  if (g.status === 'CANCELLED') throw new AppError(409, 'group_cancelled', 'This departure is cancelled.');
  const taken = (await listGroups(actor.tenantId)).find((x) => x.id === groupId)!.seatsTaken;
  const seats = input.adults + input.children;
  if (g.capacity && taken + seats > g.capacity) {
    throw new AppError(409, 'group_full', `Only ${Math.max(0, g.capacity - taken)} seat${g.capacity - taken === 1 ? '' : 's'} left on this departure.`);
  }
  const trip = await createTrip(actor, {
    customer: input.customer,
    title: g.title,
    destination: g.destination,
    startDate: g.startDate,
    endDate: g.endDate,
    adults: input.adults,
    children: input.children,
    price: g.perPersonPrice ? g.perPersonPrice * seats : null,
    notes: input.notes ?? null,
    status: input.status,
    packageId: g.packageId,
  });
  await db.update(trips).set({ groupId }).where(eq(trips.id, trip.id));
  await db.insert(auditLogs).values({ tenantId: actor.tenantId, userId: actor.userId, action: 'group.booking', entity: 'trip', entityId: groupId, meta: { bookingId: trip.id, customer: trip.customer.name, seats } });
  return trip;
}

// ---------------------------------------------------------------------
//  Travellers
// ---------------------------------------------------------------------

export const ID_TYPES = ['AADHAAR', 'PASSPORT', 'VOTER_ID', 'DRIVING_LICENCE', 'PAN', 'OTHER'] as const;
const opt = (max: number) => z.string().trim().max(max).nullable().optional();
export const travellerIn = z.object({
  id: z.string().optional(), // existing traveller: update
  name: z.string().trim().min(1, 'Enter the name as on the ID').max(120),
  age: z.coerce.number().int().min(0).max(120).nullable().optional(),
  gender: z.enum(['F', 'M', 'O']).nullable().optional(),
  phone: opt(30),
  idType: z.enum(ID_TYPES).nullable().optional(),
  idNumber: opt(40), // empty keeps the one on file
  food: z.enum(['VEG', 'NON_VEG', 'JAIN', 'OTHER']).nullable().optional(),
  needs: opt(500),
  emergencyName: opt(120),
  emergencyPhone: opt(30),
  room: opt(40),
  seat: opt(40),
});

/** Replaces the traveller list of a booking (agent or customer). ID numbers are encrypted; only the last 4 are kept readable. */
export async function saveTravellers(tenantId: string, tripId: string, list: z.infer<typeof travellerIn>[], opts: { byCustomer?: boolean } = {}) {
  const trip = await db.query.trips.findFirst({ where: and(eq(trips.id, tripId), eq(trips.tenantId, tenantId)), with: { travellers: true } });
  if (!trip) throw new AppError(404, 'trip_not_found', 'Trip not found');
  if (list.length > Math.max(seatsOf(trip), 1) + (opts.byCustomer ? 0 : 50)) {
    throw new AppError(400, 'too_many', `This booking is for ${seatsOf(trip)} people.`);
  }
  const errors: Record<string, string> = {};
  const rows = list.map((t, i) => {
    const phone = t.phone ? normalizePhone(t.phone) : null;
    if (t.phone && !phone) errors[`${i}.phone`] = 'Enter a valid phone number';
    const ePhone = t.emergencyPhone ? normalizePhone(t.emergencyPhone) : null;
    if (t.emergencyPhone && !ePhone) errors[`${i}.emergencyPhone`] = 'Enter a valid phone number';
    const idNumber = t.idNumber?.replace(/\s+/g, '') || null;
    if (idNumber && t.idType === 'AADHAAR' && !/^\d{12}$/.test(idNumber)) errors[`${i}.idNumber`] = 'Aadhaar numbers have 12 digits';
    if (idNumber && t.idType === 'PAN' && !/^[A-Z]{5}\d{4}[A-Z]$/i.test(idNumber)) errors[`${i}.idNumber`] = 'Like ABCDE1234F';
    const existing = t.id ? trip.travellers.find((x) => x.id === t.id) : undefined;
    return {
      id: existing?.id,
      tenantId,
      tripId,
      position: i,
      name: t.name,
      age: t.age ?? null,
      gender: t.gender ?? null,
      phone,
      idType: t.idType ?? null,
      idNumberEnc: idNumber ? encryptSecret(idNumber.toUpperCase()) : (existing?.idNumberEnc ?? null),
      idLast4: idNumber ? idNumber.slice(-4).toUpperCase() : (existing?.idLast4 ?? null),
      food: t.food ?? null,
      needs: t.needs || null,
      emergencyName: t.emergencyName || null,
      emergencyPhone: ePhone,
      // Customers can't move themselves between rooms or seats
      room: opts.byCustomer ? (existing?.room ?? null) : (t.room || null),
      seat: opts.byCustomer ? (existing?.seat ?? null) : (t.seat || null),
    };
  });
  if (Object.keys(errors).length) throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: errors });
  await db.transaction(async (tx) => {
    const keep = rows.filter((r) => r.id).map((r) => r.id!);
    const gone = trip.travellers.filter((t) => !keep.includes(t.id)).map((t) => t.id);
    if (gone.length) await tx.delete(tripTravellers).where(inArray(tripTravellers.id, gone));
    for (const r of rows) {
      if (r.id) await tx.update(tripTravellers).set(r).where(eq(tripTravellers.id, r.id));
      else {
        const { id: _drop, ...insert } = r;
        await tx.insert(tripTravellers).values(insert);
      }
    }
  });
  await db.insert(auditLogs).values({ tenantId, userId: null, action: 'trip.travellers', entity: 'trip', entityId: tripId, meta: { count: rows.length, by: opts.byCustomer ? 'customer' : 'agent' } });
  return listTravellers(tenantId, tripId);
}

export async function listTravellers(tenantId: string, tripId: string) {
  const rows = await db.select().from(tripTravellers).where(and(eq(tripTravellers.tenantId, tenantId), eq(tripTravellers.tripId, tripId))).orderBy(asc(tripTravellers.position));
  return rows.map(travellerDto);
}

/** For printing the passenger list: the full ID number. Admins only, and every view is logged. */
export async function revealIds(tenantId: string, userId: string, groupOrTripId: string) {
  const ids = (await db.select({ id: trips.id }).from(trips).where(and(eq(trips.tenantId, tenantId), sql`(${trips.id} = ${groupOrTripId} or ${trips.groupId} = ${groupOrTripId})`))).map((r) => r.id);
  const rows = ids.length ? await db.select().from(tripTravellers).where(inArray(tripTravellers.tripId, ids)).orderBy(asc(tripTravellers.tripId), asc(tripTravellers.position)) : [];
  await db.insert(auditLogs).values({ tenantId, userId, action: 'trip.ids_viewed', entity: 'trip', entityId: groupOrTripId, meta: { count: rows.length } });
  return rows.map((r) => ({ id: r.id, idNumber: r.idNumberEnc ? decryptSecret(r.idNumberEnc) : null }));
}

/** Rooms two to a room within each family (a family of 3 shares one), seats in booking order. Only fills in blanks. */
export async function autoAssign(actor: Actor, groupId: string) {
  await ownedGroup(actor.tenantId, groupId);
  const bookings = await db.query.trips.findMany({
    where: and(eq(trips.groupId, groupId), inArray(trips.status, ['ENQUIRY', 'QUOTED', 'BOOKED'])),
    with: { travellers: { orderBy: [asc(tripTravellers.position)] } },
    orderBy: [asc(trips.createdAt)],
  });
  const all = bookings.flatMap((b) => b.travellers);
  const usedRooms = new Set(all.map((t) => t.room).filter(Boolean));
  const usedSeats = new Set(all.map((t) => t.seat).filter(Boolean));
  let room = 0;
  let seat = 0;
  const nextRoom = () => {
    do room++;
    while (usedRooms.has(`Room ${room}`));
    return `Room ${room}`;
  };
  const nextSeat = () => {
    do seat++;
    while (usedSeats.has(`Seat ${seat}`));
    return `Seat ${seat}`;
  };
  let changed = 0;
  for (const b of bookings) {
    const needRoom = b.travellers.filter((t) => !t.room);
    // Two to a room; when three are left, they share one (nobody from a family rooms alone)
    for (let i = 0; i < needRoom.length; ) {
      const left = needRoom.length - i;
      const size = left === 3 ? 3 : Math.min(2, left);
      const r = nextRoom();
      for (const t of needRoom.slice(i, i + size)) {
        await db.update(tripTravellers).set({ room: r }).where(eq(tripTravellers.id, t.id));
        changed++;
      }
      i += size;
    }
    for (const t of b.travellers.filter((x) => !x.seat)) {
      await db.update(tripTravellers).set({ seat: nextSeat() }).where(eq(tripTravellers.id, t.id));
      changed++;
    }
  }
  await db.insert(auditLogs).values({ tenantId: actor.tenantId, userId: actor.userId, action: 'group.assign', entity: 'trip', entityId: groupId, meta: { changed } });
  return getGroup(actor.tenantId, groupId);
}

// ---------------------------------------------------------------------
//  One message to everyone
// ---------------------------------------------------------------------

export const broadcastBody = z.object({
  text: z.string().trim().min(5, 'Write the message').max(1500),
  channel: z.enum(['AUTO', 'WHATSAPP', 'EMAIL']).default('AUTO'),
});

/** "Bus leaves 5:30 AM from…": to the person who booked, for each family. A service message about their trip. */
export async function broadcast(actor: Actor, groupId: string, input: z.infer<typeof broadcastBody>, enqueue = { email: enqueueEmails, whatsapp: enqueueWhatsApp }) {
  const g = await ownedGroup(actor.tenantId, groupId);
  const tenant = (await db.query.tenants.findFirst({ where: eq(tenants.id, actor.tenantId) }))!;
  const bookings = await db.query.trips.findMany({ where: and(eq(trips.groupId, groupId), inArray(trips.status, ['QUOTED', 'BOOKED'])), with: { contact: true } });
  const whatsappUp = whatsappWebAllowed(tenant) && (await getSession(tenant.id)).status === 'CONNECTED';
  const sender =
    (await db.query.senders.findFirst({ where: and(eq(senders.tenantId, tenant.id), eq(senders.isDefault, true)) })) ??
    (await db.query.senders.findFirst({ where: eq(senders.tenantId, tenant.id), orderBy: [asc(senders.createdAt)] }));
  const sent = { whatsapp: [] as string[], email: [] as string[] };
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const b of bookings) {
    const c = b.contact;
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    const blocked = await db.select({ channel: suppressions.channel, reason: suppressions.reason }).from(suppressions).where(and(eq(suppressions.tenantId, tenant.id), inArray(suppressions.address, [c.phone ?? '', c.email ?? ''].filter(Boolean))));
    const wa = whatsappUp && c.phone && !blocked.some((x) => x.channel === 'WHATSAPP');
    const em = sender && c.email && c.emailStatus !== 'BOUNCED' && c.emailStatus !== 'COMPLAINED' && !blocked.some((x) => x.channel === 'EMAIL' && x.reason !== 'UNSUBSCRIBE');
    const channel = input.channel === 'WHATSAPP' ? (wa ? 'WHATSAPP' : null) : input.channel === 'EMAIL' ? (em ? 'EMAIL' : null) : wa ? 'WHATSAPP' : em ? 'EMAIL' : null;
    if (!channel) {
      skipped.push(b.customerName);
      continue;
    }
    const [m] = await db
      .insert(messages)
      .values({
        tenantId: tenant.id,
        tripId: b.id,
        contactId: c.id,
        senderId: channel === 'EMAIL' ? sender!.id : null,
        channel,
        toAddress: channel === 'EMAIL' ? c.email!.toLowerCase() : c.phone!,
        subject: channel === 'EMAIL' ? `${g.title}: an update` : null,
        body: input.text,
        service: true,
      })
      .returning({ id: messages.id });
    (channel === 'EMAIL' ? sent.email : sent.whatsapp).push(m!.id);
  }
  if (sent.email.length) await enqueue.email(sent.email);
  if (sent.whatsapp.length) await enqueue.whatsapp(sent.whatsapp);
  await db.insert(auditLogs).values({ tenantId: tenant.id, userId: actor.userId, action: 'group.broadcast', entity: 'trip', entityId: groupId, meta: { whatsapp: sent.whatsapp.length, email: sent.email.length, skipped: skipped.length, text: input.text.slice(0, 120) } });
  return { whatsapp: sent.whatsapp.length, email: sent.email.length, skipped };
}

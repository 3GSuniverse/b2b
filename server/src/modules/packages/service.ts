import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditLogs, packages, tenants, trips, type Package } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError, parseBody } from '../../lib/http.js';
import { requireAuth, requireRole, tenantOf } from '../auth/guard.js';
import { localDate, rupeesToPaise, tripMoney, type DueInput } from '../trips/money.js';

/** What a party pays for a package: adults at the adult price, children at the child price (or the adult one). */
export const packagePrice = (p: Pick<Package, 'pricePerAdult' | 'pricePerChild'>, adults: number, children: number) =>
  adults * p.pricePerAdult + children * (p.pricePerChild ?? p.pricePerAdult);

export async function ownedPackage(tenantId: string, id: string) {
  const p = await db.query.packages.findFirst({ where: and(eq(packages.id, id), eq(packages.tenantId, tenantId)) });
  if (!p) throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: { packageId: 'Choose one of your packages' } });
  return p;
}

const money = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const p = rupeesToPaise(v);
  if (p === null) {
    ctx.addIssue({ code: 'custom', message: 'Enter an amount like 24,500' });
    return z.NEVER;
  }
  return p;
});
const optionalMoney = z.union([money, z.literal('').transform(() => null), z.null()]).optional();

export const packageBody = z.object({
  name: z.string().trim().min(1, 'Name the package, e.g. “Kerala 4N/5D”').max(120),
  destination: z.string().trim().max(120).nullable().optional(),
  nights: z.coerce.number().int().min(0).max(60).default(0),
  summary: z.string().trim().max(500).nullable().optional(),
  pricePerAdult: money,
  pricePerChild: optionalMoney,
  costPerPerson: optionalMoney,
  days: z.array(z.object({ title: z.string().trim().max(120), description: z.string().trim().max(3000) })).max(60).optional(),
  inclusions: z.array(z.string().trim().min(1).max(200)).max(40).optional(),
  exclusions: z.array(z.string().trim().min(1).max(200)).max(40).optional(),
});

const SOLD = ['BOOKED', 'COMPLETED'] as const;
const OPEN = ['ENQUIRY', 'QUOTED'] as const;

function packageDto(p: Package) {
  return {
    id: p.id,
    name: p.name,
    destination: p.destination,
    nights: p.nights,
    summary: p.summary,
    pricePerAdult: p.pricePerAdult,
    pricePerChild: p.pricePerChild,
    costPerPerson: p.costPerPerson,
    marginPerPerson: p.costPerPerson !== null ? p.pricePerAdult - p.costPerPerson : null,
    days: p.days,
    inclusions: p.inclusions,
    exclusions: p.exclusions,
    archived: !!p.archivedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** Who took a package: how many bookings and travellers, what they're worth, what's been received. */
function statsFor(rows: { status: string; adults: number; children: number; price: number; paid: number }[], costPerPerson: number | null) {
  const sold = rows.filter((r) => (SOLD as readonly string[]).includes(r.status));
  const travellers = sold.reduce((a, r) => a + r.adults + r.children, 0);
  const value = sold.reduce((a, r) => a + r.price, 0);
  return {
    bookings: sold.length,
    enquiries: rows.filter((r) => (OPEN as readonly string[]).includes(r.status)).length,
    travellers,
    value,
    received: sold.reduce((a, r) => a + r.paid, 0),
    cost: costPerPerson !== null ? costPerPerson * travellers : null,
    margin: costPerPerson !== null ? value - costPerPerson * travellers : null,
  };
}

async function tripRows(tenantId: string, packageIds: string[]) {
  if (!packageIds.length) return [];
  const tz = (await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId), columns: { timezone: true } }))!.timezone;
  const today = localDate(tz);
  const rows = await db.query.trips.findMany({
    where: and(eq(trips.tenantId, tenantId), eq(trips.kind, 'PRIVATE'), inArray(trips.packageId, packageIds)),
    with: { dues: true, payments: true, contact: { columns: { phone: true } } },
    orderBy: [desc(trips.startDate), desc(trips.createdAt)],
  });
  return rows.map((t) => {
    const m = tripMoney({ price: t.price, dues: t.dues as DueInput[], payments: t.payments }, today);
    return {
      id: t.id,
      number: t.number,
      packageId: t.packageId!,
      status: t.status,
      customer: t.customerName,
      phone: t.contact?.phone ?? null,
      startDate: t.startDate,
      endDate: t.endDate,
      adults: t.adults,
      children: t.children,
      price: t.price,
      paid: m.paid,
      balance: m.balance,
      overdue: m.overdue,
      groupId: t.groupId,
    };
  });
}

export async function listPackages(tenantId: string, opts: { archived?: boolean } = {}) {
  const rows = await db
    .select()
    .from(packages)
    .where(and(eq(packages.tenantId, tenantId), opts.archived ? undefined : isNull(packages.archivedAt)))
    .orderBy(asc(packages.destination), asc(packages.name));
  const all = await tripRows(tenantId, rows.map((p) => p.id));
  return rows.map((p) => ({ ...packageDto(p), stats: statsFor(all.filter((t) => t.packageId === p.id), p.costPerPerson) }));
}

export async function getPackage(tenantId: string, id: string) {
  const p = await db.query.packages.findFirst({ where: and(eq(packages.id, id), eq(packages.tenantId, tenantId)) });
  if (!p) throw new AppError(404, 'package_not_found', 'Package not found');
  const rows = await tripRows(tenantId, [id]);
  return { ...packageDto(p), stats: statsFor(rows, p.costPerPerson), trips: rows };
}

export async function packageRoutes(app: FastifyInstance) {
  app.get('/api/packages', { preHandler: requireAuth }, async (req) => ({
    packages: await listPackages(tenantOf(req), { archived: (req.query as { archived?: string }).archived === '1' }),
  }));
  app.post('/api/packages', { preHandler: requireAuth }, async (req, reply) => {
    const b = parseBody(packageBody, req.body);
    const [row] = await db
      .insert(packages)
      .values({ tenantId: tenantOf(req), ...b, destination: b.destination || null, summary: b.summary || null, pricePerChild: b.pricePerChild ?? null, costPerPerson: b.costPerPerson ?? null })
      .returning();
    await db.insert(auditLogs).values({ tenantId: tenantOf(req), userId: req.auth!.userId, action: 'package.create', entity: 'package', entityId: row!.id, meta: { name: row!.name } });
    return reply.code(201).send({ package: await getPackage(tenantOf(req), row!.id) });
  });
  app.get<{ Params: { id: string } }>('/api/packages/:id', { preHandler: requireAuth }, async (req) => ({ package: await getPackage(tenantOf(req), req.params.id) }));
  app.patch<{ Params: { id: string } }>('/api/packages/:id', { preHandler: requireAuth }, async (req) => {
    const b = parseBody(packageBody.partial().extend({ archived: z.boolean().optional() }), req.body);
    const { archived, ...rest } = b;
    const patch: Partial<typeof packages.$inferInsert> = { ...rest };
    if (archived !== undefined) patch.archivedAt = archived ? new Date() : null;
    const [row] = await db.update(packages).set(patch).where(and(eq(packages.id, req.params.id), eq(packages.tenantId, tenantOf(req)))).returning();
    if (!row) throw new AppError(404, 'package_not_found', 'Package not found');
    return { package: await getPackage(tenantOf(req), row.id) };
  });
  // Not deleted: trips sold as this package keep pointing at it. Archived packages just stop being offered.
  app.delete<{ Params: { id: string } }>('/api/packages/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const [row] = await db.update(packages).set({ archivedAt: new Date() }).where(and(eq(packages.id, req.params.id), eq(packages.tenantId, tenantOf(req)))).returning();
    if (!row) throw new AppError(404, 'package_not_found', 'Package not found');
    return reply.code(204).send();
  });
}

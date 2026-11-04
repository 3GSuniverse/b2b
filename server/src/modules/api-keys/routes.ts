import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { apiKeys, auditLogs, tenants, trips } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError, parseBody } from '../../lib/http.js';
import { requireRole, tenantOf } from '../auth/guard.js';
import { notify } from '../notifications/service.js';
import { createTrip, TRIP_SOURCES } from '../trips/service.js';

/**
 * Keys for other systems — the AI call agent, a website enquiry form — to add enquiries.
 *   Authorization: Bearer dr_live_…
 * The full key is shown once, when it's made. Only its sha256 is stored.
 */

const hash = (key: string) => createHash('sha256').update(key).digest('hex');
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newKey() {
  const bytes = randomBytes(32);
  return `dr_live_${Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')}`;
}

/** preHandler for /api/v1: a valid, unrevoked key of an active company. */
async function requireApiKey(req: FastifyRequest) {
  const header = String(req.headers.authorization ?? '');
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  // hy_live_: keys made before the rename to Drona keep working
  if (!key.startsWith('dr_live_') && !key.startsWith('hy_live_')) throw new AppError(401, 'missing_api_key', 'Send your API key as: Authorization: Bearer dr_live_…');
  const row = await db.query.apiKeys.findFirst({ where: and(eq(apiKeys.keyHash, hash(key)), isNull(apiKeys.revokedAt)) });
  if (!row) throw new AppError(401, 'invalid_api_key', 'This API key isn’t valid, or it was revoked');
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, row.tenantId) });
  if (!tenant || tenant.status !== 'ACTIVE') throw new AppError(403, 'company_paused', 'This company’s account is paused');
  // At most one write a minute per key for "last used", not one per request
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  }
  (req as FastifyRequest & { apiKey?: typeof row }).apiKey = row;
}
const keyOf = (req: FastifyRequest) => (req as FastifyRequest & { apiKey: typeof apiKeys.$inferSelect }).apiKey;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const leadBody = z
  .object({
    name: z.string().trim().min(1, 'name is required').max(120),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().max(254).optional(),
    destination: z.string().trim().max(120).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    adults: z.coerce.number().int().min(0).max(500).optional(),
    children: z.coerce.number().int().min(0).max(500).optional(),
    budget: z.union([z.number().nonnegative(), z.string().regex(/^[\d,]+(\.\d{1,2})?$/)]).optional(), // rupees
    notes: z.string().trim().max(5000).optional(), // e.g. the call summary
    source: z.enum(TRIP_SOURCES).default('CALL_AGENT'),
    whatsappOptIn: z.boolean().default(false), // only if the caller agreed, on the call
    externalId: z.string().trim().min(1).max(200).optional(), // your call or form id: sending it again won't add a second enquiry
  })
  .refine((v) => v.phone || v.email, { message: 'Send a phone or an email', path: ['phone'] });

export async function apiKeyRoutes(app: FastifyInstance) {
  // ---- Managing keys (dashboard, admins)
  app.get('/api/api-keys', { preHandler: requireRole('ADMIN') }, async (req) => ({
    keys: await db
      .select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, lastUsedAt: apiKeys.lastUsedAt, createdAt: apiKeys.createdAt })
      .from(apiKeys)
      .where(and(eq(apiKeys.tenantId, tenantOf(req)), isNull(apiKeys.revokedAt)))
      .orderBy(desc(apiKeys.createdAt)),
  }));

  app.post('/api/api-keys', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const { name } = parseBody(z.object({ name: z.string().trim().min(1, 'Name the key, e.g. “AI call agent”').max(60) }), req.body);
    const tenantId = tenantOf(req);
    const active = await db.select({ id: apiKeys.id }).from(apiKeys).where(and(eq(apiKeys.tenantId, tenantId), isNull(apiKeys.revokedAt)));
    if (active.length >= 10) throw new AppError(409, 'too_many_keys', 'You have 10 keys. Revoke one you don’t use first.');
    const key = newKey();
    const [row] = await db.insert(apiKeys).values({ tenantId, name, prefix: key.slice(0, 14), keyHash: hash(key), createdById: req.auth!.userId }).returning();
    await db.insert(auditLogs).values({ tenantId, userId: req.auth!.userId, action: 'api_key.create', entity: 'api_key', entityId: row!.id, meta: { name } });
    return reply.code(201).send({ key, apiKey: { id: row!.id, name: row!.name, prefix: row!.prefix, lastUsedAt: null, createdAt: row!.createdAt } });
  });

  app.delete<{ Params: { id: string } }>('/api/api-keys/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const tenantId = tenantOf(req);
    const [row] = await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, req.params.id), eq(apiKeys.tenantId, tenantId), isNull(apiKeys.revokedAt)))
      .returning();
    if (!row) throw new AppError(404, 'not_found', 'Key not found');
    await db.insert(auditLogs).values({ tenantId, userId: req.auth!.userId, action: 'api_key.revoke', entity: 'api_key', entityId: row.id, meta: { name: row.name } });
    return reply.code(204).send();
  });

  // ---- The public API
  app.get('/api/v1/ping', { preHandler: requireApiKey }, async (req) => {
    const t = await db.query.tenants.findFirst({ where: eq(tenants.id, keyOf(req).tenantId), columns: { name: true } });
    return { ok: true, company: t!.name, key: keyOf(req).name };
  });

  app.post('/api/v1/leads', { preHandler: requireApiKey, config: { rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => String(req.headers.authorization ?? req.ip) } } }, async (req, reply) => {
    const key = keyOf(req);
    const b = parseBody(leadBody, req.body);
    if (b.externalId) {
      const existing = await db.query.trips.findFirst({ where: and(eq(trips.tenantId, key.tenantId), eq(trips.externalRef, b.externalId)), columns: { id: true, number: true } });
      if (existing) return reply.code(200).send({ trip: { id: existing.id, number: existing.number }, duplicate: true });
    }
    const create = () => createTrip(
      { tenantId: key.tenantId, userId: null },
      {
        customer: { name: b.name, phone: b.phone, email: b.email, whatsappOptIn: b.whatsappOptIn },
        destination: b.destination ?? null,
        startDate: b.startDate ?? null,
        endDate: b.endDate && b.startDate && b.endDate >= b.startDate ? b.endDate : null,
        adults: b.adults,
        children: b.children,
        budget: b.budget === undefined ? null : Math.round(Number(String(b.budget).replace(/,/g, '')) * 100),
        source: b.source,
        notes: b.notes ?? null,
        status: 'ENQUIRY',
      },
      { consentSource: `api: ${key.name}`, externalRef: b.externalId },
    );
    let trip: Awaited<ReturnType<typeof create>>;
    try {
      trip = await create();
    } catch (err) {
      // The same call sent twice at the same moment: the other request already added it
      const dup = b.externalId ? await db.query.trips.findFirst({ where: and(eq(trips.tenantId, key.tenantId), eq(trips.externalRef, b.externalId)), columns: { id: true, number: true } }) : null;
      if (dup) return reply.code(200).send({ trip: { id: dup.id, number: dup.number }, duplicate: true });
      throw err;
    }
    await notify(key.tenantId, {
      type: 'trips.new_lead',
      level: 'INFO',
      title: `New enquiry from ${key.name}: ${b.name}${b.destination ? `, ${b.destination}` : ''}`,
      body: [b.startDate && `Travelling ${b.startDate}`, b.adults && `${b.adults} adults`, b.budget && `budget ₹${b.budget}`].filter(Boolean).join(' · ') || undefined,
      link: `/trips/${trip.id}`,
    });
    return reply.code(201).send({ trip: { id: trip.id, number: trip.number, status: trip.status } });
  });
}

import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditLogs, tenants, whatsappSessions } from '../../db/schema.js';
import { BILLING_PLANS } from '../billing/plans.js';
import { planOf, whatsappDailyCap } from '../plans/entitlements.js';
import { db } from '../../lib/db.js';
import { AppError, parseBody } from '../../lib/http.js';
import { requireAuth, requireRole, seesAll, tenantOf, viewerOf } from '../auth/guard.js';
import { publishCommand } from './bus.js';
import { assertEnabled, DAILY_LIMIT_RANGE, getSession, listNumbers, sessionById, sessionDto, whatsappStatusDto } from './service.js';

const settingsBody = z.object({
  // null = use the plan's limit
  dailyLimit: z.number().int().min(DAILY_LIMIT_RANGE.min).max(DAILY_LIMIT_RANGE.max).nullable().optional(),
  intervalSeconds: z.number().int().min(6, 'Keep at least 6 seconds between messages').max(120).optional(),
});

export async function whatsappRoutes(app: FastifyInstance) {
  // Your own number's status, plus the QR code while linking (the page polls this every couple of seconds)
  app.get('/api/whatsapp', { preHandler: requireAuth }, async (req) => {
    const v = viewerOf(req);
    await assertEnabled(v.tenantId);
    return { whatsapp: await whatsappStatusDto(v.tenantId, v.userId) };
  });

  // Owners and managers: every employee's number at a glance
  app.get('/api/whatsapp/numbers', { preHandler: requireRole('ADMIN') }, async (req) => {
    const tenantId = tenantOf(req);
    await assertEnabled(tenantId);
    return { numbers: await listNumbers(tenantId) };
  });

  // Start linking your own number: the worker opens a WhatsApp Web session and publishes a QR code.
  // Every login can do this: each employee links the number their company gave them.
  app.post('/api/whatsapp/connect', { preHandler: requireAuth }, async (req) => {
    const v = viewerOf(req);
    await assertEnabled(v.tenantId);
    const s = await getSession(v.tenantId, v.userId);
    await db.update(whatsappSessions).set({ status: 'CONNECTING', lastError: null }).where(eq(whatsappSessions.id, s.id));
    await publishCommand({ action: 'connect', sessionId: s.id });
    await db.insert(auditLogs).values({ tenantId: v.tenantId, userId: v.userId, action: 'whatsapp.connect', entity: 'whatsapp_session', entityId: s.id });
    return { whatsapp: await whatsappStatusDto(v.tenantId, v.userId) };
  });

  // Unlink: logs the session out on WhatsApp's side and deletes the stored keys.
  // Your own number; owners and managers can also unlink an employee's (sessionId), e.g. when someone leaves.
  app.post('/api/whatsapp/disconnect', { preHandler: requireAuth }, async (req) => {
    const v = viewerOf(req);
    await assertEnabled(v.tenantId);
    const { sessionId } = parseBody(z.object({ sessionId: z.string().optional() }), req.body ?? {});
    const s = sessionId ? await sessionById(sessionId).catch(() => null) : await getSession(v.tenantId, v.userId);
    if (!s || s.tenantId !== v.tenantId) throw new AppError(404, 'not_found', 'WhatsApp number not found');
    if (s.userId !== v.userId && !seesAll(v)) throw new AppError(403, 'forbidden', 'You can only unlink your own WhatsApp number');
    await publishCommand({ action: 'disconnect', sessionId: s.id });
    await db.update(whatsappSessions).set({ status: 'DISCONNECTED', lastError: null }).where(eq(whatsappSessions.id, s.id));
    await db.insert(auditLogs).values({ tenantId: v.tenantId, userId: v.userId, action: 'whatsapp.disconnect', entity: 'whatsapp_session', entityId: s.id });
    return { whatsapp: await sessionDto(await sessionById(s.id)) };
  });

  // Your own number's pace
  app.patch('/api/whatsapp', { preHandler: requireAuth }, async (req) => {
    const v = viewerOf(req);
    const tenantId = v.tenantId;
    await assertEnabled(tenantId);
    const b = parseBody(settingsBody, req.body);
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    const perDay = tenant ? whatsappDailyCap(tenant) : null;
    if (perDay !== null && b.dailyLimit != null && b.dailyLimit > perDay) {
      const what = tenant!.plan === 'TRIAL' ? 'The free trial' : `Your ${BILLING_PLANS[planOf(tenant!).id].name} plan`;
      throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: { dailyLimit: `${what} allows up to ${perDay} a day for each number` } });
    }
    const s = await getSession(tenantId, v.userId);
    const patch = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    if (Object.keys(patch).length) await db.update(whatsappSessions).set(patch).where(eq(whatsappSessions.id, s.id));
    return { whatsapp: await whatsappStatusDto(tenantId, v.userId) };
  });
}

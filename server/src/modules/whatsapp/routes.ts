import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditLogs, tenants, whatsappSessions } from '../../db/schema.js';
import { BILLING_PLANS } from '../billing/plans.js';
import { planOf, whatsappDailyCap } from '../plans/entitlements.js';
import { db } from '../../lib/db.js';
import { AppError, parseBody } from '../../lib/http.js';
import { requireAuth, requireRole, tenantOf } from '../auth/guard.js';
import { publishCommand } from './bus.js';
import { assertEnabled, DAILY_LIMIT_RANGE, getSession, whatsappStatusDto } from './service.js';

const settingsBody = z.object({
  // null = use the plan's limit
  dailyLimit: z.number().int().min(DAILY_LIMIT_RANGE.min).max(DAILY_LIMIT_RANGE.max).nullable().optional(),
  intervalSeconds: z.number().int().min(6, 'Keep at least 6 seconds between messages').max(120).optional(),
});

export async function whatsappRoutes(app: FastifyInstance) {
  // Status, plus the QR code while linking (the page polls this every couple of seconds)
  app.get('/api/whatsapp', { preHandler: requireAuth }, async (req) => {
    await assertEnabled(tenantOf(req));
    return { whatsapp: await whatsappStatusDto(tenantOf(req)) };
  });

  // Start linking: the worker opens a WhatsApp Web session and publishes a QR code
  app.post('/api/whatsapp/connect', { preHandler: requireRole('ADMIN') }, async (req) => {
    const tenantId = tenantOf(req);
    await assertEnabled(tenantId);
    await getSession(tenantId);
    await db.update(whatsappSessions).set({ status: 'CONNECTING', lastError: null }).where(eq(whatsappSessions.tenantId, tenantId));
    await publishCommand({ action: 'connect', tenantId });
    await db.insert(auditLogs).values({ tenantId, userId: req.auth!.userId, action: 'whatsapp.connect', entity: 'whatsapp_session' });
    return { whatsapp: await whatsappStatusDto(tenantId) };
  });

  // Unlink: logs the session out on WhatsApp's side and deletes the stored keys
  app.post('/api/whatsapp/disconnect', { preHandler: requireRole('ADMIN') }, async (req) => {
    const tenantId = tenantOf(req);
    await assertEnabled(tenantId);
    await publishCommand({ action: 'disconnect', tenantId });
    await db.update(whatsappSessions).set({ status: 'DISCONNECTED', lastError: null }).where(eq(whatsappSessions.tenantId, tenantId));
    await db.insert(auditLogs).values({ tenantId, userId: req.auth!.userId, action: 'whatsapp.disconnect', entity: 'whatsapp_session' });
    return { whatsapp: await whatsappStatusDto(tenantId) };
  });

  app.patch('/api/whatsapp', { preHandler: requireRole('ADMIN') }, async (req) => {
    const tenantId = tenantOf(req);
    await assertEnabled(tenantId);
    const b = parseBody(settingsBody, req.body);
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    const perDay = tenant ? whatsappDailyCap(tenant) : null;
    if (perDay !== null && b.dailyLimit != null && b.dailyLimit > perDay) {
      const what = tenant!.plan === 'TRIAL' ? 'The free trial' : `Your ${BILLING_PLANS[planOf(tenant!).id].name} plan`;
      throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: { dailyLimit: `${what} allows up to ${perDay} a day` } });
    }
    await getSession(tenantId);
    const patch = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    if (Object.keys(patch).length) await db.update(whatsappSessions).set(patch).where(eq(whatsappSessions.tenantId, tenantId));
    return { whatsapp: await whatsappStatusDto(tenantId) };
  });
}

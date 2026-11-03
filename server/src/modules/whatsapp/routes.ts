import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditLogs, whatsappSessions } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { parseBody } from '../../lib/http.js';
import { requireAuth, requireRole, tenantOf } from '../auth/guard.js';
import { publishCommand } from './bus.js';
import { assertEnabled, DAILY_LIMIT_RANGE, getSession, whatsappStatusDto } from './service.js';

const settingsBody = z.object({
  dailyLimit: z.number().int().min(DAILY_LIMIT_RANGE.min).max(DAILY_LIMIT_RANGE.max).optional(),
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
    await getSession(tenantId);
    const patch = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    if (Object.keys(patch).length) await db.update(whatsappSessions).set(patch).where(eq(whatsappSessions.tenantId, tenantId));
    return { whatsapp: await whatsappStatusDto(tenantId) };
  });
}

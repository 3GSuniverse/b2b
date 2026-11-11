import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notifications } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { parseBody } from '../../lib/http.js';
import { requireAuth, seesAll, tenantOf, viewerOf } from '../auth/guard.js';

export interface NotifyInput {
  type: string;
  level?: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  title: string;
  body?: string;
  link?: string;
  /** The same key never creates a second notification */
  dedupeKey?: string;
  /** Who it is for. Leave out for agency-wide news that only the owner and managers see. */
  userId?: string | null;
}

/** Records something the company should know. Never throws — an alert must not break the work that caused it. */
export async function notify(tenantId: string, n: NotifyInput) {
  try {
    await db
      .insert(notifications)
      .values({ tenantId, type: n.type, level: n.level ?? 'INFO', title: n.title, body: n.body, link: n.link, dedupeKey: n.dedupeKey, userId: n.userId ?? null })
      .onConflictDoNothing();
  } catch (err) {
    logger.error({ err, tenantId, type: n.type }, 'could not record notification');
  }
}

export const today = () => new Date().toISOString().slice(0, 10);

export async function unreadCount(tenantId: string, only?: string) {
  const [r] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.tenantId, tenantId), only ? eq(notifications.userId, only) : undefined, isNull(notifications.readAt)));
  return r?.n ?? 0;
}

const listQuery = z.object({ unread: z.enum(['1', 'true']).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });
const readBody = z.object({ ids: z.array(z.string()).max(200).optional() });

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/api/notifications', { preHandler: requireAuth }, async (req) => {
    const q = parseBody(listQuery, req.query);
    const tenantId = tenantOf(req);
    const v = viewerOf(req);
    const only = seesAll(v) ? undefined : v.userId;
    const rows = await db
      .select({
        id: notifications.id,
        type: notifications.type,
        level: notifications.level,
        title: notifications.title,
        body: notifications.body,
        link: notifications.link,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(and(eq(notifications.tenantId, tenantId), only ? eq(notifications.userId, only) : undefined, q.unread ? isNull(notifications.readAt) : undefined))
      .orderBy(desc(notifications.createdAt))
      .limit(q.limit);
    return { notifications: rows, unread: await unreadCount(tenantId, only) };
  });

  // Mark some (or all) as read
  app.post('/api/notifications/read', { preHandler: requireAuth }, async (req) => {
    const { ids } = parseBody(readBody, req.body);
    const tenantId = tenantOf(req);
    const v = viewerOf(req);
    const only = seesAll(v) ? undefined : v.userId;
    await db
      .update(notifications)
      .set({ readAt: new Date() })
        .where(and(eq(notifications.tenantId, tenantId), only ? eq(notifications.userId, only) : undefined, isNull(notifications.readAt), ids?.length ? inArray(notifications.id, ids) : undefined));
    return { unread: await unreadCount(tenantId, only) };
  });
}

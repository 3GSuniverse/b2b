/**
 * "Contact customer care" for everyone in an agency. Anyone can open a request; the owner sees the
 * whole agency's requests, everyone else sees their own.
 */
import { and, count, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { supportTickets, users } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError, parseBody } from '../../lib/http.js';
import { attachmentIds, resolveRefs } from '../attachments/service.js';
import { requireAuth, tenantOf } from '../auth/guard.js';
import { addMessage, CATEGORIES, lastMessages, messageText, thread, ticketOr404 } from './service.js';

const newTicket = z.object({
  category: z.enum(CATEGORIES, { message: 'Choose what it’s about' }),
  subject: z.string().trim().min(3, 'Add a short title').max(140, 'Keep the title under 140 characters'),
  body: messageText,
  urgent: z.boolean().optional(), // "It's stopping our work"
  attachments: attachmentIds.optional(),
  context: z.object({ page: z.string().max(300).optional(), screen: z.string().max(40).optional() }).optional(),
});
const reply = z.object({ body: messageText, attachments: attachmentIds.optional() });
const rate = z.object({ rating: z.number().int().min(1).max(5), note: z.string().trim().max(1000).optional() });

/** Owners see every request from the agency; others only the ones they opened. */
function scope(req: FastifyRequest) {
  const tenantId = tenantOf(req);
  return req.auth!.role === 'OWNER' ? eq(supportTickets.tenantId, tenantId) : and(eq(supportTickets.tenantId, tenantId), eq(supportTickets.userId, req.auth!.userId))!;
}

export async function supportRoutes(app: FastifyInstance) {
  app.get('/api/support/tickets', { preHandler: requireAuth }, async (req) => {
    const rows = await db
      .select({
        id: supportTickets.id,
        number: supportTickets.number,
        subject: supportTickets.subject,
        category: supportTickets.category,
        status: supportTickets.status,
        priority: supportTickets.priority,
        unread: supportTickets.agencyUnread,
        lastMessageAt: supportTickets.lastMessageAt,
        createdAt: supportTickets.createdAt,
        rating: supportTickets.rating,
        byName: users.name,
      })
      .from(supportTickets)
      .leftJoin(users, eq(users.id, supportTickets.userId))
      .where(scope(req))
      .orderBy(desc(supportTickets.lastMessageAt))
      .limit(200);
    const last = await lastMessages(
      rows.map((r) => r.id),
      { internal: false },
    );
    return { tickets: rows.map((r) => ({ ...r, last: last.get(r.id) ?? null })) };
  });

  app.get('/api/support/unread', { preHandler: requireAuth }, async (req) => {
    const [r] = await db
      .select({ n: count() })
      .from(supportTickets)
      .where(and(scope(req), eq(supportTickets.agencyUnread, true)));
    return { unread: r?.n ?? 0 };
  });

  app.post('/api/support/tickets', { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, res) => {
    const body = parseBody(newTicket, req.body);
    const tenantId = tenantOf(req);
    const files = await resolveRefs(tenantId, body.attachments);
    const [t] = await db
      .insert(supportTickets)
      .values({
        tenantId,
        userId: req.auth!.userId,
        subject: body.subject,
        category: body.category,
        priority: body.urgent ? 'HIGH' : 'NORMAL',
        context: { ...body.context, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) },
      })
      .returning();
    await addMessage({ ticketId: t!.id, author: 'AGENCY', userId: req.auth!.userId, body: body.body, attachments: files });
    return res.code(201).send({ ticket: { id: t!.id, number: t!.number } });
  });

  app.get<{ Params: { id: string } }>('/api/support/tickets/:id', { preHandler: requireAuth }, async (req) => {
    const t = await ticketOr404(req.params.id, scope(req) as ReturnType<typeof eq>);
    if (t.agencyUnread) await db.update(supportTickets).set({ agencyUnread: false }).where(eq(supportTickets.id, t.id));
    return {
      ticket: {
        id: t.id,
        number: t.number,
        subject: t.subject,
        category: t.category,
        status: t.status,
        priority: t.priority,
        createdAt: t.createdAt,
        resolvedAt: t.resolvedAt,
        rating: t.rating,
        ratingNote: t.ratingNote,
      },
      messages: await thread(t.id, { internal: false }),
    };
  });

  // A reply from the agency; it reopens a solved request
  app.post<{ Params: { id: string } }>('/api/support/tickets/:id/messages', { preHandler: requireAuth, config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req) => {
    const t = await ticketOr404(req.params.id, scope(req) as ReturnType<typeof eq>);
    const body = parseBody(reply, req.body);
    const files = await resolveRefs(tenantOf(req), body.attachments);
    const message = await addMessage({ ticketId: t.id, author: 'AGENCY', userId: req.auth!.userId, body: body.body, attachments: files });
    if (t.status === 'RESOLVED') await addMessage({ ticketId: t.id, author: 'SYSTEM', body: 'Reopened by the agency' });
    await db.update(supportTickets).set({ status: 'OPEN', careUnread: true, lastMessageAt: new Date(), resolvedAt: null }).where(eq(supportTickets.id, t.id));
    return { message };
  });

  // "This is solved"
  app.post<{ Params: { id: string } }>('/api/support/tickets/:id/resolve', { preHandler: requireAuth }, async (req) => {
    const t = await ticketOr404(req.params.id, scope(req) as ReturnType<typeof eq>);
    if (t.status === 'RESOLVED') return { ok: true };
    const who = await db.query.users.findFirst({ where: eq(users.id, req.auth!.userId), columns: { name: true } });
    await addMessage({ ticketId: t.id, author: 'SYSTEM', body: `Marked solved by ${who?.name ?? 'the agency'}` });
    await db.update(supportTickets).set({ status: 'RESOLVED', resolvedAt: new Date(), careUnread: true }).where(eq(supportTickets.id, t.id));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/support/tickets/:id/rating', { preHandler: requireAuth }, async (req) => {
    const t = await ticketOr404(req.params.id, scope(req) as ReturnType<typeof eq>);
    if (t.status !== 'RESOLVED') throw new AppError(409, 'not_resolved', 'You can rate a request once it’s solved');
    const body = parseBody(rate, req.body);
    await db.update(supportTickets).set({ rating: body.rating, ratingNote: body.note || null }).where(eq(supportTickets.id, t.id));
    return { ok: true };
  });
}

import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { careStaff, supportMessages, supportTickets, users, type AttachmentRef } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';

/** What a request is about. The agency picks one; customer care can change it. */
export const CATEGORIES = ['billing', 'whatsapp', 'email', 'customers', 'trips', 'account', 'bug', 'idea', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];
export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const STATUSES = ['OPEN', 'WAITING', 'RESOLVED'] as const;

export const messageText = z.string().trim().min(1, 'Write a message').max(10_000, 'Keep it under 10,000 characters');

export type Ticket = typeof supportTickets.$inferSelect;

export async function ticketOr404(id: string, where?: ReturnType<typeof eq>) {
  const t = await db.query.supportTickets.findFirst({ where: where ? and(eq(supportTickets.id, id), where) : eq(supportTickets.id, id) });
  if (!t) throw new AppError(404, 'ticket_not_found', 'That request could not be found');
  return t;
}

/** The conversation, oldest first, with each author's name. Internal notes only for customer care. */
export async function thread(ticketId: string, opts: { internal: boolean }) {
  const rows = await db
    .select({
      id: supportMessages.id,
      author: supportMessages.author,
      body: supportMessages.body,
      attachments: supportMessages.attachments,
      internal: supportMessages.internal,
      createdAt: supportMessages.createdAt,
      userName: users.name,
      staffName: careStaff.name,
    })
    .from(supportMessages)
    .leftJoin(users, eq(users.id, supportMessages.userId))
    .leftJoin(careStaff, eq(careStaff.id, supportMessages.staffId))
    .where(and(eq(supportMessages.ticketId, ticketId), opts.internal ? undefined : eq(supportMessages.internal, false)))
    .orderBy(asc(supportMessages.createdAt));
  return rows.map(({ userName, staffName, ...m }) => ({
    ...m,
    // The agency sees "Customer care" plus the first name, never a full name or email
    name: m.author === 'AGENCY' ? (userName ?? 'Someone at the agency') : m.author === 'CARE' ? (opts.internal ? (staffName ?? 'Customer care') : `${(staffName ?? '').split(' ')[0] || 'Customer care'}`) : 'Dhrona',
  }));
}

export async function addMessage(input: {
  ticketId: string;
  author: 'AGENCY' | 'CARE' | 'SYSTEM';
  body: string;
  userId?: string | null;
  staffId?: string | null;
  attachments?: AttachmentRef[];
  internal?: boolean;
}) {
  const [m] = await db
    .insert(supportMessages)
    .values({
      ticketId: input.ticketId,
      author: input.author,
      body: input.body,
      userId: input.userId ?? null,
      staffId: input.staffId ?? null,
      attachments: input.attachments ?? [],
      internal: input.internal ?? false,
    })
    .returning();
  return m!;
}

/** The latest message of each ticket, for list previews. Internal notes only for customer care. */
export async function lastMessages(ticketIds: string[], opts: { internal: boolean }) {
  if (!ticketIds.length) return new Map<string, { body: string; author: string }>();
  const latest = await db
    .selectDistinctOn([supportMessages.ticketId], { ticketId: supportMessages.ticketId, body: supportMessages.body, author: supportMessages.author })
    .from(supportMessages)
    .where(and(inArray(supportMessages.ticketId, ticketIds), opts.internal ? undefined : eq(supportMessages.internal, false)))
    .orderBy(supportMessages.ticketId, desc(supportMessages.createdAt));
  return new Map(latest.map((r) => [r.ticketId, { body: r.body.slice(0, 180), author: r.author }]));
}

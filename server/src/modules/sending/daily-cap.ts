import { and, count, eq, gte, isNotNull, min } from 'drizzle-orm';
import { messages } from '../../db/schema.js';
import { db } from '../../lib/db.js';

/** Emails the agency sent in the last 24 hours (service emails like receipts included). */
export async function emailUsageLast24h(tenantId: string, now = new Date()) {
  const since = new Date(now.getTime() - 86_400_000);
  const [row] = await db
    .select({ sent: count(), oldest: min(messages.sentAt) })
    .from(messages)
    .where(and(eq(messages.tenantId, tenantId), eq(messages.channel, 'EMAIL'), isNotNull(messages.sentAt), gte(messages.sentAt, since)));
  return { sent: row?.sent ?? 0, oldest: row?.oldest ?? null };
}

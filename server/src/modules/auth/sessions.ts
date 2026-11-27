import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { isProd } from '../../config/env.js';
import { sessions } from '../../db/schema.js';
import { db } from '../../lib/db.js';

export const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 30;
const TOUCH_EVERY_MS = 60 * 60 * 1000; // refresh lastSeen/expiry at most hourly

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
export const hashToken = hash;

export async function createSession(input: { userId: string; tenantId: string; userAgent?: string; ip?: string }) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({
    tokenHash: hash(token),
    userId: input.userId,
    tenantId: input.tenantId,
    expiresAt,
    userAgent: input.userAgent?.slice(0, 300),
    ip: input.ip,
  });
  return { token, expiresAt };
}

export async function findSession(token: string) {
  const row = await db.query.sessions.findFirst({
    where: and(eq(sessions.tokenHash, hash(token)), gt(sessions.expiresAt, new Date())),
    with: { user: true, tenant: true },
  });
  if (!row) return null;
  // Sliding expiry: active users stay logged in (a support session keeps its short, fixed end)
  if (!row.careStaffId && Date.now() - row.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) })
      .where(eq(sessions.id, row.id));
  }
  return row;
}

export async function deleteSession(token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, hash(token)));
}

export async function deleteExpiredSessions() {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

/** A short session in an agency's account for a customer care person, acting as the owner. */
export async function createSupportSession(input: { userId: string; tenantId: string; careStaffId: string; reason: string; minutes: number }) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + input.minutes * 60_000);
  await db.insert(sessions).values({ tokenHash: hash(token), userId: input.userId, tenantId: input.tenantId, expiresAt, careStaffId: input.careStaffId, careReason: input.reason, userAgent: 'Dhrona customer care' });
  return { token, expiresAt };
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true, // JavaScript on the page can never read it
    secure: isProd,
    sameSite: 'lax',
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

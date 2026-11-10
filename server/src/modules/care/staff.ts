/**
 * Customer care staff: Dhrona's own support team. They are not agency users, so they have their own
 * accounts, sessions and cookie. An agency session can never open the care dashboard, and a care
 * session can never act inside an agency's account.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isProd } from '../../config/env.js';
import { careSessions, careStaff } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError, parseBody } from '../../lib/http.js';
import { dummyHash, verifyPassword } from '../auth/password.js';

export const CARE_COOKIE = 'care_sid';
const SESSION_HOURS = 12; // a working day; care staff sign in each shift
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

export interface CareAuth {
  staffId: string;
  name: string;
  role: 'AGENT' | 'LEAD';
}

declare module 'fastify' {
  interface FastifyRequest {
    care?: CareAuth;
  }
}

/** preHandler: only signed-in customer care staff get past. */
export async function requireCare(req: FastifyRequest) {
  const token = req.cookies[CARE_COOKIE];
  if (!token) throw new AppError(401, 'care_not_signed_in', 'Sign in to customer care');
  const s = await db.query.careSessions.findFirst({
    where: and(eq(careSessions.tokenHash, hash(token)), gt(careSessions.expiresAt, new Date())),
    with: { staff: true },
  });
  if (!s || s.staff.disabledAt) throw new AppError(401, 'care_session_expired', 'Your customer care session has ended. Sign in again.');
  if (Date.now() - s.lastSeenAt.getTime() > 5 * 60_000) await db.update(careSessions).set({ lastSeenAt: new Date() }).where(eq(careSessions.id, s.id));
  req.care = { staffId: s.staffId, name: s.staff.name, role: s.staff.role === 'LEAD' ? 'LEAD' : 'AGENT' };
}

const loginBody = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email({ message: 'Enter your work email' })),
  password: z.string().min(1, 'Enter your password').max(200),
});

function setCookie(reply: FastifyReply, token: string, expires: Date) {
  reply.setCookie(CARE_COOKIE, token, { path: '/', httpOnly: true, secure: isProd, sameSite: 'strict', expires });
}

export async function careAuthRoutes(app: FastifyInstance, opts: { rateLimitMax?: number }) {
  const limit = { rateLimit: { max: opts.rateLimitMax ?? 10, timeWindow: '15 minutes' } };

  app.post('/api/care/auth/login', { config: limit }, async (req, reply) => {
    const body = parseBody(loginBody, req.body);
    const staff = await db.query.careStaff.findFirst({ where: eq(careStaff.email, body.email) });
    const ok = await verifyPassword(body.password, staff?.passwordHash ?? (await dummyHash()));
    if (!staff || !ok || staff.disabledAt) throw new AppError(401, 'invalid_credentials', 'Email or password is incorrect');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000);
    await db.insert(careSessions).values({ tokenHash: hash(token), staffId: staff.id, expiresAt });
    await db.update(careStaff).set({ lastLoginAt: new Date() }).where(eq(careStaff.id, staff.id));
    setCookie(reply, token, expiresAt);
    return { staff: { id: staff.id, name: staff.name, email: staff.email, role: staff.role } };
  });

  app.post('/api/care/auth/logout', async (req, reply) => {
    const token = req.cookies[CARE_COOKIE];
    if (token) await db.delete(careSessions).where(eq(careSessions.tokenHash, hash(token)));
    reply.clearCookie(CARE_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/care/auth/me', { preHandler: requireCare }, async (req) => {
    const s = (await db.query.careStaff.findFirst({ where: eq(careStaff.id, req.care!.staffId) }))!;
    return { staff: { id: s.id, name: s.name, email: s.email, role: s.role } };
  });
}

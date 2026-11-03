import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenants, users } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError, parseBody } from '../../lib/http.js';
import { requireAuth } from './guard.js';
import { dummyHash, hashPassword, verifyPassword } from './password.js';
import { clearSessionCookie, createSession, deleteSession, setSessionCookie } from './sessions.js';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address' }));
const password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'That password is too long');

const signupBody = z.object({
  companyName: z.string().trim().min(2, 'Enter your company name').max(120),
  name: z.string().trim().min(1, 'Enter your name').max(120),
  email,
  password,
});

const loginBody = z.object({
  email,
  password: z.string().min(1, 'Enter your password').max(200),
});

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${base || 'company'}-${randomBytes(3).toString('hex')}`;
}

function publicUser(u: { id: string; name: string; email: string; role: string }) {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

function publicTenant(t: { id: string; name: string; slug: string; status: string; timezone: string; monthlyQuota: number; pausedReason: string | null; whatsappWebEnabled: boolean }) {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    timezone: t.timezone,
    monthlyQuota: t.monthlyQuota,
    pausedReason: t.pausedReason,
    features: { whatsapp: t.whatsappWebEnabled },
  };
}

export interface AuthRouteOptions {
  /** Sign-in / sign-up attempts allowed per IP per 15 minutes */
  rateLimitMax?: number;
}

export async function authRoutes(app: FastifyInstance, opts: AuthRouteOptions) {
  const authLimit = { rateLimit: { max: opts.rateLimitMax ?? 10, timeWindow: '15 minutes' } };
  // Sign up = create a company account plus its owner
  app.post('/api/auth/signup', { config: authLimit }, async (req, reply) => {
    const body = parseBody(signupBody, req.body);
    const existing = await db.query.users.findFirst({ where: eq(users.email, body.email), columns: { id: true } });
    if (existing) {
      throw new AppError(409, 'email_taken', 'An account with this email already exists. Try signing in.');
    }
    const passwordHash = await hashPassword(body.password);

    const { tenant, user } = await db.transaction(async (tx) => {
      const [tenant] = await tx.insert(tenants).values({ name: body.companyName, slug: slugify(body.companyName) }).returning();
      const [user] = await tx
        .insert(users)
        .values({ tenantId: tenant!.id, email: body.email, name: body.name, passwordHash, role: 'OWNER' })
        .returning();
      return { tenant: tenant!, user: user! };
    });

    const s = await createSession({ userId: user.id, tenantId: tenant.id, userAgent: req.headers['user-agent'], ip: req.ip });
    setSessionCookie(reply, s.token, s.expiresAt);
    return reply.code(201).send({ user: publicUser(user), tenant: publicTenant(tenant) });
  });

  app.post('/api/auth/login', { config: authLimit }, async (req, reply) => {
    const body = parseBody(loginBody, req.body);
    const user = await db.query.users.findFirst({ where: eq(users.email, body.email), with: { tenant: true } });
    const ok = await verifyPassword(body.password, user?.passwordHash ?? (await dummyHash()));
    if (!user || !ok) {
      // Same message either way — never reveal which emails have accounts
      throw new AppError(401, 'invalid_credentials', 'Email or password is incorrect');
    }
    if (user.tenant.status === 'SUSPENDED') {
      throw new AppError(403, 'account_suspended', 'This account has been suspended. Please contact support.');
    }
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const s = await createSession({ userId: user.id, tenantId: user.tenantId, userAgent: req.headers['user-agent'], ip: req.ip });
    setSessionCookie(reply, s.token, s.expiresAt);
    return { user: publicUser(user), tenant: publicTenant(user.tenant) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies.sid;
    if (token) await deleteSession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    const user = await db.query.users.findFirst({ where: eq(users.id, req.auth!.userId), with: { tenant: true } });
    if (!user) throw new AppError(401, 'not_signed_in', 'Please sign in');
    return { user: publicUser(user), tenant: publicTenant(user.tenant) };
  });
}

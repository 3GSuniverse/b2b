import { randomBytes } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { planDto, whatsappWebAllowed } from '../plans/entitlements.js';
import { sessions, tenants, users } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError, parseBody } from '../../lib/http.js';
import { requireAuth } from './guard.js';
import { freeLoginCode, LOGIN_CODE, USERNAME } from '../team/service.js';
import { dummyHash, hashPassword, verifyPassword } from './password.js';
import { clearSessionCookie, createSession, deleteSession, hashToken, setSessionCookie } from './sessions.js';

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

// The agency owner signs in with email; an employee with the agency ID and a username (like AWS root and IAM users)
const loginBody = z.union([
  z.object({ email, password: z.string().min(1, 'Enter your password').max(200) }),
  z.object({ agency: LOGIN_CODE, username: USERNAME, password: z.string().min(1, 'Enter your password').max(200) }),
]);

const passwordChange = z.object({ current: z.string().min(1, 'Enter your current password').max(200), next: z.string().min(8, 'Use at least 8 characters').max(200) });

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${base || 'company'}-${randomBytes(3).toString('hex')}`;
}

function publicUser(u: { id: string; name: string; email: string | null; username: string | null; role: string }) {
  return { id: u.id, name: u.name, email: u.email, username: u.username, role: u.role };
}

async function publicTenant(t: typeof tenants.$inferSelect) {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    loginCode: t.loginCode,
    status: t.status,
    timezone: t.timezone,
    monthlyQuota: t.monthlyQuota,
    pausedReason: t.pausedReason,
    features: { whatsapp: whatsappWebAllowed(t) },
    plan: await planDto(t),
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
      // Every new company starts on a free trial
      const [tenant] = await tx
        .insert(tenants)
        .values({ name: body.companyName, slug: slugify(body.companyName), loginCode: await freeLoginCode(body.companyName), plan: 'TRIAL', trialEndsAt: new Date(Date.now() + env.TRIAL_DAYS * 86_400_000), monthlyQuota: env.TRIAL_EMAILS })
        .returning();
      const [user] = await tx
        .insert(users)
        .values({ tenantId: tenant!.id, email: body.email, name: body.name, passwordHash, role: 'OWNER' })
        .returning();
      return { tenant: tenant!, user: user! };
    });

    const s = await createSession({ userId: user.id, tenantId: tenant.id, userAgent: req.headers['user-agent'], ip: req.ip });
    setSessionCookie(reply, s.token, s.expiresAt);
    return reply.code(201).send({ user: publicUser(user), tenant: await publicTenant(tenant) });
  });

  app.post('/api/auth/login', { config: authLimit }, async (req, reply) => {
    const body = parseBody(loginBody, req.body);
    let user: (typeof users.$inferSelect & { tenant: typeof tenants.$inferSelect }) | undefined;
    if ('email' in body) {
      user = await db.query.users.findFirst({ where: eq(users.email, body.email), with: { tenant: true } });
    } else {
      const agency = await db.query.tenants.findFirst({ where: eq(tenants.loginCode, body.agency), columns: { id: true } });
      user = agency ? await db.query.users.findFirst({ where: and(eq(users.tenantId, agency.id), eq(users.username, body.username)), with: { tenant: true } }) : undefined;
    }
    const ok = await verifyPassword(body.password, user?.passwordHash ?? (await dummyHash()));
    if (!user || !ok) {
      // Same message either way — never reveal which logins exist
      throw new AppError(401, 'invalid_credentials', 'email' in body ? 'Email or password is incorrect' : 'Agency ID, username or password is incorrect');
    }
    if (user.disabledAt) throw new AppError(403, 'login_disabled', 'Your login has been switched off. Ask your agency owner to switch it back on.');
    if (user.tenant.status === 'SUSPENDED') {
      throw new AppError(403, 'account_suspended', 'This account has been suspended. Please contact support.');
    }
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const s = await createSession({ userId: user.id, tenantId: user.tenantId, userAgent: req.headers['user-agent'], ip: req.ip });
    setSessionCookie(reply, s.token, s.expiresAt);
    return { user: publicUser(user), tenant: await publicTenant(user.tenant) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies.sid;
    if (token) await deleteSession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  // Anyone changes their own password; other devices are signed out
  app.post('/api/auth/password', { preHandler: requireAuth, config: authLimit }, async (req) => {
    const body = parseBody(passwordChange, req.body);
    const u = (await db.query.users.findFirst({ where: eq(users.id, req.auth!.userId) }))!;
    if (!(await verifyPassword(body.current, u.passwordHash))) throw new AppError(400, 'wrong_password', 'Your current password is incorrect');
    await db.update(users).set({ passwordHash: await hashPassword(body.next), updatedAt: new Date() }).where(eq(users.id, u.id));
    const current = hashToken(req.auth!.sessionToken);
    await db.delete(sessions).where(and(eq(sessions.userId, u.id), ne(sessions.tokenHash, current)));
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    const user = await db.query.users.findFirst({ where: eq(users.id, req.auth!.userId), with: { tenant: true } });
    if (!user) throw new AppError(401, 'not_signed_in', 'Please sign in');
    return { user: publicUser(user), tenant: await publicTenant(user.tenant) };
  });
}

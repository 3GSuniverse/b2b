import { and, count, eq, gte, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { billingPayments, campaigns, messages, sessions, tenants, trips, users } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { hashPassword } from '../auth/password.js';
import { planOf } from '../plans/entitlements.js';
import { monthStartSql } from '../sending/start-campaign.js';

/**
 * The agency and its people. The owner (the account that signed up) is like an AWS root user:
 * it creates employee logins (username + password), sees what each one sends, and pays.
 * Employees sign in with the agency ID and their username and see only the working app.
 */

export const USERNAME = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{2,29}$/, 'Use 3 to 30 letters, numbers, dots, dashes or underscores');
export const LOGIN_CODE = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{2,29}$/, 'Use 3 to 30 lowercase letters, numbers or dashes');
const PASSWORD = z.string().min(8, 'Use at least 8 characters').max(200);

export const employeeBody = z.object({
  name: z.string().trim().min(1, 'Enter their name').max(120),
  username: USERNAME,
  password: PASSWORD,
  role: z.enum(['MEMBER', 'ADMIN']).default('MEMBER'),
  email: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')).optional()),
});
export const employeePatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(['MEMBER', 'ADMIN']).optional(),
  password: PASSWORD.optional(),
  disabled: z.boolean().optional(),
});

/** An agency ID from the agency's name: "Kurukshetra Travels" → "kurukshetra-travels" (or -2, -3…). */
export async function freeLoginCode(name: string) {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24)
      .replace(/-$/, '') || 'agency';
  const padded = base.length < 3 ? `${base}-agency` : base;
  for (let i = 1; i < 200; i++) {
    const code = i === 1 ? padded : `${padded}-${i}`;
    const taken = await db.query.tenants.findFirst({ where: eq(tenants.loginCode, code), columns: { id: true } });
    if (!taken) return code;
  }
  return `${padded}-${Date.now().toString(36)}`;
}

/** How many employee logins the agency's plan allows. */
export function seatLimit(t: { plan: 'TRIAL' | 'PAID'; planId: string | null; seats?: number | null }) {
  return planOf({ ...t, trialEndsAt: null, whatsappWebEnabled: false }).seats;
}

/**
 * The logins that may be switched on now: the current plan's, or fewer if the agency has already
 * paid for a smaller next period (so they don't switch someone on who must go in a few days).
 */
export async function seatRoom(tenantId: string) {
  const t = (await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId), columns: { plan: true, planId: true, seats: true } }))!;
  const next = await db.query.billingPayments.findFirst({
    where: and(eq(billingPayments.tenantId, tenantId), eq(billingPayments.status, 'PAID'), isNull(billingPayments.appliedAt)),
    columns: { seats: true },
  });
  return Math.min(seatLimit(t), next?.seats ?? Infinity);
}

/** Active employee logins (the owner isn't counted). */
export async function seatsUsed(tenantId: string) {
  const [r] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), ne(users.role, 'OWNER'), isNull(users.disabledAt)));
  return r?.n ?? 0;
}

async function ensureRoom(tenantId: string) {
  const limit = await seatRoom(tenantId);
  if ((await seatsUsed(tenantId)) >= limit) {
    throw new AppError(
      409,
      'seats_full',
      `Your plan has ${limit} employee logins, and all are in use. Choose more logins for your next period in Plan & billing, or switch off someone who has left.`,
    );
  }
}

export function teamMemberDto(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    email: u.email,
    role: u.role,
    disabled: !!u.disabledAt,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

export async function createEmployee(tenantId: string, input: z.infer<typeof employeeBody>) {
  await ensureRoom(tenantId);
  const clash = await db.query.users.findFirst({ where: and(eq(users.tenantId, tenantId), eq(users.username, input.username)), columns: { id: true } });
  if (clash) throw new AppError(409, 'username_taken', `Someone in your agency already uses “${input.username}”. Choose another username.`);
  if (input.email) {
    const used = await db.query.users.findFirst({ where: eq(users.email, input.email), columns: { id: true } });
    if (used) throw new AppError(409, 'email_taken', 'That email already has a Dhrona login. Leave email empty, or use another.');
  }
  const [u] = await db
    .insert(users)
    .values({ tenantId, name: input.name, username: input.username, email: input.email ?? null, role: input.role, passwordHash: await hashPassword(input.password) })
    .returning();
  return teamMemberDto(u!);
}

export async function updateEmployee(tenantId: string, id: string, input: z.infer<typeof employeePatch>) {
  const u = await db.query.users.findFirst({ where: and(eq(users.id, id), eq(users.tenantId, tenantId)) });
  if (!u) throw new AppError(404, 'not_found', 'Employee not found');
  if (u.role === 'OWNER') throw new AppError(400, 'owner', 'The agency owner’s login is changed from your own account');
  if (input.disabled === false && u.disabledAt) await ensureRoom(tenantId);
  const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (input.name) patch.name = input.name;
  if (input.role) patch.role = input.role;
  if (input.password) patch.passwordHash = await hashPassword(input.password);
  if (input.disabled !== undefined) patch.disabledAt = input.disabled ? new Date() : null;
  const [row] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
  // Switched off or given a new password: signed out everywhere
  if (input.disabled || input.password) await db.delete(sessions).where(eq(sessions.userId, id));
  return teamMemberDto(row!);
}

export async function deleteEmployee(tenantId: string, id: string) {
  const u = await db.query.users.findFirst({ where: and(eq(users.id, id), eq(users.tenantId, tenantId)), columns: { role: true } });
  if (!u) throw new AppError(404, 'not_found', 'Employee not found');
  if (u.role === 'OWNER') throw new AppError(400, 'owner', 'The agency owner can’t be removed');
  // Their trips, broadcasts and messages stay; they just show as sent by a removed employee
  await db.delete(users).where(eq(users.id, id));
}

export async function setLoginCode(tenantId: string, code: string) {
  const taken = await db.query.tenants.findFirst({ where: eq(tenants.loginCode, code), columns: { id: true } });
  if (taken && taken.id !== tenantId) throw new AppError(409, 'code_taken', 'Another agency uses that ID. Try a variation.');
  await db.update(tenants).set({ loginCode: code, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
  return code;
}

/** The agency console: plan seats, the employee sign-in details, and each person's work this month. */
export async function teamOverview(tenantId: string, now = new Date()) {
  const t = (await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }))!;
  const month = monthStartSql(now, t.timezone);
  const [people, sent, broadcasts, tripsMade] = await Promise.all([
    db
      .select()
      .from(users)
      .where(eq(users.tenantId, tenantId))
      .orderBy(sql`case when ${users.role} = 'OWNER' then 0 else 1 end`, users.name),
    db
      .select({
        by: messages.sentById,
        email: sql<number>`count(*) filter (where ${messages.channel} = 'EMAIL' and ${messages.sentAt} is not null)::int`,
        whatsapp: sql<number>`count(*) filter (where ${messages.channel} = 'WHATSAPP' and ${messages.sentAt} is not null)::int`,
      })
      .from(messages)
      .where(and(eq(messages.tenantId, tenantId), gte(messages.queuedAt, month)))
      .groupBy(messages.sentById),
    db
      .select({ by: campaigns.createdById, n: count() })
      .from(campaigns)
      .where(and(eq(campaigns.tenantId, tenantId), gte(campaigns.startedAt, month)))
      .groupBy(campaigns.createdById),
    db
      .select({ by: trips.createdById, n: count() })
      .from(trips)
      .where(and(eq(trips.tenantId, tenantId), gte(trips.createdAt, month)))
      .groupBy(trips.createdById),
  ]);
  const usage = (id: string | null) => ({
    email: sent.find((s) => s.by === id)?.email ?? 0,
    whatsapp: sent.find((s) => s.by === id)?.whatsapp ?? 0,
    broadcasts: broadcasts.find((s) => s.by === id)?.n ?? 0,
    trips: tripsMade.find((s) => s.by === id)?.n ?? 0,
  });
  return {
    agency: { name: t.name, loginCode: t.loginCode },
    seats: { used: people.filter((p) => p.role !== 'OWNER' && !p.disabledAt).length, limit: seatLimit(t) },
    people: people.map((p) => ({ ...teamMemberDto(p), usage: usage(p.id) })),
    automatic: usage(null),
    totals: {
      email: sent.reduce((a, s) => a + s.email, 0),
      whatsapp: sent.reduce((a, s) => a + s.whatsapp, 0),
    },
  };
}

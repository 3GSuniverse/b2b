import { and, eq, sql } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { messages, type tenants } from '../../db/schema.js';
import { db } from '../../lib/db.js';

type TenantPlanFields = Pick<typeof tenants.$inferSelect, 'plan' | 'trialEndsAt' | 'whatsappWebEnabled'> & Partial<Pick<typeof tenants.$inferSelect, 'planId' | 'paidUntil'>>;

/** In a trial whose end date hasn't passed. */
export function trialActive(t: TenantPlanFields, now = new Date()) {
  return t.plan === 'TRIAL' && (!t.trialEndsAt || t.trialEndsAt.getTime() > now.getTime());
}

/** A trial that has run out: nothing can be sent until the company is upgraded. */
export function trialEnded(t: TenantPlanFields, now = new Date()) {
  return t.plan === 'TRIAL' && !trialActive(t, now);
}

/**
 * The unofficial WhatsApp Web sending exists only as a taste during the free trial.
 * Paid companies get the official WhatsApp route instead. `whatsappWebEnabled` is an operator override for testing.
 */
export function whatsappWebAllowed(t: TenantPlanFields, now = new Date()) {
  return trialActive(t, now) || t.whatsappWebEnabled;
}

/** During a trial a number sends at most this many WhatsApp messages a day; otherwise null (no trial cap). */
export function trialWhatsAppPerDay(t: TenantPlanFields) {
  return t.plan === 'TRIAL' && !t.whatsappWebEnabled ? env.TRIAL_WHATSAPP_PER_DAY : null;
}

async function whatsappCounts(tenantId: string, now: Date) {
  const since = new Date(now.getTime() - 86_400_000);
  const [row] = await db
    .select({
      sentToday: sql<number>`count(*) filter (where ${messages.sentAt} >= ${since.toISOString()}::timestamptz)::int`,
      pending: sql<number>`count(*) filter (where ${messages.status} = 'QUEUED')::int`,
    })
    .from(messages)
    .where(and(eq(messages.tenantId, tenantId), eq(messages.channel, 'WHATSAPP')));
  return { sentToday: row?.sentToday ?? 0, pending: row?.pending ?? 0 };
}

/**
 * How many more WhatsApp messages a trial can still get out before it ends, at the daily cap:
 * per day × days left, minus today's sends and anything already waiting. Null when there's no trial cap.
 */
export async function whatsappTrialCapacity(t: TenantPlanFields & { id: string }, now = new Date()) {
  const perDay = trialWhatsAppPerDay(t);
  if (perDay === null) return null;
  const { sentToday, pending } = await whatsappCounts(t.id, now);
  const days = Math.max(0, Math.ceil(((t.trialEndsAt?.getTime() ?? now.getTime()) - now.getTime()) / 86_400_000));
  return { perDay, sentToday, pending, leftToday: Math.max(0, perDay - sentToday), beforeTrialEnds: Math.max(0, perDay * days - sentToday - pending) };
}

export function daysLeft(t: TenantPlanFields, now = new Date()) {
  if (t.plan !== 'TRIAL' || !t.trialEndsAt) return null;
  return Math.max(0, Math.ceil((t.trialEndsAt.getTime() - now.getTime()) / 86_400_000));
}

/** What the dashboard shows about the plan. */
export async function planDto(t: TenantPlanFields & { id: string }) {
  const now = new Date();
  return {
    plan: t.plan,
    planId: t.planId ?? null, // set once bought online; stays after a plan lapses, so the app says "renew"
    paidUntil: t.paidUntil ?? null,
    trialEndsAt: t.trialEndsAt,
    trialEnded: trialEnded(t, now),
    daysLeft: daysLeft(t, now),
    whatsapp: t.plan === 'TRIAL' ? { perDay: env.TRIAL_WHATSAPP_PER_DAY, sentToday: (await whatsappCounts(t.id, now)).sentToday } : null,
    emailLimit: t.plan === 'TRIAL' ? env.TRIAL_EMAILS : null,
  };
}

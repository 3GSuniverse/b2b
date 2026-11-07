import { and, count, eq, gte, inArray, sql } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { auditLogs, messages, tenants } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { aiPerDayFor, BILLING_PLANS, emailsFor, isPlanId, MANUAL_PAID_SEATS, TRIAL_SEATS, type PlanId } from '../billing/plans.js';

type TenantPlanFields = Pick<typeof tenants.$inferSelect, 'plan' | 'trialEndsAt' | 'whatsappWebEnabled'> & Partial<Pick<typeof tenants.$inferSelect, 'planId' | 'paidUntil' | 'seats'>>;

/**
 * Which plan's features the agency has now, and for how many employee logins.
 * A free trial gets every feature (Ultra Premium) so agencies see everything; a company the
 * operator set to paid by hand does too.
 */
export function planOf(t: TenantPlanFields): { id: PlanId; seats: number; source: 'trial' | 'paid' | 'operator' } {
  if (t.plan !== 'PAID') return { id: 'ultra', seats: TRIAL_SEATS, source: 'trial' };
  if (isPlanId(t.planId)) return { id: t.planId, seats: t.seats ?? 1, source: 'paid' };
  return { id: 'ultra', seats: MANUAL_PAID_SEATS, source: 'operator' };
}

export type Feature = 'automations' | 'groups' | 'ai' | 'leadApi';
const FEATURE_NAMES: Record<Feature, string> = {
  automations: 'Automatic messages',
  groups: 'Group departures',
  ai: 'Drona AI',
  leadApi: 'The leads API',
};
/** The smallest plan that has each feature. */
export const FEATURE_PLAN: Record<Feature, PlanId> = { automations: 'professional', groups: 'professional', ai: 'professional', leadApi: 'ultra' };

/** What the agency's plan allows. */
export function entitlements(t: TenantPlanFields) {
  const p = planOf(t);
  const def = BILLING_PLANS[p.id];
  return {
    plan: p.id,
    seats: p.seats,
    source: p.source,
    automations: def.automations,
    groups: def.groups,
    leadApi: def.leadApi,
    ai: def.aiPerLogin > 0,
    aiPerDay: p.source === 'trial' ? env.TRIAL_AI_PER_DAY : aiPerDayFor(p.id, p.seats),
    domains: def.domains,
    emails: emailsFor(p.id, p.seats),
    prioritySupport: def.prioritySupport,
  };
}

export const hasFeature = (t: TenantPlanFields, f: Feature) => entitlements(t)[f];

export function featureError(f: Feature) {
  const need = BILLING_PLANS[FEATURE_PLAN[f]].name;
  return new AppError(403, 'plan_upgrade', `${FEATURE_NAMES[f]} comes with the ${need} plan. Choose ${need} for your next billing cycle in Plan & billing.`, { feature: f, plan: FEATURE_PLAN[f] });
}

/** Throws a clear "comes with the X plan" error when the agency's plan doesn't have this feature. */
export async function requireFeature(tenantId: string, f: Feature) {
  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!t || !hasFeature(t, f)) throw featureError(f);
  return t;
}

/**
 * Drona AI's allowance for today (replies and quote drafts together, over the last 24 hours).
 * Throws when the plan has no AI or the day's allowance is used up.
 */
export async function useAi(tenantId: string) {
  const t = await requireFeature(tenantId, 'ai');
  const limit = entitlements(t).aiPerDay;
  const [{ used } = { used: 0 }] = await db
    .select({ used: count() })
    .from(auditLogs)
    .where(and(eq(auditLogs.tenantId, tenantId), inArray(auditLogs.action, ['ai.reply', 'ai.draft']), gte(auditLogs.createdAt, new Date(Date.now() - 86_400_000))));
  if (used >= limit) throw new AppError(429, 'ai_limit', `You’ve used today’s ${limit} Drona AI answers. More tomorrow.`);
  return { limit, used };
}

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
    entitlements: entitlements(t),
    whatsapp: t.plan === 'TRIAL' ? { perDay: env.TRIAL_WHATSAPP_PER_DAY, sentToday: (await whatsappCounts(t.id, now)).sentToday } : null,
    emailLimit: t.plan === 'TRIAL' ? env.TRIAL_EMAILS : null,
  };
}

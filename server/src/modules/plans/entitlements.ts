import { and, count, eq, inArray } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { messages, type tenants } from '../../db/schema.js';
import { db } from '../../lib/db.js';

type TenantPlanFields = Pick<typeof tenants.$inferSelect, 'plan' | 'trialEndsAt' | 'whatsappWebEnabled'>;

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

/** WhatsApp messages a trial company has used: queued ones count, so a big campaign can't overshoot. */
export async function trialWhatsAppUsed(tenantId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.tenantId, tenantId), eq(messages.channel, 'WHATSAPP'), inArray(messages.status, ['QUEUED', 'SENT', 'DELIVERED'])));
  return row?.n ?? 0;
}

/** How many WhatsApp messages are left, or null when there's no trial cap. */
export async function whatsappAllowanceLeft(t: TenantPlanFields & { id: string }) {
  if (t.plan !== 'TRIAL' || t.whatsappWebEnabled) return null;
  return Math.max(0, env.TRIAL_WHATSAPP_MESSAGES - (await trialWhatsAppUsed(t.id)));
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
    trialEndsAt: t.trialEndsAt,
    trialEnded: trialEnded(t, now),
    daysLeft: daysLeft(t, now),
    whatsapp:
      t.plan === 'TRIAL' ? { limit: env.TRIAL_WHATSAPP_MESSAGES, used: await trialWhatsAppUsed(t.id) } : null,
    emailLimit: t.plan === 'TRIAL' ? env.TRIAL_EMAILS : null,
  };
}

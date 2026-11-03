import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { messages, tenants } from '../../db/schema.js';

// Amazon SES reviews an account at ~5% bounces or ~0.1% complaints.
// One careless tenant must never get the whole platform's SES account paused,
// so we pause that tenant first — automatically — and tell them why.
export const HEALTH = {
  windowDays: 30,
  minSample: 200, // too few emails to judge fairly below this
  maxBounceRate: 0.05,
  maxComplaintRate: 0.001,
};

export interface TenantHealth {
  sample: number;
  bounceRate: number;
  complaintRate: number;
}

export async function tenantHealth(tenantId: string, now = new Date()): Promise<TenantHealth> {
  const since = new Date(now.getTime() - HEALTH.windowDays * 86_400_000);
  const [row] = await db
    .select({
      sample: sql<number>`count(*)::int`,
      bounced: sql<number>`count(*) filter (where ${messages.status} = 'BOUNCED')::int`,
      complained: sql<number>`count(*) filter (where ${messages.status} = 'COMPLAINED')::int`,
    })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, tenantId),
        eq(messages.channel, 'EMAIL'),
        gte(messages.sentAt, since),
        inArray(messages.status, ['SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED']),
      ),
    );
  const sample = row?.sample ?? 0;
  return {
    sample,
    bounceRate: sample ? (row!.bounced / sample) : 0,
    complaintRate: sample ? (row!.complained / sample) : 0,
  };
}

/** Pauses the tenant if its recent bounce or complaint rate is over the limit. Returns true if paused. */
export async function evaluateTenantHealth(tenantId: string, now = new Date()): Promise<boolean> {
  const h = await tenantHealth(tenantId, now);
  if (h.sample < HEALTH.minSample) return false;

  let reason: string | null = null;
  if (h.bounceRate >= HEALTH.maxBounceRate) {
    reason = `Bounce rate ${(h.bounceRate * 100).toFixed(1)}% is above the ${HEALTH.maxBounceRate * 100}% limit. Clean your list, then contact support to resume.`;
  } else if (h.complaintRate >= HEALTH.maxComplaintRate) {
    reason = `Spam complaints at ${(h.complaintRate * 100).toFixed(2)}% are above the ${HEALTH.maxComplaintRate * 100}% limit. Only email people who opted in, then contact support to resume.`;
  }
  if (!reason) return false;

  const paused = await db
    .update(tenants)
    .set({ status: 'PAUSED', pausedReason: reason })
    .where(and(eq(tenants.id, tenantId), eq(tenants.status, 'ACTIVE')))
    .returning({ id: tenants.id });
  return paused.length > 0;
}

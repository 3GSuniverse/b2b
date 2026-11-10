import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import { automations, campaigns, tenants, whatsappSessions } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { notify } from '../notifications/service.js';
import { clearAuthState } from '../whatsapp/auth-store.js';
import { publishCommand } from '../whatsapp/bus.js';

/**
 * Runs with the 5-minute maintenance tick.
 *  - a day before: "your trial ends tomorrow"
 *  - at the end: unlink WhatsApp and delete its keys, cancel scheduled campaigns,
 *    pause automations, tell the company. Their data stays; sending stays off until upgraded.
 */
export async function runTrialLifecycle(now = new Date()) {
  const soon = new Date(now.getTime() + 86_400_000);
  const ending = await db
    .select({ id: tenants.id, trialEndsAt: tenants.trialEndsAt })
    .from(tenants)
    .where(and(eq(tenants.plan, 'TRIAL'), isNull(tenants.trialEndedAt), gt(tenants.trialEndsAt, now), lte(tenants.trialEndsAt, soon)));
  for (const t of ending) {
    await notify(t.id, {
      type: 'trial.ending',
      level: 'WARNING',
      title: 'Your free trial ends tomorrow',
      body: 'Upgrade to keep sending email and WhatsApp campaigns. Your contacts, templates and reports stay either way.',
      link: '/agency/billing',
      dedupeKey: 'trial.ending',
    });
  }

  const expired = await db
    .select({ id: tenants.id, name: tenants.name, planId: tenants.planId })
    .from(tenants)
    .where(and(eq(tenants.plan, 'TRIAL'), isNull(tenants.trialEndedAt), lte(tenants.trialEndsAt, now)));
  for (const t of expired) {
    // WhatsApp: unlink on WhatsApp's side (worker) and forget the keys here, even if the worker is down
    const lines = await db.query.whatsappSessions.findMany({ where: eq(whatsappSessions.tenantId, t.id) });
    for (const session of lines) {
      if (session.status !== 'DISCONNECTED') {
        await publishCommand({ action: 'disconnect', sessionId: session.id }).catch((err) => logger.warn({ err }, 'could not reach the worker'));
        await db
          .update(whatsappSessions)
          .set({ status: 'DISCONNECTED', lastError: 'Unlinked because the free trial ended.' })
          .where(eq(whatsappSessions.id, session.id));
      }
      await clearAuthState(session.id);
    }

    await db
      .update(campaigns)
      .set({ status: 'CANCELLED', lastError: 'Cancelled because the free trial ended.', completedAt: now })
      .where(and(eq(campaigns.tenantId, t.id), eq(campaigns.status, 'SCHEDULED')));
    await db.update(automations).set({ status: 'PAUSED' }).where(and(eq(automations.tenantId, t.id), eq(automations.status, 'ACTIVE')));
    await db.update(tenants).set({ trialEndedAt: now }).where(and(eq(tenants.id, t.id), isNull(tenants.trialEndedAt)));

    // A paid plan that wasn't renewed ends the same way, with its own words
    await notify(t.id, {
      type: 'trial.ended',
      level: 'ERROR',
      title: t.planId ? 'Your plan has ended' : 'Your free trial has ended',
      body: t.planId
        ? 'Sending is off until you renew. Your customers, trips, templates and reports are safe.'
        : 'Sending is off and WhatsApp has been unlinked. Upgrade to continue. Your contacts, templates and reports are safe.',
      link: '/agency/billing',
      dedupeKey: t.planId ? `plan.ended:${now.toISOString().slice(0, 10)}` : 'trial.ended',
    });
    logger.info({ tenantId: t.id, name: t.name }, 'trial ended');
  }
  return { reminded: ending.length, ended: expired.length };
}


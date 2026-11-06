import { and, asc, eq, lte } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { campaigns } from '../../db/schema.js';
import type { EnqueueFn } from '../../queues/index.js';
import { CampaignError, startCampaign } from '../sending/start-campaign.js';
import { refreshPendingDomains } from '../domains/service.js';
import { deleteExpiredSessions } from '../auth/sessions.js';
import { notify } from '../notifications/service.js';
import { runAutomationsTick } from '../automations/engine.js';
import { runTrialLifecycle } from '../plans/trial-lifecycle.js';
import { completeFinishedTrips } from '../trips/service.js';
import { runPaymentReminders } from '../payments/reminders.js';
import { runTripFollowups } from '../trips/followups.js';
import { removeUnusedAttachments } from '../attachments/service.js';
import { runPlanExpiry } from '../billing/service.js';

export interface TickResult {
  started: string[];
  failed: { campaignId: string; reason: string }[];
  automations?: { queued: number; skipped: number };
  reminders?: { sent: number; skipped: number };
  tripMessages?: { sent: number; skipped: number };
}

/** Housekeeping that doesn't need to run every minute: domain checks, expired sessions. */
export async function runMaintenanceTick(now = new Date()) {
  const domains = await refreshPendingDomains();
  await deleteExpiredSessions();
  const plans = await runPlanExpiry(now); // first, so a lapsed plan is cleaned up by the trial step below
  const trials = await runTrialLifecycle();
  const tripsCompleted = await completeFinishedTrips();
  // Once a night (around 2:30 AM India time): files uploaded but never used
  const unusedFiles = now.getUTCHours() === 21 && now.getUTCMinutes() < 5 ? await removeUnusedAttachments(now) : 0;
  return { domains, plans, trials, tripsCompleted, unusedFiles };
}

/**
 * Runs every minute. Starts every scheduled campaign whose time has come.
 * If the server was down at the scheduled time, the campaign starts on the
 * first tick after it comes back — it is late, never lost.
 */
export async function runSchedulerTick(opts: { now?: Date; enqueue?: EnqueueFn } = {}): Promise<TickResult> {
  const now = opts.now ?? new Date();
  const due = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.status, 'SCHEDULED'), lte(campaigns.scheduledAt, now)))
    .orderBy(asc(campaigns.scheduledAt))
    .limit(50);

  const result: TickResult = { started: [], failed: [] };
  for (const { id } of due) {
    try {
      await startCampaign(id, { now, enqueue: opts.enqueue });
      result.started.push(id);
    } catch (err) {
      if (err instanceof CampaignError && err.code === 'not_startable') continue; // someone else started it
      const reason = err instanceof Error ? err.message : String(err);
      // Leave it visible on the dashboard with the reason, instead of retrying forever
      const [failed] = await db
        .update(campaigns)
        .set({ status: 'FAILED', lastError: reason })
        .where(and(eq(campaigns.id, id), eq(campaigns.status, 'SCHEDULED')))
        .returning();
      if (failed) {
        await notify(failed.tenantId, {
          type: 'campaign.failed',
          level: 'ERROR',
          title: `“${failed.name}” couldn’t be sent at its scheduled time`,
          body: reason,
          link: `/campaigns/${failed.id}`,
          dedupeKey: `campaign.failed:${failed.id}`,
        });
      }
      result.failed.push({ campaignId: id, reason });
    }
  }
  const auto = await runAutomationsTick({ now, enqueue: opts.enqueue });
  result.automations = { queued: auto.queued, skipped: auto.skipped };
  result.reminders = await runPaymentReminders({ now, enqueueEmail: opts.enqueue });
  result.tripMessages = await runTripFollowups({ now, enqueueEmail: opts.enqueue });
  return result;
}

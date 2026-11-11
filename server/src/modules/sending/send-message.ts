import { and, count, eq, sql } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { campaigns, messageEvents, messages, suppressions } from '../../db/schema.js';
import { getEmailProvider, SendError, type EmailProvider } from '../email/index.js';
import { getMailboxProviderFactory, type MailboxProviderFactory } from '../mailboxes/gmail-provider.js';
import { senderUsageLast24h } from '../mailboxes/service.js';
import { buildMergeVars, renderEmail } from '../email/render.js';
import { unsubscribeUrl } from '../unsubscribe/token.js';
import { bumpCounter } from './counters.js';
import { emailDailyCap, trialEnded } from '../plans/entitlements.js';
import { emailUsageLast24h } from './daily-cap.js';
import { notify } from '../notifications/service.js';
import { syncAutomationSend } from '../automations/engine.js';
import { payPageUrl, serviceEmailHtml } from '../payments/reminders.js';
import { loadFiles, mergeRefs, type AttachmentFile } from '../attachments/service.js';

export type SendOutcome =
  | 'sent'
  | 'suppressed'
  | 'failed'
  | 'already_processed'
  | 'missing';

type Final = 'SUPPRESSED' | 'FAILED';

/**
 * Thrown when a connected mailbox has used its daily allowance. The message stays QUEUED
 * and the worker re-schedules the job for `until` — it is sent later, never dropped.
 */
export class DeferSend extends Error {
  constructor(readonly until: Date, reason: string) {
    super(reason);
    this.name = 'DeferSend';
  }
}

export async function finalizeMessage(
  msg: { id: string; campaignId: string | null; automationId: string | null },
  status: Final,
  error: string,
) {
  const counter = status === 'SUPPRESSED' ? 'suppressed' : 'failed';
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(messages)
      .set({ status, error, attempts: sql`${messages.attempts} + 1` })
      .where(and(eq(messages.id, msg.id), eq(messages.status, 'QUEUED')))
      .returning({ id: messages.id });
    if (updated.length) await bumpCounter(tx, msg, counter);
  });
  if (msg.campaignId) await maybeCompleteCampaign(msg.campaignId);
  if (msg.automationId) await syncAutomationSend(msg.id, status === 'SUPPRESSED' ? 'SKIPPED' : 'FAILED', error);
}

/** Called by the worker once every retry has been used up. */
export async function markMessageFailed(messageId: string, error: string) {
  const msg = await db.query.messages.findFirst({
    where: eq(messages.id, messageId),
    columns: { id: true, campaignId: true, automationId: true },
  });
  if (msg) await finalizeMessage(msg, 'FAILED', error);
}

/** When no message of a campaign is still queued, the campaign is done. */
export async function maybeCompleteCampaign(campaignId: string) {
  const [row] = await db
    .select({ pending: count() })
    .from(messages)
    .where(and(eq(messages.campaignId, campaignId), eq(messages.status, 'QUEUED')));
  if ((row?.pending ?? 0) === 0) {
    const [done] = await db
      .update(campaigns)
      .set({ status: 'SENT', completedAt: new Date() })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'SENDING')))
      .returning();
    if (done && done.recipients > 0) {
      const skipped = done.suppressed + done.failed;
      await notify(done.tenantId, {
        userId: done.createdById,
        type: 'campaign.completed',
        level: done.failed > 0 ? 'WARNING' : 'SUCCESS',
        title: `“${done.name}” has been sent`,
        body: `Sent to ${done.sent.toLocaleString('en-IN')} of ${done.recipients.toLocaleString('en-IN')} people${skipped ? ` · ${skipped.toLocaleString('en-IN')} skipped` : ''}. Opens and clicks keep updating over the next few days.`,
        link: `/campaigns/${done.id}`,
        dedupeKey: `campaign.completed:${done.id}`,
      });
    }
  }
}

/**
 * Sends one queued message. Safe to call more than once for the same id:
 * anything not in QUEUED state is left alone.
 *
 * Throws only for transient problems (the queue then retries with backoff).
 */
export async function processSendJob(
  messageId: string,
  provider: EmailProvider = getEmailProvider(),
  mailboxProvider: MailboxProviderFactory = getMailboxProviderFactory(),
): Promise<SendOutcome> {
  const msg = await db.query.messages.findFirst({
    where: eq(messages.id, messageId),
    with: {
      tenant: true,
      contact: true,
      campaign: { with: { sender: { with: { connection: true } } } },
      automation: { with: { sender: { with: { connection: true } }, template: true } },
      sender: { with: { connection: true } },
      trip: { columns: { publicToken: true } },
    },
  });

  if (!msg) return 'missing';
  if (msg.status !== 'QUEUED') return 'already_processed';

  // 1. Tenant must be allowed to send
  if (msg.tenant.status !== 'ACTIVE') {
    await finalizeMessage(msg, 'FAILED', `tenant_${msg.tenant.status.toLowerCase()}`);
    return 'failed';
  }
  if (trialEnded(msg.tenant)) {
    await finalizeMessage(msg, 'FAILED', 'trial_ended');
    return 'failed';
  }

  // Messages written in full when they were created (trip messages), rather than from a campaign or template
  const own = !msg.campaignId && !msg.automationId && msg.body !== null;
  // About the customer's own booking (payment reminder, trip starting soon): not marketing
  const service = own && msg.service;

  // The plan's emails a day (350 a login on Basic). Booking emails (receipts, reminders) always go.
  const perDay = service ? null : emailDailyCap(msg.tenant);
  if (perDay !== null) {
    const usage = await emailUsageLast24h(msg.tenantId);
    if (usage.sent >= perDay) {
      const until = new Date((usage.oldest?.getTime() ?? Date.now()) + 86_400_000 + 60_000);
      throw new DeferSend(until, `Daily email limit of ${perDay} reached`);
    }
  }

  // 2. Re-check consent at the moment of sending — people unsubscribe between scheduling and sending
  const address = msg.toAddress.toLowerCase();
  const [suppressed] = await db
    .select({ id: suppressions.id, reason: suppressions.reason })
    .from(suppressions)
    .where(
      and(
        eq(suppressions.tenantId, msg.tenantId),
        eq(suppressions.channel, 'EMAIL'),
        eq(suppressions.address, address),
      ),
    )
    .limit(1);
  if (service) {
    // Opting out of offers doesn't stop booking messages; a bounce or a spam report does
    if ((suppressed && suppressed.reason !== 'UNSUBSCRIBE') || msg.contact?.emailStatus === 'BOUNCED' || msg.contact?.emailStatus === 'COMPLAINED') {
      await finalizeMessage(msg, 'SUPPRESSED', suppressed ? 'on_suppression_list' : `contact_${msg.contact!.emailStatus.toLowerCase()}`);
      return 'suppressed';
    }
  } else if (suppressed || (msg.contact && msg.contact.emailStatus !== 'SUBSCRIBED')) {
    await finalizeMessage(msg, 'SUPPRESSED', suppressed ? 'on_suppression_list' : `contact_${msg.contact!.emailStatus.toLowerCase()}`);
    return 'suppressed';
  }

  // 3. Content and sender come from the campaign snapshot, or the automation's template
  const sender = msg.campaign?.sender ?? msg.automation?.sender ?? (own ? msg.sender : null);
  const content = own
    ? msg.subject && msg.body
      ? { subject: msg.subject, html: '', text: msg.body, previewText: null }
      : null
    : msg.campaign
    ? { subject: msg.campaign.subject, html: msg.campaign.html, text: msg.campaign.text, previewText: msg.campaign.previewText }
    : msg.automation?.template
      ? {
          subject: msg.automation.template.subject,
          html: msg.automation.template.html,
          text: msg.automation.template.text,
          previewText: msg.automation.template.previewText,
        }
      : null;

  if (!sender) {
    await finalizeMessage(msg, 'FAILED', 'no_sender');
    return 'failed';
  }
  if (!content?.subject || (!content.html && !own)) {
    await finalizeMessage(msg, 'FAILED', 'no_content');
    return 'failed';
  }

  // Connected mailboxes (Gmail) send through the company's own account, within its daily limit
  let sendVia = provider;
  if (sender.kind !== 'DOMAIN') {
    const conn = sender.connection;
    if (!conn || conn.status !== 'ACTIVE') {
      await finalizeMessage(msg, 'FAILED', 'mailbox_disconnected');
      return 'failed';
    }
    const usage = await senderUsageLast24h(sender.id);
    if (usage.sent >= conn.dailyLimit) {
      const until = new Date((usage.oldest?.getTime() ?? Date.now()) + 86_400_000 + 60_000);
      throw new DeferSend(until, `${conn.email} reached its daily limit of ${conn.dailyLimit}`);
    }
    sendVia = mailboxProvider(conn);
  }

  // 4. Render. Service messages were written in full when they were created.
  const unsubUrl = unsubscribeUrl(msg.id);
  const rendered = own
    ? {
        subject: content.subject,
        text: service ? content.text! : `${content.text}\n\nUnsubscribe: ${unsubUrl}`,
        html: serviceEmailHtml({
          text: content.text!,
          tenant: msg.tenant,
          // Payment reminders get a button to the customer's page
          ...(service && msg.trip && msg.subject?.startsWith('Payment') ? { buttonUrl: payPageUrl(msg.trip.publicToken), buttonLabel: 'See what’s due and pay' } : {}),
          unsubscribeUrl: service ? undefined : unsubUrl,
        }),
      }
    : renderEmail(
        { subject: content.subject, html: content.html!, text: content.text, previewText: content.previewText },
        buildMergeVars(msg.contact, msg.tenant, { unsubscribe_url: unsubUrl }),
        msg.tenant,
      );

  // Files go with every copy: the message's own, the campaign's, or the automation's (its template's first)
  const refs = own ? msg.attachments : msg.campaign ? msg.campaign.attachments : mergeRefs(msg.automation?.template?.attachments, msg.automation?.attachments);
  let files: AttachmentFile[];
  try {
    files = await loadFiles(msg.tenantId, refs ?? []);
  } catch {
    await finalizeMessage(msg, 'FAILED', 'attachment_missing');
    return 'failed';
  }

  // 5. Send
  let providerMessageId: string;
  try {
    ({ providerMessageId } = await sendVia.send({
      from: { name: sender.fromName, email: sender.fromEmail },
      replyTo: sender.replyTo,
      to: msg.toAddress,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      // Gmail & Yahoo one-click unsubscribe (RFC 8058). Not on booking messages: there's nothing to unsubscribe from.
      headers: service ? {} : { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      attachments: files,
      tags: {
        message_id: msg.id,
        tenant_id: msg.tenantId,
        ...(msg.campaignId ? { campaign_id: msg.campaignId } : {}),
        ...(msg.automationId ? { automation_id: msg.automationId } : {}),
      },
    }));
  } catch (err) {
    const e = err instanceof SendError ? err : new SendError(String((err as Error)?.message ?? err), false);
    if (e.permanent) {
      await finalizeMessage(msg, 'FAILED', `${e.code ?? 'error'}: ${e.message}`.slice(0, 500));
      return 'failed';
    }
    await db
      .update(messages)
      .set({ attempts: sql`${messages.attempts} + 1`, error: `${e.code ?? 'error'}: ${e.message}`.slice(0, 500) })
      .where(eq(messages.id, msg.id));
    throw e; // transient → BullMQ retries
  }

  // 6. Record
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(messages)
      .set({
        status: 'SENT',
        providerMessageId,
        senderId: sender.id,
        sentAt: new Date(),
        error: null,
        attempts: sql`${messages.attempts} + 1`,
      })
      .where(and(eq(messages.id, msg.id), eq(messages.status, 'QUEUED')))
      .returning({ id: messages.id });
    if (updated.length) {
      await tx.insert(messageEvents).values({ messageId: msg.id, type: 'SEND', occurredAt: new Date() });
      await bumpCounter(tx, msg, 'sent');
    }
  });

  if (msg.campaignId) await maybeCompleteCampaign(msg.campaignId);
  if (msg.automationId) await syncAutomationSend(msg.id, 'SENT');
  return 'sent';
}

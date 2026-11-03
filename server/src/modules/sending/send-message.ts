import { and, count, eq, sql } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { campaigns, messageEvents, messages, suppressions } from '../../db/schema.js';
import { getEmailProvider, SendError, type EmailProvider } from '../email/index.js';
import { buildMergeVars, renderEmail } from '../email/render.js';
import { unsubscribeUrl } from '../unsubscribe/token.js';
import { bumpCounter } from './counters.js';

export type SendOutcome =
  | 'sent'
  | 'suppressed'
  | 'failed'
  | 'already_processed'
  | 'missing';

type Final = 'SUPPRESSED' | 'FAILED';

async function finalize(
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
}

/** Called by the worker once every retry has been used up. */
export async function markMessageFailed(messageId: string, error: string) {
  const msg = await db.query.messages.findFirst({
    where: eq(messages.id, messageId),
    columns: { id: true, campaignId: true, automationId: true },
  });
  if (msg) await finalize(msg, 'FAILED', error);
}

/** When no message of a campaign is still queued, the campaign is done. */
export async function maybeCompleteCampaign(campaignId: string) {
  const [row] = await db
    .select({ pending: count() })
    .from(messages)
    .where(and(eq(messages.campaignId, campaignId), eq(messages.status, 'QUEUED')));
  if ((row?.pending ?? 0) === 0) {
    await db
      .update(campaigns)
      .set({ status: 'SENT', completedAt: new Date() })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'SENDING')));
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
): Promise<SendOutcome> {
  const msg = await db.query.messages.findFirst({
    where: eq(messages.id, messageId),
    with: {
      tenant: true,
      contact: true,
      campaign: { with: { sender: true } },
      automation: { with: { sender: true, template: true } },
    },
  });

  if (!msg) return 'missing';
  if (msg.status !== 'QUEUED') return 'already_processed';

  // 1. Tenant must be allowed to send
  if (msg.tenant.status !== 'ACTIVE') {
    await finalize(msg, 'FAILED', `tenant_${msg.tenant.status.toLowerCase()}`);
    return 'failed';
  }

  // 2. Re-check consent at the moment of sending — people unsubscribe between scheduling and sending
  const address = msg.toAddress.toLowerCase();
  const [suppressed] = await db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(
      and(
        eq(suppressions.tenantId, msg.tenantId),
        eq(suppressions.channel, 'EMAIL'),
        eq(suppressions.address, address),
      ),
    )
    .limit(1);
  if (suppressed || (msg.contact && msg.contact.emailStatus !== 'SUBSCRIBED')) {
    await finalize(msg, 'SUPPRESSED', suppressed ? 'on_suppression_list' : `contact_${msg.contact!.emailStatus.toLowerCase()}`);
    return 'suppressed';
  }

  // 3. Content and sender come from the campaign snapshot, or the automation's template
  const sender = msg.campaign?.sender ?? msg.automation?.sender;
  const content = msg.campaign
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
    await finalize(msg, 'FAILED', 'no_sender');
    return 'failed';
  }
  if (!content?.subject || !content.html) {
    await finalize(msg, 'FAILED', 'no_content');
    return 'failed';
  }

  // 4. Render
  const unsubUrl = unsubscribeUrl(msg.id);
  const vars = buildMergeVars(msg.contact, msg.tenant, { unsubscribe_url: unsubUrl });
  const rendered = renderEmail(
    { subject: content.subject, html: content.html, text: content.text, previewText: content.previewText },
    vars,
    msg.tenant,
  );

  // 5. Send
  let providerMessageId: string;
  try {
    ({ providerMessageId } = await provider.send({
      from: { name: sender.fromName, email: sender.fromEmail },
      replyTo: sender.replyTo,
      to: msg.toAddress,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: {
        // Gmail & Yahoo one-click unsubscribe (RFC 8058)
        'List-Unsubscribe': `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
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
      await finalize(msg, 'FAILED', `${e.code ?? 'error'}: ${e.message}`.slice(0, 500));
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
  return 'sent';
}

import { and, count, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { campaigns, messages, senders } from '../../db/schema.js';
import { enqueueEmails, enqueueWhatsApp, type EnqueueFn } from '../../queues/index.js';
import { countEmailAudience, countWhatsAppAudience, iterateEmailAudience, iterateWhatsAppAudience } from '../audience/resolve.js';
import { trialEnded, whatsappTrialCapacity, whatsappWebAllowed } from '../plans/entitlements.js';
import { whatsappSessions } from '../../db/schema.js';
import { isDomainReady } from '../domains/service.js';
import { LIMITS, totalSize } from '../attachments/service.js';

export class CampaignError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_found'
      | 'not_startable'
      | 'tenant_not_active'
      | 'no_sender'
      | 'sender_not_verified'
      | 'no_content'
      | 'quota_exceeded'
      | 'whatsapp_not_ready'
      | 'trial_ended'
      | 'trial_limit'
      | 'attachments_too_large'
      | 'consent_needed',
  ) {
    super(message);
    this.name = 'CampaignError';
  }
}

/** Start of the calendar month in the company's timezone (India: midnight IST on the 1st). */
export function monthStartSql(now: Date, timezone: string) {
  return sql`(date_trunc('month', ${now.toISOString()}::timestamptz at time zone ${timezone}) at time zone ${timezone})`;
}

/** Emails a tenant has used this calendar month, in its own timezone. */
export async function monthlyUsage(tenantId: string, now = new Date(), timezone = 'Asia/Kolkata') {
  const [row] = await db
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.tenantId, tenantId), gte(messages.queuedAt, monthStartSql(now, timezone)), eq(messages.channel, 'EMAIL')));
  return row?.n ?? 0;
}

/**
 * Turns a DRAFT or SCHEDULED campaign into queued messages and starts sending.
 *  - snapshots subject/html from the template, so later template edits don't change it
 *  - creates one message per recipient (unique per campaign — calling twice never duplicates)
 *  - enforces the tenant's monthly quota before anything is queued
 */
export async function startCampaign(
  campaignId: string,
  opts: { enqueue?: EnqueueFn; enqueueWhatsApp?: EnqueueFn; now?: Date } = {},
): Promise<{ recipients: number }> {
  const head = await db.query.campaigns.findFirst({ where: eq(campaigns.id, campaignId), columns: { channel: true } });
  if (head?.channel === 'WHATSAPP') return startWhatsAppCampaign(campaignId, { enqueue: opts.enqueueWhatsApp, now: opts.now });
  const enqueue = opts.enqueue ?? enqueueEmails;
  const now = opts.now ?? new Date();

  const campaign = await db.query.campaigns.findFirst({
    where: eq(campaigns.id, campaignId),
    with: { tenant: true, template: true },
  });
  if (!campaign) throw new CampaignError('Campaign not found', 'not_found');
  if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED') {
    throw new CampaignError(`Campaign is ${campaign.status.toLowerCase()}`, 'not_startable');
  }
  if (campaign.tenant.status !== 'ACTIVE') {
    throw new CampaignError('Sending is paused for this account', 'tenant_not_active');
  }
  if (trialEnded(campaign.tenant, now)) throw new CampaignError('Your free trial has ended. Upgrade to keep sending.', 'trial_ended');
  if (!campaign.senderId) throw new CampaignError('Choose who the email is from', 'no_sender');
  const sender = await db.query.senders.findFirst({
    where: and(eq(senders.id, campaign.senderId), eq(senders.tenantId, campaign.tenantId)),
    with: { domain: true, connection: true },
  });
  if (!sender) throw new CampaignError('Choose who the email is from', 'no_sender');
  if (sender.kind === 'DOMAIN') {
    if (!sender.domain || !isDomainReady(sender.domain)) {
      throw new CampaignError(`${sender.domain?.domain ?? 'The domain'} isn’t verified yet. Finish the DNS setup first.`, 'sender_not_verified');
    }
  } else if (sender.connection?.status !== 'ACTIVE') {
    throw new CampaignError(`${sender.fromEmail} is disconnected. Reconnect it in Email → Sending setup.`, 'sender_not_verified');
  }

  const subject = campaign.subject ?? campaign.template?.subject;
  const html = campaign.html ?? campaign.template?.html;
  if (!subject || !html) throw new CampaignError('The email has no subject or content', 'no_content');
  if (totalSize(campaign.attachments) > LIMITS.emailTotalBytes) {
    throw new CampaignError('The attachments are too large for email (over 15 MB in all). Remove some first.', 'attachments_too_large');
  }

  if (campaign.audience?.mode === 'temporary' && !campaign.audience.consent) throw new CampaignError('Confirm that the people in the temporary list agreed to hear from you', 'consent_needed');
  const audienceSize = await countEmailAudience(db, campaign.tenantId, campaign.audience);
  const used = await monthlyUsage(campaign.tenantId, now, campaign.tenant.timezone);
  if (used + audienceSize > campaign.tenant.monthlyQuota) {
    throw new CampaignError(
      `This send needs ${audienceSize} emails but only ${Math.max(0, campaign.tenant.monthlyQuota - used)} are left this month`,
      'quota_exceeded',
    );
  }

  // Claim the campaign — only one caller wins, even if the scheduler and a user click "Send" together
  const claimed = await db
    .update(campaigns)
    .set({
      status: 'SENDING',
      startedAt: now,
      subject,
      html,
      text: campaign.text ?? campaign.template?.text ?? null,
      previewText: campaign.previewText ?? campaign.template?.previewText ?? null,
      lastError: null,
    })
    .where(and(eq(campaigns.id, campaignId), inArray(campaigns.status, ['DRAFT', 'SCHEDULED'])))
    .returning({ id: campaigns.id });
  if (claimed.length === 0) throw new CampaignError('Campaign already started', 'not_startable');

  for await (const batch of iterateEmailAudience(db, campaign.tenantId, campaign.audience)) {
    const inserted = await db
      .insert(messages)
      .values(
        batch.map((c) => ({
          tenantId: campaign.tenantId,
          campaignId,
          senderId: campaign.senderId,
          contactId: c.id,
          channel: 'EMAIL' as const,
          toAddress: c.email.toLowerCase(),
          sentById: campaign.createdById,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: messages.id });
    await enqueue(inserted.map((m) => m.id));
  }

  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(messages)
    .where(eq(messages.campaignId, campaignId));

  await db
    .update(campaigns)
    .set({
      recipients: n,
      ...(n === 0 ? { status: 'SENT' as const, completedAt: new Date() } : {}),
    })
    .where(eq(campaigns.id, campaignId));

  return { recipients: n };
}

/**
 * WhatsApp version of startCampaign: one message per contact who agreed to WhatsApp,
 * sent from the company's linked number. Pacing and the daily cap happen in the worker.
 */
export async function startWhatsAppCampaign(campaignId: string, opts: { enqueue?: EnqueueFn; now?: Date } = {}) {
  const enqueue = opts.enqueue ?? enqueueWhatsApp;
  const now = opts.now ?? new Date();
  const campaign = await db.query.campaigns.findFirst({ where: eq(campaigns.id, campaignId), with: { tenant: true } });
  if (!campaign) throw new CampaignError('Campaign not found', 'not_found');
  if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED') throw new CampaignError(`Campaign is ${campaign.status.toLowerCase()}`, 'not_startable');
  if (campaign.tenant.status !== 'ACTIVE') throw new CampaignError('Sending is paused for this account', 'tenant_not_active');
  if (trialEnded(campaign.tenant, now)) throw new CampaignError('Your free trial has ended. Upgrade to keep sending.', 'trial_ended');
  if (!whatsappWebAllowed(campaign.tenant, now)) throw new CampaignError('WhatsApp sending isn’t available on this account', 'whatsapp_not_ready');
  const session = await db.query.whatsappSessions.findFirst({ where: eq(whatsappSessions.tenantId, campaign.tenantId) });
  if (session?.status !== 'CONNECTED') throw new CampaignError('Link your WhatsApp number first, in WhatsApp → Linked number', 'whatsapp_not_ready');
  if (!campaign.text?.trim() && !campaign.attachments.length) throw new CampaignError('The message is empty', 'no_content');
  if (campaign.audience?.mode === 'temporary' && !campaign.audience.consent) throw new CampaignError('Confirm that the people in the temporary list agreed to hear from you', 'consent_needed');
  // A trial sends at most N a day; refuse a campaign that couldn't finish before the trial ends
  const cap = await whatsappTrialCapacity(campaign.tenant, now);
  if (cap !== null) {
    const needed = await countWhatsAppAudience(db, campaign.tenantId, campaign.audience);
    if (needed > cap.beforeTrialEnds) {
      throw new CampaignError(
        `Your trial sends up to ${cap.perDay} WhatsApp messages a day and can fit ${cap.beforeTrialEnds} more before it ends. This needs ${needed}. Choose a smaller list.`,
        'trial_limit',
      );
    }
  }

  const claimed = await db
    .update(campaigns)
    .set({ status: 'SENDING', startedAt: now, lastError: null })
    .where(and(eq(campaigns.id, campaignId), inArray(campaigns.status, ['DRAFT', 'SCHEDULED'])))
    .returning({ id: campaigns.id });
  if (claimed.length === 0) throw new CampaignError('Campaign already started', 'not_startable');

  for await (const batch of iterateWhatsAppAudience(db, campaign.tenantId, campaign.audience)) {
    const inserted = await db
      .insert(messages)
      .values(batch.map((c) => ({ tenantId: campaign.tenantId, campaignId, contactId: c.id, channel: 'WHATSAPP' as const, toAddress: c.phone, sentById: campaign.createdById })))
      .onConflictDoNothing()
      .returning({ id: messages.id });
    await enqueue(inserted.map((m) => m.id));
  }
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(messages).where(eq(messages.campaignId, campaignId));
  await db
    .update(campaigns)
    .set({ recipients: n, ...(n === 0 ? { status: 'SENT' as const, completedAt: new Date() } : {}) })
    .where(eq(campaigns.id, campaignId));
  return { recipients: n };
}

/** Re-queue messages stuck in QUEUED (e.g. Redis was wiped). Safe: jobId dedupes live jobs. */
export async function requeueStuckMessages(campaignId: string, enqueue: EnqueueFn = enqueueEmails) {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.campaignId, campaignId), eq(messages.status, 'QUEUED')));
  await enqueue(rows.map((r) => r.id));
  return rows.length;
}


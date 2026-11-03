import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, type Tx } from '../../lib/db.js';
import { contacts, messageEvents, messages, suppressions, trackedLinks } from '../../db/schema.js';
import { bumpCounter } from '../sending/counters.js';
import { evaluateTenantHealth } from './tenant-health.js';

/** The parts of an SES event (configuration-set event publishing) we use. */
export interface SesEvent {
  eventType?: string; // configuration-set events
  notificationType?: string; // identity notifications use this instead
  mail: {
    messageId: string;
    timestamp?: string;
    tags?: Record<string, string[]>;
  };
  bounce?: {
    bounceType: 'Permanent' | 'Transient' | 'Undetermined';
    bounceSubType?: string;
    timestamp?: string;
    bouncedRecipients?: { emailAddress: string; diagnosticCode?: string }[];
  };
  complaint?: { timestamp?: string; complaintFeedbackType?: string };
  delivery?: { timestamp?: string; smtpResponse?: string };
  open?: { timestamp?: string; userAgent?: string };
  click?: { timestamp?: string; link?: string; userAgent?: string };
  reject?: { reason?: string };
}

export type HandleResult =
  | 'processed'
  | 'duplicate'
  | 'unknown_message'
  | 'ignored';

const TYPE_MAP = {
  Delivery: 'DELIVERY',
  Bounce: 'BOUNCE',
  Complaint: 'COMPLAINT',
  Open: 'OPEN',
  Click: 'CLICK',
  Reject: 'REJECT',
} as const;

function when(s: string | undefined): Date {
  const d = s ? new Date(s) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

async function suppress(
  tx: Tx,
  tenantId: string,
  address: string,
  reason: 'HARD_BOUNCE' | 'COMPLAINT',
  note?: string,
) {
  await tx
    .insert(suppressions)
    .values({ tenantId, channel: 'EMAIL', address: address.toLowerCase(), reason, note })
    .onConflictDoNothing();
}

/**
 * Applies one SES event. Idempotent: the same SNS notification delivered twice
 * (SNS retries) is recorded once, thanks to the unique providerEventId.
 */
export async function handleSesEvent(event: SesEvent, providerEventId?: string): Promise<HandleResult> {
  const rawType = event.eventType ?? event.notificationType ?? '';
  const type = TYPE_MAP[rawType as keyof typeof TYPE_MAP];
  if (!type) return 'ignored'; // Send, DeliveryDelay, Subscription… nothing to do

  // Prefer our own id (tag) — it works even if the event beats our DB write of the SES id
  const taggedId = event.mail.tags?.message_id?.[0];
  const msg = await db.query.messages.findFirst({
    where: taggedId ? eq(messages.id, taggedId) : eq(messages.providerMessageId, event.mail.messageId),
  });
  if (!msg) return 'unknown_message';

  let tenantNeedsCheck = false;

  const result = await db.transaction(async (tx): Promise<HandleResult> => {
    const detail =
      type === 'BOUNCE'
        ? {
            bounceType: event.bounce?.bounceType,
            subType: event.bounce?.bounceSubType,
            diagnostic: event.bounce?.bouncedRecipients?.[0]?.diagnosticCode,
          }
        : type === 'COMPLAINT'
          ? { feedbackType: event.complaint?.complaintFeedbackType }
          : type === 'CLICK'
            ? { link: event.click?.link, userAgent: event.click?.userAgent }
            : type === 'OPEN'
              ? { userAgent: event.open?.userAgent }
              : type === 'REJECT'
                ? { reason: event.reject?.reason }
                : type === 'DELIVERY'
                  ? { smtpResponse: event.delivery?.smtpResponse }
                  : null;

    const occurredAt = when(
      event.bounce?.timestamp ??
        event.complaint?.timestamp ??
        event.delivery?.timestamp ??
        event.open?.timestamp ??
        event.click?.timestamp ??
        event.mail.timestamp,
    );

    const inserted = await tx
      .insert(messageEvents)
      .values({ messageId: msg.id, type, occurredAt, detail, providerEventId })
      .onConflictDoNothing()
      .returning({ id: messageEvents.id });
    if (providerEventId && inserted.length === 0) return 'duplicate';

    switch (type) {
      case 'DELIVERY': {
        const changed = await tx
          .update(messages)
          .set({ status: 'DELIVERED', deliveredAt: occurredAt })
          .where(and(eq(messages.id, msg.id), eq(messages.status, 'SENT')))
          .returning({ id: messages.id });
        if (changed.length) await bumpCounter(tx, msg, 'delivered');
        break;
      }

      case 'BOUNCE': {
        // Transient bounces (mailbox full, server busy) are recorded but never suppress
        if (event.bounce?.bounceType !== 'Permanent') break;
        const changed = await tx
          .update(messages)
          .set({ status: 'BOUNCED' })
          .where(and(eq(messages.id, msg.id), inArray(messages.status, ['SENT', 'DELIVERED'])))
          .returning({ id: messages.id });
        if (changed.length) await bumpCounter(tx, msg, 'bounced');
        await suppress(tx, msg.tenantId, msg.toAddress, 'HARD_BOUNCE', event.bounce.bounceSubType);
        if (msg.contactId) {
          await tx.update(contacts).set({ emailStatus: 'BOUNCED' }).where(eq(contacts.id, msg.contactId));
        }
        tenantNeedsCheck = true;
        break;
      }

      case 'COMPLAINT': {
        const changed = await tx
          .update(messages)
          .set({ status: 'COMPLAINED' })
          .where(and(eq(messages.id, msg.id), inArray(messages.status, ['SENT', 'DELIVERED'])))
          .returning({ id: messages.id });
        if (changed.length) await bumpCounter(tx, msg, 'complained');
        await suppress(tx, msg.tenantId, msg.toAddress, 'COMPLAINT');
        if (msg.contactId) {
          await tx.update(contacts).set({ emailStatus: 'COMPLAINED' }).where(eq(contacts.id, msg.contactId));
        }
        tenantNeedsCheck = true;
        break;
      }

      case 'OPEN': {
        // Count unique opens only
        const first = await tx
          .update(messages)
          .set({ firstOpenedAt: occurredAt })
          .where(and(eq(messages.id, msg.id), isNull(messages.firstOpenedAt)))
          .returning({ id: messages.id });
        if (first.length) await bumpCounter(tx, msg, 'opened');
        break;
      }

      case 'CLICK': {
        const first = await tx
          .update(messages)
          .set({ firstClickedAt: occurredAt })
          .where(and(eq(messages.id, msg.id), isNull(messages.firstClickedAt)))
          .returning({ id: messages.id });
        if (first.length) await bumpCounter(tx, msg, 'clicked');
        const link = event.click?.link;
        if (link && msg.campaignId) {
          await tx
            .insert(trackedLinks)
            .values({ campaignId: msg.campaignId, url: link.slice(0, 2000), clicks: 1 })
            .onConflictDoUpdate({
              target: [trackedLinks.campaignId, trackedLinks.url],
              set: { clicks: sql`${trackedLinks.clicks} + 1` },
            });
        }
        break;
      }

      case 'REJECT': {
        const changed = await tx
          .update(messages)
          .set({ status: 'FAILED', error: `rejected: ${event.reject?.reason ?? 'unknown'}` })
          .where(and(eq(messages.id, msg.id), eq(messages.status, 'SENT')))
          .returning({ id: messages.id });
        if (changed.length) await bumpCounter(tx, msg, 'failed');
        break;
      }
    }
    return 'processed';
  });

  if (result === 'processed' && tenantNeedsCheck) await evaluateTenantHealth(msg.tenantId);
  return result;
}

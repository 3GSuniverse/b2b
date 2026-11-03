import { and, eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { contacts, messageEvents, messages, suppressions } from '../../db/schema.js';
import { bumpCounter } from '../sending/counters.js';

export interface UnsubscribeInfo {
  email: string;
  tenantName: string;
  alreadyUnsubscribed: boolean;
}

export async function lookupForUnsubscribe(messageId: string): Promise<UnsubscribeInfo | null> {
  const msg = await db.query.messages.findFirst({
    where: eq(messages.id, messageId),
    with: { tenant: true, contact: true },
  });
  if (!msg) return null;
  const [sup] = await db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(
      and(
        eq(suppressions.tenantId, msg.tenantId),
        eq(suppressions.channel, 'EMAIL'),
        eq(suppressions.address, msg.toAddress.toLowerCase()),
      ),
    )
    .limit(1);
  return {
    email: msg.toAddress,
    tenantName: msg.tenant.name,
    alreadyUnsubscribed: !!sup || msg.contact?.emailStatus === 'UNSUBSCRIBED',
  };
}

/**
 * Unsubscribes the recipient of a message from ALL of that tenant's marketing email.
 * Idempotent: clicking twice changes nothing the second time.
 */
export async function unsubscribeByMessage(messageId: string): Promise<UnsubscribeInfo | null> {
  const msg = await db.query.messages.findFirst({
    where: eq(messages.id, messageId),
    with: { tenant: true },
  });
  if (!msg) return null;

  let already = true;
  await db.transaction(async (tx) => {
    const added = await tx
      .insert(suppressions)
      .values({
        tenantId: msg.tenantId,
        channel: 'EMAIL',
        address: msg.toAddress.toLowerCase(),
        reason: 'UNSUBSCRIBE',
      })
      .onConflictDoNothing()
      .returning({ id: suppressions.id });

    if (msg.contactId) {
      await tx
        .update(contacts)
        .set({ emailStatus: 'UNSUBSCRIBED' })
        .where(and(eq(contacts.id, msg.contactId), eq(contacts.emailStatus, 'SUBSCRIBED')));
    }

    if (added.length) {
      already = false;
      await tx.insert(messageEvents).values({ messageId: msg.id, type: 'UNSUBSCRIBE', occurredAt: new Date() });
      await bumpCounter(tx, msg, 'unsubscribed');
    }
  });

  return { email: msg.toAddress, tenantName: msg.tenant.name, alreadyUnsubscribed: already };
}

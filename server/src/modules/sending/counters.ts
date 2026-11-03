import { eq, sql } from 'drizzle-orm';
import type { DB, Tx } from '../../lib/db.js';
import { automations, campaigns } from '../../db/schema.js';

export type Counter =
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'opened'
  | 'clicked'
  | 'unsubscribed'
  | 'suppressed'
  | 'failed';

const AUTOMATION_COUNTERS = new Set<Counter>(['sent', 'delivered', 'clicked']);

/** +1 on the campaign (or automation) a message belongs to. */
export async function bumpCounter(
  db: DB | Tx,
  owner: { campaignId: string | null; automationId: string | null },
  counter: Counter,
) {
  if (owner.campaignId) {
    const col = campaigns[counter];
    await db
      .update(campaigns)
      .set({ [counter]: sql`${col} + 1` })
      .where(eq(campaigns.id, owner.campaignId));
  } else if (owner.automationId && AUTOMATION_COUNTERS.has(counter)) {
    const col = automations[counter as 'sent' | 'delivered' | 'clicked'];
    await db
      .update(automations)
      .set({ [counter]: sql`${col} + 1` })
      .where(eq(automations.id, owner.automationId));
  }
}

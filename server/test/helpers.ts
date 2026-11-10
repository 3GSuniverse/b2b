import { asc, eq, sql } from 'drizzle-orm';
import { db } from '../src/lib/db.js';
import {
  campaigns,
  contacts,
  listMemberships,
  lists,
  senders,
  sendingDomains,
  tenants,
  users,
  whatsappSessions,
  type Audience,
} from '../src/db/schema.js';

export async function resetDb() {
  await db.execute(sql`
    truncate table message_events, tracked_links, automation_sends, messages, campaigns, automations,
      custom_fields, list_memberships, lists, import_jobs, suppressions, contacts, templates, whatsapp_trial_numbers,
      senders, sending_domains, audit_logs, users, tenants restart identity cascade
  `);
}

export async function makeTenant(overrides: Partial<typeof tenants.$inferInsert> = {}) {
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: 'Kurukshetra Travels',
      slug: `kt-${Math.random().toString(36).slice(2, 8)}`,
      loginCode: `kt-${Math.random().toString(36).slice(2, 10)}`,
      plan: 'PAID',
      postalAddress: '12 MG Road, Vijayawada 520010',
      ...overrides,
    })
    .returning();
  const domainName = `kt-${Math.random().toString(36).slice(2, 8)}.in`;
  const [domain] = await db
    .insert(sendingDomains)
    .values({
      tenantId: tenant!.id,
      domain: domainName,
      identityStatus: 'VERIFIED',
      dkimStatus: 'VERIFIED',
      ownershipStatus: 'VERIFIED',
    })
    .returning();
  const [sender] = await db
    .insert(senders)
    .values({
      tenantId: tenant!.id,
      domainId: domain!.id,
      fromName: 'Kurukshetra Travels',
      fromEmail: `offers@${domainName}`,
      replyTo: 'bookings@kurukshetra-travels.in',
      isDefault: true,
    })
    .returning();
  return { tenant: tenant!, sender: sender! };
}

export async function makeContact(tenantId: string, overrides: Partial<typeof contacts.$inferInsert> = {}) {
  const [c] = await db
    .insert(contacts)
    .values({
      tenantId,
      email: `user-${Math.random().toString(36).slice(2, 10)}@example.com`,
      firstName: 'Ravi',
      ...overrides,
    })
    .returning();
  return c!;
}

export async function makeList(tenantId: string, name: string, contactIds: string[]) {
  const [l] = await db.insert(lists).values({ tenantId, name }).returning();
  if (contactIds.length) {
    await db.insert(listMemberships).values(contactIds.map((contactId) => ({ listId: l!.id, contactId })));
  }
  return l!;
}

export async function makeCampaign(
  tenantId: string,
  senderId: string,
  overrides: Partial<typeof campaigns.$inferInsert> & { audience?: Audience } = {},
) {
  const [c] = await db
    .insert(campaigns)
    .values({
      tenantId,
      senderId,
      name: 'Kashi yatra',
      subject: '{first_name|Traveller}, Kashi yatra seats are open',
      previewText: 'Only 40 seats',
      html: '<html><body><p>Namaste {first_name|traveller},</p><p>Trip from {city|your city}.</p></body></html>',
      ...overrides,
    })
    .returning();
  return c!;
}

/** Collects queued ids instead of talking to Redis. */
export function fakeQueue() {
  const queued: string[] = [];
  return {
    queued,
    enqueue: async (ids: string[]) => {
      queued.push(...ids);
    },
  };
}

/**
 * A linked WhatsApp number. Numbers belong to a login: uses the agency's first login,
 * or makes an employee login for it.
 */
export async function makeLine(tenantId: string, overrides: Partial<typeof whatsappSessions.$inferInsert> = {}) {
  let userId = overrides.userId;
  if (!userId) {
    const existing = await db.query.users.findFirst({ where: eq(users.tenantId, tenantId), orderBy: [asc(users.createdAt)] });
    userId =
      existing?.id ??
      (await db.insert(users).values({ tenantId, name: 'Ravi', username: `ravi-${Math.random().toString(36).slice(2, 8)}`, passwordHash: 'x' }).returning())[0]!.id;
  }
  const [line] = await db.insert(whatsappSessions).values({ tenantId, ...overrides, userId }).returning();
  return line!;
}

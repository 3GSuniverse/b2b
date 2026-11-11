import { and, count, eq, exists, inArray, isNotNull, notExists, or, sql, type SQL } from 'drizzle-orm';
import type { DB, Tx } from '../../lib/db.js';
import { contacts, listMemberships, suppressions, users, type Audience, type AudienceFilter } from '../../db/schema.js';
import { normalizeEmail, normalizePhone } from '../contacts/normalize.js';

const CORE_FIELDS = {
  firstName: contacts.firstName,
  first_name: contacts.firstName,
  lastName: contacts.lastName,
  last_name: contacts.lastName,
  email: contacts.email,
  phone: contacts.phone,
} as const;

function fieldExpr(field: string): SQL {
  const core = CORE_FIELDS[field as keyof typeof CORE_FIELDS];
  return core ? sql`${core}` : sql`(${contacts.attributes} ->> ${field})`;
}

function escapeLike(v: string) {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function filterSql(f: AudienceFilter): SQL {
  const expr = fieldExpr(f.field);
  const value = f.value ?? '';
  switch (f.op) {
    case 'eq':
      return sql`lower(${expr}) = lower(${value})`;
    case 'neq':
      return sql`coalesce(lower(${expr}), '') <> lower(${value})`;
    case 'contains':
      return sql`${expr} ilike ${`%${escapeLike(value)}%`}`;
    case 'exists':
      return sql`nullif(${expr}, '') is not null`;
  }
}

/**
 * WHERE clause for "who receives this email".
 * Always: same tenant, subscribed to email, has an address, not on the suppression list.
 * Then: (in any of the lists OR hand-picked) — or everyone if neither is given — AND every filter.
 */
export function emailAudienceWhere(tenantId: string, audience: Audience | null | undefined): SQL {
  return audienceWhere(tenantId, audience, 'EMAIL');
}

/**
 * Same as the email audience, for WhatsApp: separate consent (whatsappStatus),
 * must have a phone number, and not on the WhatsApp suppression list.
 */
export function whatsappAudienceWhere(tenantId: string, audience: Audience | null | undefined): SQL {
  return audienceWhere(tenantId, audience, 'WHATSAPP');
}

function audienceWhere(tenantId: string, audience: Audience | null | undefined, channel: 'EMAIL' | 'WHATSAPP'): SQL {
  const address = channel === 'EMAIL' ? contacts.email : contacts.phone;
  const conditions: (SQL | undefined)[] = [
    eq(contacts.tenantId, tenantId),
    audience?.ownerId ? eq(contacts.ownerId, audience.ownerId) : undefined,
    channel === 'EMAIL' ? eq(contacts.emailStatus, 'SUBSCRIBED') : eq(contacts.whatsappStatus, 'SUBSCRIBED'),
    isNotNull(address),
    notExists(
      sql`(select 1 from ${suppressions} where ${suppressions.tenantId} = ${contacts.tenantId}
          and ${suppressions.channel} = ${channel} and ${suppressions.address} = ${address})`,
    ),
  ];

  const mode = audience?.mode;
  const listIds = mode === 'people' || mode === 'everyone' || mode === 'temporary' ? [] : (audience?.listIds?.filter(Boolean) ?? []);
  const contactIds = mode === 'lists' || mode === 'everyone' || mode === 'temporary' ? [] : (audience?.contactIds?.filter(Boolean) ?? []);
  // Lists or people chosen, but none ticked: nobody. Never fall back to everyone.
  if ((mode === 'lists' || mode === 'people') && !listIds.length && !contactIds.length) conditions.push(sql`false`);
  // Temporary lists aren't customers at all: they go through temporaryRecipients, never this query
  if (mode === 'temporary') conditions.push(sql`false`);
  if (listIds.length || contactIds.length) {
    conditions.push(
      or(
        listIds.length
          ? exists(
              sql`(select 1 from ${listMemberships} where ${listMemberships.contactId} = ${contacts.id}
                  and ${inArray(listMemberships.listId, listIds)})`,
            )
          : undefined,
        contactIds.length ? inArray(contacts.id, contactIds) : undefined,
      ),
    );
  }

  for (const f of audience?.filters ?? []) conditions.push(filterSql(f));

  return and(...conditions)!;
}

export async function countEmailAudience(db: DB | Tx, tenantId: string, audience: Audience | null | undefined) {
  if (audience?.mode === 'temporary') return (await temporaryRecipients(db, tenantId, audience, 'EMAIL')).length;
  const [row] = await db.select({ n: count() }).from(contacts).where(emailAudienceWhere(tenantId, audience));
  return row?.n ?? 0;
}

/** Walks the audience in id order, batch by batch, so a 100k-contact send never loads everything at once. */
export async function* iterateEmailAudience(
  db: DB | Tx,
  tenantId: string,
  audience: Audience | null | undefined,
  batchSize = 1000,
) {
  if (audience?.mode === 'temporary') {
    const people = await temporaryRecipients(db, tenantId, audience, 'EMAIL');
    for (let i = 0; i < people.length; i += batchSize) yield people.slice(i, i + batchSize).map((p) => ({ id: p.contactId, email: p.address }));
    return;
  }
  let after = '';
  const where = emailAudienceWhere(tenantId, audience);
  for (;;) {
    const rows = await db
      .select({ id: contacts.id, email: contacts.email })
      .from(contacts)
      .where(and(where, sql`${contacts.id} > ${after}`))
      .orderBy(contacts.id)
      .limit(batchSize);
    if (rows.length === 0) return;
    yield rows as { id: string | null; email: string }[];
    after = rows[rows.length - 1]!.id;
  }
}

export async function countWhatsAppAudience(db: DB | Tx, tenantId: string, audience: Audience | null | undefined) {
  if (audience?.mode === 'temporary') return (await temporaryRecipients(db, tenantId, audience, 'WHATSAPP')).length;
  const [row] = await db.select({ n: count() }).from(contacts).where(whatsappAudienceWhere(tenantId, audience));
  return row?.n ?? 0;
}

export async function* iterateWhatsAppAudience(db: DB | Tx, tenantId: string, audience: Audience | null | undefined, batchSize = 1000) {
  if (audience?.mode === 'temporary') {
    const people = await temporaryRecipients(db, tenantId, audience, 'WHATSAPP');
    for (let i = 0; i < people.length; i += batchSize) yield people.slice(i, i + batchSize).map((p) => ({ id: p.contactId, phone: p.address }));
    return;
  }
  let after = '';
  const where = whatsappAudienceWhere(tenantId, audience);
  for (;;) {
    const rows = await db
      .select({ id: contacts.id, phone: contacts.phone })
      .from(contacts)
      .where(and(where, sql`${contacts.id} > ${after}`))
      .orderBy(contacts.id)
      .limit(batchSize);
    if (rows.length === 0) return;
    yield rows as { id: string | null; phone: string }[];
    after = rows[rows.length - 1]!.id;
  }
}

// ---------------------------------------------------------------------------- temporary lists

export const TEMPORARY_MAX = 5000;

/** The pasted or uploaded numbers / emails, cleaned up (+91 added to 10-digit numbers) and without repeats. */
export function temporaryAddresses(audience: Audience | null | undefined, channel: 'EMAIL' | 'WHATSAPP') {
  const out = new Set<string>();
  for (const raw of audience?.addresses ?? []) {
    const a = channel === 'EMAIL' ? normalizeEmail(raw) : normalizePhone(raw);
    if (a) out.add(a);
    if (out.size >= TEMPORARY_MAX) break;
  }
  return [...out];
}

/**
 * Who in a temporary list actually gets the message. Never: anyone who unsubscribed, replied STOP,
 * bounced or complained, here or as a saved customer. Saved customers in the list are linked, so
 * {first_name} works for them; everyone else is sent to without being saved.
 */
export async function temporaryRecipients(db: DB | Tx, tenantId: string, audience: Audience, channel: 'EMAIL' | 'WHATSAPP') {
  const addresses = temporaryAddresses(audience, channel);
  if (!addresses.length) return [];
  const blocked = new Set(
    (
      await db
        .select({ address: suppressions.address })
        .from(suppressions)
        .where(and(eq(suppressions.tenantId, tenantId), eq(suppressions.channel, channel), inArray(suppressions.address, addresses)))
    ).map((r) => r.address),
  );
  const col = channel === 'EMAIL' ? sql<string>`lower(${contacts.email})` : sql<string>`${contacts.phone}`;
  const known = await db
    .select({ id: contacts.id, address: col, emailStatus: contacts.emailStatus, whatsappStatus: contacts.whatsappStatus })
    .from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), audience.ownerId ? eq(contacts.ownerId, audience.ownerId) : undefined, inArray(col, addresses)));
  const byAddress = new Map(known.map((k) => [k.address, k]));
  const out: { contactId: string | null; address: string }[] = [];
  for (const address of addresses) {
    if (blocked.has(address)) continue;
    const k = byAddress.get(address);
    if (channel === 'EMAIL') {
      if (k && k.emailStatus !== 'SUBSCRIBED') continue; // unsubscribed, bounced or complained as a customer
      out.push({ contactId: k?.id ?? null, address });
    } else {
      // WhatsApp consent of saved customers defaults to "not yet"; STOP replies are on the suppression list
      out.push({ contactId: k && k.whatsappStatus === 'SUBSCRIBED' ? k.id : null, address });
    }
  }
  return out;
}

/** An employee's audience reaches only their own customers; the owner and managers reach everyone's. */
export function scopeAudience<T extends Audience | null | undefined>(audience: T, v: { userId: string; role: string }): T | Audience {
  if (v.role !== 'MEMBER') return audience;
  return { ...(audience ?? {}), ownerId: v.userId };
}

/** At send time: an employee's campaign reaches only that employee's own customers, whatever was saved earlier. */
export async function creatorScoped(db: DB | Tx, audience: Audience | null | undefined, createdById: string | null) {
  if (!createdById) return audience;
  const u = await db.select({ role: users.role }).from(users).where(eq(users.id, createdById)).limit(1);
  return u[0]?.role === 'MEMBER' ? scopeAudience(audience, { userId: createdById, role: 'MEMBER' }) : audience;
}

import { and, count, eq, exists, inArray, isNotNull, notExists, or, sql, type SQL } from 'drizzle-orm';
import type { DB, Tx } from '../../lib/db.js';
import { contacts, listMemberships, suppressions, type Audience, type AudienceFilter } from '../../db/schema.js';

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
    channel === 'EMAIL' ? eq(contacts.emailStatus, 'SUBSCRIBED') : eq(contacts.whatsappStatus, 'SUBSCRIBED'),
    isNotNull(address),
    notExists(
      sql`(select 1 from ${suppressions} where ${suppressions.tenantId} = ${contacts.tenantId}
          and ${suppressions.channel} = ${channel} and ${suppressions.address} = ${address})`,
    ),
  ];

  const mode = audience?.mode;
  const listIds = mode === 'people' || mode === 'everyone' ? [] : (audience?.listIds?.filter(Boolean) ?? []);
  const contactIds = mode === 'lists' || mode === 'everyone' ? [] : (audience?.contactIds?.filter(Boolean) ?? []);
  // Lists or people chosen, but none ticked: nobody. Never fall back to everyone.
  if ((mode === 'lists' || mode === 'people') && !listIds.length && !contactIds.length) conditions.push(sql`false`);
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
    yield rows as { id: string; email: string }[];
    after = rows[rows.length - 1]!.id;
  }
}

export async function countWhatsAppAudience(db: DB | Tx, tenantId: string, audience: Audience | null | undefined) {
  const [row] = await db.select({ n: count() }).from(contacts).where(whatsappAudienceWhere(tenantId, audience));
  return row?.n ?? 0;
}

export async function* iterateWhatsAppAudience(db: DB | Tx, tenantId: string, audience: Audience | null | undefined, batchSize = 1000) {
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
    yield rows as { id: string; phone: string }[];
    after = rows[rows.length - 1]!.id;
  }
}

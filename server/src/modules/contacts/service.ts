import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, customFields, listMemberships, lists, suppressions, type Contact } from '../../db/schema.js';
import { db, type Tx } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { normalizeEmail, normalizePhone, parseDateValue } from './normalize.js';

type FieldDef = { key: string; type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' };

/** Converts a raw value to the field's type. Returns undefined when it can't be converted. */
export function coerceAttribute(value: unknown, type: FieldDef['type']): string | number | boolean | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  switch (type) {
    case 'DATE':
      return parseDateValue(value) ?? undefined;
    case 'NUMBER': {
      const n = Number(String(value).replace(/[,\s₹]/g, ''));
      return Number.isFinite(n) ? n : undefined;
    }
    case 'BOOLEAN': {
      const v = String(value).trim().toLowerCase();
      if (['true', 'yes', 'y', '1', 'haan', 'ha'].includes(v)) return true;
      if (['false', 'no', 'n', '0', 'nahi'].includes(v)) return false;
      return undefined;
    }
    default:
      return String(value).trim().slice(0, 500);
  }
}

export async function fieldDefs(dbx: Tx | typeof db, tenantId: string): Promise<Map<string, FieldDef>> {
  const rows = await dbx.select({ key: customFields.key, type: customFields.type }).from(customFields).where(eq(customFields.tenantId, tenantId));
  return new Map(rows.map((r) => [r.key, r]));
}

/** Validates attributes against the tenant's custom fields. Unknown keys are kept as text. */
export function cleanAttributes(input: Record<string, unknown>, defs: Map<string, FieldDef>) {
  const out: Record<string, string | number | boolean | null> = {};
  const errors: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    const def = defs.get(k);
    const coerced = coerceAttribute(v, def?.type ?? 'TEXT');
    if (coerced === undefined) {
      errors[k] = def?.type === 'DATE' ? 'Use a date like 20/11/2026' : `Not a valid ${def?.type.toLowerCase()}`;
    } else out[k] = coerced;
  }
  return { attributes: out, errors };
}

// ---------------------------------------------------------------------

export type ContactWithLists = Contact & { lists: { list: { id: string; name: string } }[] };

export function contactDto(c: ContactWithLists) {
  return {
    id: c.id,
    email: c.email,
    phone: c.phone,
    firstName: c.firstName,
    lastName: c.lastName,
    attributes: c.attributes,
    emailStatus: c.emailStatus,
    whatsappStatus: c.whatsappStatus,
    consentSource: c.consentSource,
    consentAt: c.consentAt,
    lists: c.lists.map((m) => ({ id: m.list.id, name: m.list.name })),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

const withLists = { lists: { with: { list: { columns: { id: true, name: true } } } } } as const;

export const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['SUBSCRIBED', 'UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED']).optional(),
  listId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function listContacts(tenantId: string, q: z.infer<typeof listQuery>) {
  const where: SQL[] = [eq(contacts.tenantId, tenantId)];
  if (q.status) where.push(eq(contacts.emailStatus, q.status));
  if (q.listId) {
    // Spelled out: inside relational queries Drizzle re-targets other tables' columns to the root alias
    where.push(sql`exists (select 1 from list_memberships m where m.contact_id = "contacts"."id" and m.list_id = ${q.listId})`);
  }
  if (q.search) {
    const term = `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const digits = q.search.replace(/\D/g, '');
    where.push(
      or(
        ilike(contacts.email, term),
        ilike(contacts.firstName, term),
        ilike(contacts.lastName, term),
        sql`(${contacts.firstName} || ' ' || coalesce(${contacts.lastName}, '')) ilike ${term}`,
        ...(digits.length >= 4 ? [ilike(contacts.phone, `%${digits}%`)] : []),
      )!,
    );
  }
  const condition = and(...where);
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db.query.contacts.findMany({
      where: condition,
      with: withLists,
      orderBy: [desc(contacts.createdAt), desc(contacts.id)],
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    }),
    db.select({ total: count() }).from(contacts).where(condition),
  ]);
  return {
    contacts: rows.map(contactDto),
    page: q.page,
    pageSize: q.pageSize,
    total,
    pages: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

/** Numbers for the status tabs: All · Subscribed · Unsubscribed · Bounced · Complained */
export async function contactStats(tenantId: string) {
  const rows = await db
    .select({ status: contacts.emailStatus, n: count() })
    .from(contacts)
    .where(eq(contacts.tenantId, tenantId))
    .groupBy(contacts.emailStatus);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  return {
    all: rows.reduce((a, r) => a + r.n, 0),
    subscribed: by.SUBSCRIBED ?? 0,
    unsubscribed: by.UNSUBSCRIBED ?? 0,
    bounced: by.BOUNCED ?? 0,
    complained: by.COMPLAINED ?? 0,
  };
}

async function getOwned(tenantId: string, id: string) {
  const c = await db.query.contacts.findFirst({ where: and(eq(contacts.id, id), eq(contacts.tenantId, tenantId)), with: withLists });
  if (!c) throw new AppError(404, 'contact_not_found', 'Contact not found');
  return c;
}

export async function getContact(tenantId: string, id: string) {
  return contactDto(await getOwned(tenantId, id));
}

async function assertListsOwned(tenantId: string, listIds: string[]) {
  if (!listIds.length) return;
  const found = await db.select({ id: lists.id }).from(lists).where(and(eq(lists.tenantId, tenantId), inArray(lists.id, listIds)));
  if (found.length !== new Set(listIds).size) throw new AppError(404, 'list_not_found', 'One of the lists was not found');
}

/** A suppressed address stays suppressed even if it is deleted and added again. */
async function statusFromSuppression(dbx: Tx | typeof db, tenantId: string, email: string | null) {
  if (!email) return 'SUBSCRIBED' as const;
  const s = await dbx.query.suppressions.findFirst({
    where: and(eq(suppressions.tenantId, tenantId), eq(suppressions.channel, 'EMAIL'), eq(suppressions.address, email)),
  });
  if (!s) return 'SUBSCRIBED' as const;
  return s.reason === 'HARD_BOUNCE' ? ('BOUNCED' as const) : s.reason === 'COMPLAINT' ? ('COMPLAINED' as const) : ('UNSUBSCRIBED' as const);
}

export const createContactBody = z
  .object({
    email: z.string().trim().max(254).optional(),
    phone: z.string().trim().max(30).optional(),
    firstName: z.string().trim().max(100).optional(),
    lastName: z.string().trim().max(100).optional(),
    attributes: z.record(z.string(), z.unknown()).default({}),
    listIds: z.array(z.string()).max(50).default([]),
    whatsappOptIn: z.boolean().default(false),
    consentNote: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.email || v.phone, { message: 'Enter an email or a phone number', path: ['email'] });

export async function createContact(tenantId: string, input: z.infer<typeof createContactBody>) {
  const email = input.email ? normalizeEmail(input.email) : null;
  if (input.email && !email) throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: { email: 'Enter a valid email address' } });
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.phone && !phone) throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: { phone: 'Enter a valid phone number' } });

  const defs = await fieldDefs(db, tenantId);
  const { attributes, errors } = cleanAttributes(input.attributes, defs);
  if (Object.keys(errors).length) throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: errors });
  await assertListsOwned(tenantId, input.listIds);

  const dup = await db.query.contacts.findFirst({
    where: and(eq(contacts.tenantId, tenantId), or(email ? eq(contacts.email, email) : undefined, phone ? eq(contacts.phone, phone) : undefined)),
    columns: { id: true },
  });
  if (dup) throw new AppError(409, 'contact_exists', 'A contact with this email or phone already exists', { contactId: dup.id });

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(contacts)
      .values({
        tenantId,
        email,
        phone,
        firstName: input.firstName || null,
        lastName: input.lastName || null,
        attributes,
        emailStatus: await statusFromSuppression(tx, tenantId, email),
        whatsappStatus: input.whatsappOptIn && phone ? 'SUBSCRIBED' : 'UNSUBSCRIBED',
        consentSource: input.consentNote ? `manual: ${input.consentNote}` : 'manual',
        consentAt: new Date(),
      })
      .returning({ id: contacts.id });
    if (input.listIds.length) {
      await tx.insert(listMemberships).values(input.listIds.map((listId) => ({ listId, contactId: row!.id }))).onConflictDoNothing();
    }
    return row!.id;
  });
  return getContact(tenantId, id);
}

export const updateContactBody = z.object({
  firstName: z.string().trim().max(100).nullable().optional(),
  lastName: z.string().trim().max(100).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(), // merged into existing
  emailStatus: z.enum(['SUBSCRIBED', 'UNSUBSCRIBED']).optional(),
  // Re-subscribing someone who unsubscribed needs a reason, so it's on record
  resubscribeReason: z.string().trim().min(5).max(200).optional(),
  whatsappOptIn: z.boolean().optional(),
});

export async function updateContact(tenantId: string, id: string, input: z.infer<typeof updateContactBody>) {
  const c = await getOwned(tenantId, id);
  const patch: Partial<typeof contacts.$inferInsert> = {};

  if (input.firstName !== undefined) patch.firstName = input.firstName || null;
  if (input.lastName !== undefined) patch.lastName = input.lastName || null;
  if (input.phone !== undefined) {
    const phone = input.phone ? normalizePhone(input.phone) : null;
    if (input.phone && !phone) throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: { phone: 'Enter a valid phone number' } });
    if (phone) {
      const taken = await db.query.contacts.findFirst({ where: and(eq(contacts.tenantId, tenantId), eq(contacts.phone, phone)), columns: { id: true } });
      if (taken && taken.id !== id) throw new AppError(409, 'contact_exists', 'Another contact already has this phone number');
    }
    patch.phone = phone;
  }
  if (input.attributes) {
    const { attributes, errors } = cleanAttributes(input.attributes, await fieldDefs(db, tenantId));
    if (Object.keys(errors).length) throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: errors });
    const merged = { ...(c.attributes as Record<string, unknown>), ...attributes };
    for (const [k, v] of Object.entries(merged)) if (v === null) delete merged[k];
    patch.attributes = merged;
  }
  if (input.whatsappOptIn !== undefined) {
    patch.whatsappStatus = input.whatsappOptIn && (patch.phone ?? c.phone) ? 'SUBSCRIBED' : 'UNSUBSCRIBED';
  }

  await db.transaction(async (tx) => {
    if (input.emailStatus && input.emailStatus !== c.emailStatus) {
      if (input.emailStatus === 'UNSUBSCRIBED') {
        patch.emailStatus = 'UNSUBSCRIBED';
        if (c.email) {
          await tx.insert(suppressions).values({ tenantId, address: c.email, reason: 'UNSUBSCRIBE', note: 'manual' }).onConflictDoNothing();
        }
      } else {
        // Bounced addresses don't exist; complainers explicitly asked to be left alone.
        if (c.emailStatus === 'BOUNCED' || c.emailStatus === 'COMPLAINED') {
          throw new AppError(409, 'cannot_resubscribe', c.emailStatus === 'BOUNCED'
            ? 'This address bounced — it doesn’t exist or can’t receive email. Add a corrected address instead.'
            : 'This person reported your email as spam, so they can’t be re-subscribed.');
        }
        if (!input.resubscribeReason) {
          throw new AppError(400, 'validation_failed', 'Some fields need attention', {
            fields: { resubscribeReason: 'Say how this person asked to be subscribed again' },
          });
        }
        patch.emailStatus = 'SUBSCRIBED';
        patch.consentSource = `resubscribed: ${input.resubscribeReason}`;
        patch.consentAt = new Date();
        if (c.email) {
          await tx
            .delete(suppressions)
            .where(and(eq(suppressions.tenantId, tenantId), eq(suppressions.address, c.email), eq(suppressions.reason, 'UNSUBSCRIBE')));
        }
      }
    }
    if (Object.keys(patch).length) await tx.update(contacts).set(patch).where(eq(contacts.id, id));
  });
  return getContact(tenantId, id);
}

/** Permanent erase (privacy requests). Suppression entries stay, so they're never emailed again by mistake. */
export async function deleteContacts(tenantId: string, ids: string[]) {
  if (!ids.length) return 0;
  const gone = await db
    .delete(contacts)
    .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, ids)))
    .returning({ id: contacts.id });
  return gone.length;
}

// ---------------------------------------------------------------------
//  Lists
// ---------------------------------------------------------------------

export async function listLists(tenantId: string) {
  return db
    .select({
      id: lists.id,
      name: lists.name,
      description: lists.description,
      createdAt: lists.createdAt,
      members: sql<number>`(select count(*)::int from ${listMemberships} m where m.list_id = "lists"."id")`,
      // "lists"."id" spelled out: inside the subquery an unqualified "id" would mean the contact's id
      subscribed: sql<number>`(select count(*)::int from ${listMemberships} m join ${contacts} c on c.id = m.contact_id
        where m.list_id = "lists"."id" and c.email_status = 'SUBSCRIBED')`,
    })
    .from(lists)
    .where(eq(lists.tenantId, tenantId))
    .orderBy(lists.name);
}

export async function createList(tenantId: string, name: string, description?: string) {
  const [row] = await db.insert(lists).values({ tenantId, name, description }).onConflictDoNothing().returning();
  if (!row) throw new AppError(409, 'list_exists', `A list called "${name}" already exists`);
  return row;
}

async function ownedList(tenantId: string, id: string) {
  const l = await db.query.lists.findFirst({ where: and(eq(lists.id, id), eq(lists.tenantId, tenantId)) });
  if (!l) throw new AppError(404, 'list_not_found', 'List not found');
  return l;
}

export async function updateList(tenantId: string, id: string, input: { name?: string; description?: string | null }) {
  await ownedList(tenantId, id);
  try {
    const [row] = await db.update(lists).set(input).where(eq(lists.id, id)).returning();
    return row!;
  } catch {
    throw new AppError(409, 'list_exists', `A list called "${input.name}" already exists`);
  }
}

export async function deleteList(tenantId: string, id: string) {
  await ownedList(tenantId, id);
  await db.delete(lists).where(eq(lists.id, id)); // contacts stay; only membership goes
}

export async function addToList(tenantId: string, listId: string, contactIds: string[]) {
  await ownedList(tenantId, listId);
  const owned = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, contactIds)));
  if (!owned.length) return 0;
  const added = await db
    .insert(listMemberships)
    .values(owned.map((c) => ({ listId, contactId: c.id })))
    .onConflictDoNothing()
    .returning({ id: listMemberships.contactId });
  return added.length;
}

export async function removeFromList(tenantId: string, listId: string, contactIds: string[]) {
  await ownedList(tenantId, listId);
  const removed = await db
    .delete(listMemberships)
    .where(and(eq(listMemberships.listId, listId), inArray(listMemberships.contactId, contactIds)))
    .returning({ id: listMemberships.contactId });
  return removed.length;
}

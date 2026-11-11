import { and, eq, inArray, sql } from 'drizzle-orm';
import { contacts, importJobs, listMemberships, suppressions } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { ensureField } from '../contacts/fields.js';
import { fieldKey, normalizeEmail, normalizePhone } from '../contacts/normalize.js';
import { coerceAttribute, fieldDefs } from '../contacts/service.js';
import { autoMap, detectType, readCsv, splitFullName, type ColumnTarget } from './mapping.js';
import { notify } from '../notifications/service.js';

const BATCH = 500;
const MAX_STORED_ERRORS = 500;

interface Row {
  line: number; // spreadsheet row number (header is row 1)
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  attributes: Record<string, string | number | boolean>;
}

export interface ImportResult {
  totalRows: number;
  imported: number;
  updated: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

/**
 * Imports one CSV into a company's contacts.
 *  - dedupes inside the file and against existing contacts (by email, then phone)
 *  - never re-subscribes someone who unsubscribed, bounced or complained
 *  - creates custom fields for unknown columns, detecting date columns
 *  - records a reason for every skipped row
 */
export async function processImport(jobId: string): Promise<ImportResult> {
  const job = await db.query.importJobs.findFirst({ where: eq(importJobs.id, jobId) });
  if (!job) throw new Error(`Import ${jobId} not found`);
  if (job.status === 'COMPLETED') {
    return { totalRows: job.totalRows, imported: job.imported, updated: job.updated, skipped: job.skipped, errors: job.errors ?? [] };
  }
  await db.update(importJobs).set({ status: 'PROCESSING' }).where(eq(importJobs.id, jobId));

  try {
    const result = await run(job);
    await db
      .update(importJobs)
      .set({
        status: 'COMPLETED',
        totalRows: result.totalRows,
        imported: result.imported,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors.slice(0, MAX_STORED_ERRORS),
        completedAt: new Date(),
        sourceCsv: null, // don't keep people's data around longer than needed
      })
      .where(eq(importJobs.id, jobId));
    await notify(job.tenantId, {
      type: 'import.completed',
      level: result.skipped ? 'WARNING' : 'SUCCESS',
      title: `${job.fileName} imported`,
      body: `${result.imported.toLocaleString('en-IN')} new, ${result.updated.toLocaleString('en-IN')} updated${result.skipped ? `, ${result.skipped.toLocaleString('en-IN')} skipped` : ''}.`,
      link: `/contacts/imports/${jobId}`,
      dedupeKey: `import.completed:${jobId}`,
    });
    return result;
  } catch (err) {
    await db
      .update(importJobs)
      .set({ status: 'FAILED', errors: [{ row: 0, reason: (err as Error).message }], completedAt: new Date(), sourceCsv: null })
      .where(eq(importJobs.id, jobId));
    throw err;
  }
}

async function run(job: typeof importJobs.$inferSelect): Promise<ImportResult> {
  const tenantId = job.tenantId;
  // The imported people join the importer's own list of customers
  const ownerId = job.createdById;
  const { headers, rows } = readCsv(job.sourceCsv ?? '');
  const mapping: Record<string, ColumnTarget> = { ...autoMap(headers), ...(job.options?.mapping as Record<string, ColumnTarget> | undefined) };
  const updateExisting = job.options?.updateExisting ?? true;
  const errors: ImportResult['errors'] = [];
  const skip = (line: number, reason: string) => errors.push({ row: line, reason });

  // Custom fields for attribute columns (created if new, type detected)
  const defs = await fieldDefs(db, tenantId);
  for (const [i, h] of headers.entries()) {
    const target = mapping[h];
    if (!target?.startsWith('attr:')) continue;
    const key = target.slice(5);
    if (!defs.has(key)) {
      // Auto-mapped column → keep the header as the label; user-chosen key → label from the key
      const label = fieldKey(h) === key ? h : key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
      const f = await ensureField(db, tenantId, label, detectType(h, rows.map((r) => r[i] ?? '')));
      defs.set(f.key, { key: f.key, type: f.type });
      if (f.key !== key) mapping[h] = `attr:${f.key}`;
    }
  }

  // 1. Parse + validate every row, dedupe within the file
  const parsed: Row[] = [];
  const seenEmail = new Map<string, number>();
  const seenPhone = new Map<string, number>();
  rows.forEach((cells, idx) => {
    const line = idx + 2;
    const r: Row = { line, email: null, phone: null, firstName: null, lastName: null, attributes: {} };
    let rawEmail = '';
    let rawPhone = '';
    headers.forEach((h, i) => {
      const v = (cells[i] ?? '').trim();
      const t = mapping[h];
      if (!t || t === 'skip' || !v) return;
      if (t === 'email') rawEmail = v;
      else if (t === 'phone') rawPhone = v;
      else if (t === 'firstName') r.firstName = v.slice(0, 100);
      else if (t === 'lastName') r.lastName = v.slice(0, 100);
      else if (t === 'fullName') Object.assign(r, splitFullName(v.slice(0, 200)));
      else if (t.startsWith('attr:')) {
        const key = t.slice(5);
        const c = coerceAttribute(v, defs.get(key)?.type ?? 'TEXT');
        if (c !== undefined && c !== null) r.attributes[key] = c;
      }
    });

    if (rawEmail) {
      r.email = normalizeEmail(rawEmail);
      if (!r.email) return skip(line, `Invalid email “${rawEmail.slice(0, 60)}”`);
    }
    if (rawPhone) r.phone = normalizePhone(rawPhone); // a bad phone alone doesn't skip the row
    if (!r.email && !r.phone) return skip(line, rawPhone ? `Invalid phone “${rawPhone.slice(0, 30)}” and no email` : 'No email or phone');

    if (r.email) {
      const first = seenEmail.get(r.email);
      if (first) return skip(line, `Same email as row ${first}`);
      seenEmail.set(r.email, line);
    }
    if (r.phone) {
      const first = seenPhone.get(r.phone);
      if (first) {
        if (!r.email) return skip(line, `Same phone as row ${first}`);
        r.phone = null; // keep the email contact, drop the duplicate phone
      } else seenPhone.set(r.phone, line);
    }
    parsed.push(r);
  });

  // 2. A phone that already belongs to a different existing contact is dropped, not stolen
  const phones = parsed.filter((r) => r.phone).map((r) => r.phone!);
  const phoneOwners = new Map<string, string | null>();
  for (let i = 0; i < phones.length; i += 1000) {
    const found = await db
      .select({ phone: contacts.phone, email: contacts.email })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), ownerId ? eq(contacts.ownerId, ownerId) : undefined, inArray(contacts.phone, phones.slice(i, i + 1000))));
    for (const f of found) phoneOwners.set(f.phone!, f.email);
  }
  for (const r of parsed) {
    if (r.phone && r.email && phoneOwners.has(r.phone) && phoneOwners.get(r.phone) !== r.email) r.phone = null;
  }

  // 3. People on the suppression list come in unsubscribed/bounced — never re-subscribed by an import
  const emails = parsed.filter((r) => r.email).map((r) => r.email!);
  const suppressed = new Map<string, string>();
  for (let i = 0; i < emails.length; i += 1000) {
    const found = await db
      .select({ address: suppressions.address, reason: suppressions.reason })
      .from(suppressions)
      .where(and(eq(suppressions.tenantId, tenantId), eq(suppressions.channel, 'EMAIL'), inArray(suppressions.address, emails.slice(i, i + 1000))));
    for (const f of found) suppressed.set(f.address, f.reason);
  }
  const statusFor = (email: string | null): 'SUBSCRIBED' | 'UNSUBSCRIBED' | 'BOUNCED' | 'COMPLAINED' => {
    const reason = email ? suppressed.get(email) : undefined;
    return reason === 'HARD_BOUNCE' ? 'BOUNCED' : reason === 'COMPLAINT' ? 'COMPLAINED' : reason ? 'UNSUBSCRIBED' : 'SUBSCRIBED';
  };

  // 4. Upsert in batches
  const consentSource = `import: ${job.fileName}`.slice(0, 200);
  const now = new Date();
  let imported = 0;
  let updated = 0;
  const contactIds: string[] = [];

  const upsert = async (batch: Row[], by: 'email' | 'phone') => {
    if (!batch.length) return;
    const target = by === 'email' ? [contacts.tenantId, contacts.ownerId, contacts.email] : [contacts.tenantId, contacts.ownerId, contacts.phone];
    const set = updateExisting
      ? {
          firstName: sql`coalesce(excluded.first_name, ${contacts.firstName})`,
          lastName: sql`coalesce(excluded.last_name, ${contacts.lastName})`,
          phone: by === 'email' ? sql`coalesce(${contacts.phone}, excluded.phone)` : sql`${contacts.phone}`,
          email: by === 'phone' ? sql`coalesce(${contacts.email}, excluded.email)` : sql`${contacts.email}`,
          attributes: sql`${contacts.attributes} || excluded.attributes`,
          updatedAt: now,
        }
      : { updatedAt: sql`${contacts.updatedAt}` }; // no-op, but returns the row so it joins the list
    const out = await db
      .insert(contacts)
      .values(
        batch.map((r) => ({
          tenantId,
          ownerId,
          email: r.email,
          phone: r.phone,
          firstName: r.firstName,
          lastName: r.lastName,
          attributes: r.attributes,
          emailStatus: statusFor(r.email),
          consentSource,
          consentAt: now,
        })),
      )
      .onConflictDoUpdate({ target, set })
      .returning({ id: contacts.id, inserted: sql<boolean>`(xmax = 0)` });
    for (const o of out) {
      contactIds.push(o.id);
      if (o.inserted) imported++;
      else updated++;
    }
  };

  const byEmail = parsed.filter((r) => r.email);
  const byPhone = parsed.filter((r) => !r.email);
  for (let i = 0; i < byEmail.length; i += BATCH) await upsert(byEmail.slice(i, i + BATCH), 'email');
  for (let i = 0; i < byPhone.length; i += BATCH) await upsert(byPhone.slice(i, i + BATCH), 'phone');

  // 5. Add everyone to the chosen list
  if (job.listId) {
    for (let i = 0; i < contactIds.length; i += 1000) {
      await db
        .insert(listMemberships)
        .values(contactIds.slice(i, i + 1000).map((contactId) => ({ listId: job.listId!, contactId })))
        .onConflictDoNothing();
    }
  }

  errors.sort((a, b) => a.row - b.row);
  return { totalRows: rows.length, imported, updated, skipped: errors.length, errors };
}

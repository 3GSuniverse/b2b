import { parse } from 'csv-parse/sync';
import { AppError } from '../../lib/http.js';
import { fieldKey, parseDateValue, RESERVED_KEYS } from '../contacts/normalize.js';

/** What a CSV column becomes: a core field, a custom attribute ("attr:city"), or nothing. */
export type ColumnTarget = 'email' | 'phone' | 'firstName' | 'lastName' | 'fullName' | 'skip' | `attr:${string}`;

const ALIASES: Record<string, ColumnTarget> = {
  email: 'email', emailaddress: 'email', emailid: 'email', mail: 'email', mailid: 'email', eaddress: 'email',
  phone: 'phone', phoneno: 'phone', phonenumber: 'phone', mobile: 'phone', mobileno: 'phone', mobilenumber: 'phone',
  cell: 'phone', contactno: 'phone', contactnumber: 'phone', whatsapp: 'phone', whatsappno: 'phone', whatsappnumber: 'phone',
  firstname: 'firstName', fname: 'firstName', givenname: 'firstName',
  lastname: 'lastName', lname: 'lastName', surname: 'lastName', familyname: 'lastName',
  name: 'fullName', fullname: 'fullName', customername: 'fullName', contactname: 'fullName', clientname: 'fullName',
  id: 'skip', sno: 'skip', slno: 'skip', serialno: 'skip', srno: 'skip',
};

const squash = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

export const MAX_IMPORT_ROWS = 100_000;

/** Parses a CSV into a header row and data rows. Handles BOM, quotes, ragged rows, Excel's ; separator. */
export function readCsv(text: string): { headers: string[]; rows: string[][] } {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'));
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      delimiter,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: true,
    }) as string[][];
  } catch (err) {
    throw new AppError(400, 'invalid_csv', `This file couldn’t be read as CSV: ${(err as Error).message.split('\n')[0]}`);
  }
  const nonEmpty = records.filter((r) => r.some((c) => c !== ''));
  if (nonEmpty.length < 2) throw new AppError(400, 'empty_csv', 'The file needs a header row and at least one contact');
  if (nonEmpty.length - 1 > MAX_IMPORT_ROWS) {
    throw new AppError(400, 'too_many_rows', `Import up to ${MAX_IMPORT_ROWS.toLocaleString('en-IN')} contacts at a time`);
  }
  const headers = nonEmpty[0]!.map((h, i) => h || `Column ${i + 1}`);
  return { headers, rows: nonEmpty.slice(1) };
}

/** Guesses what each column is from its header. The user can change it before importing. */
export function autoMap(headers: string[]): Record<string, ColumnTarget> {
  const out: Record<string, ColumnTarget> = {};
  const hasFirst = headers.some((h) => ALIASES[squash(h)] === 'firstName');
  for (const h of headers) {
    let target = ALIASES[squash(h)];
    if (!target) {
      const key = fieldKey(h);
      target = key && !RESERVED_KEYS.has(key) ? `attr:${key}` : 'skip';
    }
    // "Name" next to an explicit "First name" column is most likely a company/other name
    if (target === 'fullName' && hasFirst) target = `attr:${fieldKey(h)}`;
    if (Object.values(out).includes(target) && !target.startsWith('attr:') && target !== 'skip') target = 'skip';
    out[h] = target;
  }
  return out;
}

const DATEY = /date|dob|birth|anniversary|travel|departure|return|expiry/i;

/** A new column becomes a DATE field when its name sounds like a date and most values parse as one. */
export function detectType(header: string, values: string[]): 'DATE' | 'TEXT' {
  if (!DATEY.test(header)) return 'TEXT';
  const filled = values.filter(Boolean).slice(0, 200);
  if (!filled.length) return 'TEXT';
  const ok = filled.filter((v) => parseDateValue(v)).length;
  return ok / filled.length >= 0.8 ? 'DATE' : 'TEXT';
}

export function splitFullName(full: string): { firstName: string | null; lastName: string | null } {
  // "Reddy, Suresh" — surname first, as many records write it
  const comma = full.match(/^\s*([^,]+),\s*(.+)$/);
  if (comma) return { firstName: comma[2]!.trim(), lastName: comma[1]!.trim() };
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: null, lastName: null };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(' ') || null };
}

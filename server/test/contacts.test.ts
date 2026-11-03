import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { contacts, customFields, suppressions } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { normalizeEmail, normalizePhone, parseDateValue } from '../src/modules/contacts/normalize.js';
import { autoMap } from '../src/modules/imports/mapping.js';
import { api, multipart, signup } from './api-helpers.js';
import { resetDb } from './helpers.js';

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  app = await buildApp({ authRateLimit: 10_000 });
});
afterAll(async () => {
  await app.close();
  await closeRedis();
  await closeDatabase();
});
beforeEach(resetDb);

function upload(cookie: string, name: string, csv: string, fields: Record<string, string> = {}, url = '/api/imports') {
  const m = multipart(name, csv, { consentConfirmed: 'true', ...fields });
  return app.inject({ method: 'POST', url, headers: { ...m.headers, cookie }, payload: m.payload });
}

describe('normalising what people type', () => {
  it('phone numbers become +91 E.164', () => {
    expect(normalizePhone('98480 12345')).toBe('+919848012345');
    expect(normalizePhone('098480-12345')).toBe('+919848012345');
    expect(normalizePhone('+91 98480 12345')).toBe('+919848012345');
    expect(normalizePhone('919848012345')).toBe('+919848012345');
    expect(normalizePhone('+1 (415) 555-2671')).toBe('+14155552671');
    expect(normalizePhone('12345')).toBeNull();
  });

  it('dates the way Indian spreadsheets write them', () => {
    expect(parseDateValue('20/11/2026')).toBe('2026-11-20');
    expect(parseDateValue('20-11-26')).toBe('2026-11-20');
    expect(parseDateValue('2026-11-20')).toBe('2026-11-20');
    expect(parseDateValue('20 Nov 2026')).toBe('2026-11-20');
    expect(parseDateValue('Nov 20, 2026')).toBe('2026-11-20');
    expect(parseDateValue('31/02/2026')).toBeNull();
    expect(parseDateValue('soon')).toBeNull();
  });

  it('emails', () => {
    expect(normalizeEmail('  Ravi.K@Gmail.COM ')).toBe('ravi.k@gmail.com');
    expect(normalizeEmail('ravi@')).toBeNull();
  });

  it('guesses CSV columns', () => {
    expect(autoMap(['Name', 'E-mail', 'Mobile No.', 'City', 'Trip Date', 'S.No'])).toEqual({
      Name: 'fullName',
      'E-mail': 'email',
      'Mobile No.': 'phone',
      City: 'attr:city',
      'Trip Date': 'attr:trip_date',
      'S.No': 'skip',
    });
  });
});

describe('contacts API', () => {
  it('adds, finds, filters and pages contacts', async () => {
    const { cookie } = await signup(app);
    const c = api(app, cookie);
    const ravi = await c.post('/api/contacts', { email: 'Ravi@Example.com', firstName: 'Ravi', phone: '98480 12345', attributes: { city: 'Guntur' } });
    expect(ravi.statusCode).toBe(201);
    expect(ravi.json().contact).toMatchObject({ email: 'ravi@example.com', phone: '+919848012345', emailStatus: 'SUBSCRIBED', consentSource: 'manual' });
    await c.post('/api/contacts', { email: 'lakshmi@example.com', firstName: 'Lakshmi' });

    expect((await c.post('/api/contacts', { email: 'ravi@example.com' })).statusCode).toBe(409);
    expect((await c.get('/api/contacts?search=laks')).json().contacts.map((x: { firstName: string }) => x.firstName)).toEqual(['Lakshmi']);
    expect((await c.get('/api/contacts?search=48012')).json().total).toBe(1); // by phone digits
    const page = (await c.get('/api/contacts?pageSize=1&page=2')).json();
    expect(page).toMatchObject({ total: 2, pages: 2, page: 2 });
  });

  it('validates typed custom fields', async () => {
    const { cookie } = await signup(app);
    const c = api(app, cookie);
    await c.post('/api/fields', { label: 'Trip date', type: 'DATE' });
    const bad = await c.post('/api/contacts', { email: 'a@b.in', attributes: { trip_date: 'next week' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().details.fields.trip_date).toMatch(/date/);
    const ok = await c.post('/api/contacts', { email: 'a@b.in', attributes: { trip_date: '20/11/2026' } });
    expect(ok.json().contact.attributes.trip_date).toBe('2026-11-20');
  });

  it('unsubscribing by hand suppresses; re-subscribing needs a reason; complainers can never be re-subscribed', async () => {
    const { cookie, json } = await signup(app);
    const c = api(app, cookie);
    const id = (await c.post('/api/contacts', { email: 'a@b.in' })).json().contact.id;

    await c.patch(`/api/contacts/${id}`, { emailStatus: 'UNSUBSCRIBED' });
    expect(await db.select().from(suppressions)).toHaveLength(1);

    expect((await c.patch(`/api/contacts/${id}`, { emailStatus: 'SUBSCRIBED' })).statusCode).toBe(400);
    const back = await c.patch(`/api/contacts/${id}`, { emailStatus: 'SUBSCRIBED', resubscribeReason: 'Asked again at our counter on 3 Nov' });
    expect(back.json().contact.emailStatus).toBe('SUBSCRIBED');
    expect(await db.select().from(suppressions)).toHaveLength(0);

    await db.update(contacts).set({ emailStatus: 'COMPLAINED' }).where(eq(contacts.id, id));
    expect((await c.patch(`/api/contacts/${id}`, { emailStatus: 'SUBSCRIBED', resubscribeReason: 'please please' })).statusCode).toBe(409);
    expect(json.tenant.id).toBeTruthy();
  });

  it('a deleted unsubscriber who is added again stays unsubscribed', async () => {
    const { cookie } = await signup(app);
    const c = api(app, cookie);
    const id = (await c.post('/api/contacts', { email: 'gone@b.in' })).json().contact.id;
    await c.patch(`/api/contacts/${id}`, { emailStatus: 'UNSUBSCRIBED' });
    expect((await c.del(`/api/contacts/${id}`)).statusCode).toBe(204);
    const again = await c.post('/api/contacts', { email: 'gone@b.in' });
    expect(again.json().contact.emailStatus).toBe('UNSUBSCRIBED');
  });

  it('lists: create, add members, counts', async () => {
    const { cookie } = await signup(app);
    const c = api(app, cookie);
    const a = (await c.post('/api/contacts', { email: 'a@b.in' })).json().contact.id;
    const b = (await c.post('/api/contacts', { email: 'b@b.in' })).json().contact.id;
    const list = (await c.post('/api/lists', { name: 'Pilgrimage enquiries' })).json().list;
    expect((await c.post('/api/lists', { name: 'Pilgrimage enquiries' })).statusCode).toBe(409);
    expect((await c.post(`/api/lists/${list.id}/members`, { contactIds: [a, b, a] })).json().added).toBe(2);
    const [row] = (await c.get('/api/lists')).json().lists;
    expect(row).toMatchObject({ name: 'Pilgrimage enquiries', members: 2, subscribed: 2 });
    expect((await c.get(`/api/contacts?listId=${list.id}`)).json().total).toBe(2);
  });

  it('companies never see each other’s contacts', async () => {
    const a = await signup(app);
    const b = await signup(app);
    const id = (await api(app, a.cookie).post('/api/contacts', { email: 'secret@client.in' })).json().contact.id;
    const other = api(app, b.cookie);
    expect((await other.get(`/api/contacts/${id}`)).statusCode).toBe(404);
    expect((await other.get('/api/contacts')).json().total).toBe(0);
    expect((await other.post('/api/contacts/delete', { contactIds: [id] })).json().deleted).toBe(0);
    const list = (await other.post('/api/lists', { name: 'mine' })).json().list;
    expect((await other.post(`/api/lists/${list.id}/members`, { contactIds: [id] })).json().added).toBe(0);
  });
});

describe('CSV import', () => {
  const messy = [
    'S.No,Name,E-mail,Mobile No.,City,Trip Date',
    '1,Ravi Kumar,RAVI@example.com,98480 12345,Guntur,20/11/2026',
    '2,Lakshmi Prasanna,lakshmi@example.com,,Vijayawada,25-11-2026',
    '3,Duplicate Ravi,ravi@example.com,,Guntur,',
    '4,No Contact,,,,',
    '5,Broken,not-an-email,,,',
    '6,Phone Only,,+91 99632 44120,Tirupati,',
    '7,"Reddy, Suresh",suresh@example.com,9000477812,"Hyderabad, TS",1 Dec 2026',
  ].join('\r\n');

  it('previews columns and the guessed mapping before importing', async () => {
    const { cookie } = await signup(app);
    const res = await upload(cookie, 'leads.csv', messy, {}, '/api/imports/preview');
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.totalRows).toBe(7);
    expect(p.mapping['Trip Date']).toBe('attr:trip_date');
    expect(p.detectedTypes['Trip Date']).toBe('DATE');
    expect(p.detectedTypes.City).toBe('TEXT');
    expect(p.hasEmailColumn).toBe(true);
  });

  it('imports a messy spreadsheet and explains every skipped row', async () => {
    const { cookie } = await signup(app);
    const res = await upload(cookie, 'leads-november.csv', messy, { newListName: 'November leads' });
    expect(res.statusCode).toBe(201);
    const r = res.json().import;
    expect(r).toMatchObject({ totalRows: 7, imported: 4, updated: 0, skipped: 3 });
    expect(r.errors).toEqual([
      { row: 4, reason: 'Same email as row 2' },
      { row: 5, reason: 'No email or phone' },
      { row: 6, reason: 'Invalid email “not-an-email”' },
    ]);

    const all = (await api(app, cookie).get('/api/contacts?pageSize=100')).json().contacts;
    const ravi = all.find((c: { email: string }) => c.email === 'ravi@example.com');
    expect(ravi).toMatchObject({ firstName: 'Ravi', lastName: 'Kumar', phone: '+919848012345', attributes: { city: 'Guntur', trip_date: '2026-11-20' } });
    expect(ravi.consentSource).toBe('import: leads-november.csv');
    expect(ravi.lists[0].name).toBe('November leads');
    const suresh = all.find((c: { email: string }) => c.email === 'suresh@example.com');
    expect(suresh).toMatchObject({ firstName: 'Suresh', lastName: 'Reddy', attributes: { city: 'Hyderabad, TS', trip_date: '2026-12-01' } });
    expect(all.find((c: { phone: string }) => c.phone === '+919963244120').email).toBeNull();

    const [field] = await db.select().from(customFields).where(eq(customFields.key, 'trip_date'));
    expect(field!.type).toBe('DATE');
  });

  it('re-importing updates instead of duplicating, and never re-subscribes anyone', async () => {
    const { cookie, json } = await signup(app);
    await upload(cookie, 'a.csv', 'email,first name\nravi@example.com,Ravi\nlakshmi@example.com,Lakshmi');
    await db.update(contacts).set({ emailStatus: 'UNSUBSCRIBED' }).where(eq(contacts.email, 'lakshmi@example.com'));
    await db.insert(suppressions).values({ tenantId: json.tenant.id, address: 'lakshmi@example.com', reason: 'UNSUBSCRIBE' });
    await db.insert(suppressions).values({ tenantId: json.tenant.id, address: 'bounced@example.com', reason: 'HARD_BOUNCE' });

    const r = (await upload(cookie, 'b.csv', 'email,first name,city\nravi@example.com,Ravi K,Guntur\nlakshmi@example.com,Lakshmi,Vizag\nbounced@example.com,Old,')).json().import;
    expect(r).toMatchObject({ imported: 1, updated: 2 });

    const rows = await db.select().from(contacts).where(eq(contacts.tenantId, json.tenant.id));
    const by = Object.fromEntries(rows.map((c) => [c.email, c]));
    expect(by['ravi@example.com']!.firstName).toBe('Ravi K');
    expect(by['ravi@example.com']!.attributes).toEqual({ city: 'Guntur' });
    expect(by['lakshmi@example.com']!.emailStatus).toBe('UNSUBSCRIBED');
    expect(by['bounced@example.com']!.emailStatus).toBe('BOUNCED');
  });

  it('can import without overwriting existing details', async () => {
    const { cookie } = await signup(app);
    await upload(cookie, 'a.csv', 'email,first name\nravi@example.com,Ravi');
    const r = (await upload(cookie, 'b.csv', 'email,first name\nravi@example.com,WRONG', { updateExisting: 'false' })).json().import;
    expect(r).toMatchObject({ imported: 0, updated: 1 });
    const [c] = await db.select().from(contacts);
    expect(c!.firstName).toBe('Ravi');
  });

  it('does not steal a phone number that belongs to another contact', async () => {
    const { cookie } = await signup(app);
    await upload(cookie, 'a.csv', 'email,phone\nravi@example.com,9848012345');
    await upload(cookie, 'b.csv', 'email,phone\nother@example.com,9848012345');
    const rows = await db.select().from(contacts);
    expect(rows.find((c) => c.email === 'other@example.com')!.phone).toBeNull();
    expect(rows.find((c) => c.email === 'ravi@example.com')!.phone).toBe('+919848012345');
  });

  it('requires consent confirmation, a CSV file, and readable content', async () => {
    const { cookie } = await signup(app);
    const m = multipart('a.csv', 'email\na@b.in');
    const noConsent = await app.inject({ method: 'POST', url: '/api/imports', headers: { ...m.headers, cookie }, payload: m.payload });
    expect(noConsent.statusCode).toBe(400);
    expect(noConsent.json().details.fields.consentConfirmed).toMatch(/agreed/);
    expect((await upload(cookie, 'contacts.xlsx', 'PK..binary')).statusCode).toBe(400);
    expect((await upload(cookie, 'empty.csv', 'email\n')).json().error).toBe('empty_csv');
  });

  it('accepts semicolon CSVs from European Excel and custom column mapping', async () => {
    const { cookie } = await signup(app);
    const r = (await upload(cookie, 'eu.csv', 'Kunde;Mail;Ort\nAnil;anil@x.in;Pune', { mapping: JSON.stringify({ Kunde: 'firstName', Mail: 'email', Ort: 'attr:city' }) })).json().import;
    expect(r.imported).toBe(1);
    const [c] = await db.select().from(contacts);
    expect(c).toMatchObject({ firstName: 'Anil', email: 'anil@x.in', attributes: { city: 'Pune' } });
  });
});

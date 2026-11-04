import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { apiKeys, contacts, notifications, trips, users } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { api, signup } from './api-helpers.js';
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

const lead = (key: string, payload: object) => app.inject({ method: 'POST', url: '/api/v1/leads', headers: { authorization: `Bearer ${key}` }, payload });

describe('API keys', () => {
  it('shown once, stored only as a hash, listed without the secret, revocable', async () => {
    const { cookie } = await signup(app);
    const c = api(app, cookie);
    const r = await c.post('/api/api-keys', { name: 'AI call agent' });
    expect(r.statusCode).toBe(201);
    const { key, apiKey } = r.json();
    expect(key).toMatch(/^hy_live_[A-Za-z0-9]{32}$/);
    const row = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, apiKey.id) });
    expect(row!.keyHash).not.toContain(key);
    expect(JSON.stringify((await c.get('/api/api-keys')).json())).not.toContain(key);

    expect((await app.inject({ method: 'GET', url: '/api/v1/ping', headers: { authorization: `Bearer ${key}` } })).json()).toMatchObject({ ok: true, key: 'AI call agent' });
    expect((await c.del(`/api/api-keys/${apiKey.id}`)).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/v1/ping', headers: { authorization: `Bearer ${key}` } })).statusCode).toBe(401);
  });

  it('only admins manage keys; a wrong or missing key is refused', async () => {
    const { cookie, json } = await signup(app);
    await db.update(users).set({ role: 'MEMBER' }).where(eq(users.id, json.user.id));
    expect((await api(app, cookie).post('/api/api-keys', { name: 'x' })).statusCode).toBe(403);
    expect((await lead('hy_live_notarealkey', { name: 'A', phone: '9000000001' })).json().error).toBe('invalid_api_key');
    expect((await app.inject({ method: 'POST', url: '/api/v1/leads', payload: { name: 'A' } })).json().error).toBe('missing_api_key');
  });
});

describe('POST /api/v1/leads', () => {
  it('adds an enquiry from the call agent, with the contact, and tells the company', async () => {
    const { cookie, json } = await signup(app);
    const { key } = (await api(app, cookie).post('/api/api-keys', { name: 'AI call agent' })).json();
    const r = await lead(key, { name: 'Suresh Nair', phone: '+91 98480 55555', destination: 'Goa', startDate: '2026-12-24', endDate: '2026-12-28', adults: 4, budget: '60,000', notes: 'Wants a beach-facing hotel.', externalId: 'call_8812' });
    expect(r.statusCode).toBe(201);
    const trip = await db.query.trips.findFirst({ where: eq(trips.id, r.json().trip.id), with: { contact: true } });
    expect(trip).toMatchObject({ status: 'ENQUIRY', source: 'CALL_AGENT', destination: 'Goa', adults: 4, budget: 6_000_000, externalRef: 'call_8812', createdById: null });
    expect(trip!.contact).toMatchObject({ phone: '+919848055555', firstName: 'Suresh', consentSource: 'api: AI call agent', whatsappStatus: 'UNSUBSCRIBED' });
    const n = await db.select().from(notifications).where(eq(notifications.tenantId, json.tenant.id));
    expect(n.map((x) => x.title)).toContain('New enquiry from AI call agent: Suresh Nair, Goa');
  });

  it('the same call sent twice is one enquiry', async () => {
    const { cookie } = await signup(app);
    const { key } = (await api(app, cookie).post('/api/api-keys', { name: 'Agent' })).json();
    const body = { name: 'Asha', phone: '9000000002', externalId: 'call_1' };
    const [a, b] = await Promise.all([lead(key, body), lead(key, body)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect((await lead(key, body)).json()).toMatchObject({ duplicate: true });
    expect(await db.select().from(trips)).toHaveLength(1);
    expect(await db.select().from(contacts)).toHaveLength(1);
  });

  it('a key only adds to its own company', async () => {
    const a = await signup(app);
    const b = await signup(app);
    const { key } = (await api(app, a.cookie).post('/api/api-keys', { name: 'Agent' })).json();
    await lead(key, { name: 'X', email: 'x@example.com' });
    expect((await api(app, b.cookie).get('/api/trips')).json().total).toBe(0);
    expect((await api(app, a.cookie).get('/api/trips')).json().total).toBe(1);
  });

  it('needs a name and a way to reach them', async () => {
    const { cookie } = await signup(app);
    const { key } = (await api(app, cookie).post('/api/api-keys', { name: 'Agent' })).json();
    const r = await lead(key, { name: 'No number' });
    expect(r.statusCode).toBe(400);
    expect(r.json().details.fields.phone).toBe('Send a phone or an email');
  });
});

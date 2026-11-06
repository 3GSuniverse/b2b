import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { campaigns, contacts, messages, senders, sendingDomains, tenants } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { startCampaign } from '../src/modules/sending/start-campaign.js';
import { api, signup } from './api-helpers.js';
import { fakeQueue, resetDb } from './helpers.js';

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

const login = (payload: object) => app.inject({ method: 'POST', url: '/api/auth/login', payload });
const cookieOf = (r: Awaited<ReturnType<typeof login>>) => `sid=${r.cookies.find((c) => c.name === 'sid')!.value}`;

describe('agency owner and employees', () => {
  it('the owner creates employees, who sign in with the agency ID and a username', async () => {
    const owner = await signup(app, { companyName: 'Kurukshetra Travels' });
    const me = (await api(app, owner.cookie).get('/api/auth/me')).json();
    expect(me.tenant.loginCode).toBe('kurukshetra-travels');
    expect(me.user.role).toBe('OWNER');

    const c = api(app, owner.cookie);
    const r = await c.post('/api/agency/employees', { name: 'Ravi Kumar', username: 'Ravi', password: 'ravi-pass-1' });
    expect(r.statusCode).toBe(201);
    expect(r.json().member).toMatchObject({ username: 'ravi', role: 'MEMBER', email: null });
    expect((await c.post('/api/agency/employees', { name: 'Other Ravi', username: 'ravi', password: 'xxxxxxxx' })).json().error).toBe('username_taken');

    // A second agency can't be used to guess
    expect((await login({ agency: 'kurukshetra-travels', username: 'ravi', password: 'wrong-pass' })).statusCode).toBe(401);
    const ok = await login({ agency: 'Kurukshetra-Travels', username: 'RAVI', password: 'ravi-pass-1' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user).toMatchObject({ name: 'Ravi Kumar', role: 'MEMBER' });

    // Employees can work but can't see the agency console or pay
    const ravi = api(app, cookieOf(ok));
    expect((await ravi.get('/api/agency')).statusCode).toBe(403);
    expect((await ravi.post('/api/billing/orders', { plan: 'team5', period: 'month' })).statusCode).toBe(403);
    expect((await ravi.get('/api/trips')).statusCode).toBe(200);
  });

  it('switching a login off signs them out; a new password signs them out too', async () => {
    const owner = await signup(app, { companyName: 'Sai Yatra' });
    const c = api(app, owner.cookie);
    const id = (await c.post('/api/agency/employees', { name: 'Priya', username: 'priya', password: 'priya-pass-1' })).json().member.id;
    const s = cookieOf(await login({ agency: 'sai-yatra', username: 'priya', password: 'priya-pass-1' }));
    expect((await api(app, s).get('/api/auth/me')).statusCode).toBe(200);

    await c.patch(`/api/agency/employees/${id}`, { disabled: true });
    expect((await api(app, s).get('/api/auth/me')).statusCode).toBe(401);
    expect((await login({ agency: 'sai-yatra', username: 'priya', password: 'priya-pass-1' })).json().error).toBe('login_disabled');

    await c.patch(`/api/agency/employees/${id}`, { disabled: false, password: 'new-pass-22' });
    expect((await login({ agency: 'sai-yatra', username: 'priya', password: 'new-pass-22' })).statusCode).toBe(200);
  });

  it('the plan sets how many employee logins there can be', async () => {
    const owner = await signup(app);
    const c = api(app, owner.cookie);
    for (let i = 1; i <= 5; i++) expect((await c.post('/api/agency/employees', { name: `E${i}`, username: `emp${i}`, password: 'password-1' })).statusCode).toBe(201);
    const sixth = await c.post('/api/agency/employees', { name: 'E6', username: 'emp6', password: 'password-1' });
    expect(sixth.json().error).toBe('seats_full');

    await db.update(tenants).set({ plan: 'PAID', planId: 'team10', paidUntil: new Date(Date.now() + 20 * 86_400_000) }).where(eq(tenants.id, owner.json.tenant.id));
    expect((await c.post('/api/agency/employees', { name: 'E6', username: 'emp6', password: 'password-1' })).statusCode).toBe(201);
    // With 6 logins, the 5-login plan can't be bought
    expect((await c.get('/api/billing')).json().options.team5.month).toMatchObject({ ok: false, reason: 'too_small' });
  });

  it('the owner can change the agency ID; it must be free', async () => {
    const a = await signup(app, { companyName: 'Alpha Tours' });
    await signup(app, { companyName: 'Beta Tours' });
    expect((await api(app, a.cookie).patch('/api/agency/id', { loginCode: 'beta-tours' })).json().error).toBe('code_taken');
    expect((await api(app, a.cookie).patch('/api/agency/id', { loginCode: 'alpha' })).json()).toEqual({ loginCode: 'alpha' });
  });

  it('anyone can change their own password', async () => {
    const owner = await signup(app);
    const c = api(app, owner.cookie);
    expect((await c.post('/api/auth/password', { current: 'nope', next: 'brand-new-pass' })).json().error).toBe('wrong_password');
    expect((await c.post('/api/auth/password', { current: 'correct-horse-battery', next: 'brand-new-pass' })).statusCode).toBe(200);
    expect((await login({ email: owner.body.email, password: 'brand-new-pass' })).statusCode).toBe(200);
  });
});

describe('what each employee sends', () => {
  it('counts each person’s emails and WhatsApp messages this month, and automatic ones apart', async () => {
    const owner = await signup(app, { companyName: 'Count Travels' });
    const tenantId = owner.json.tenant.id;
    const c = api(app, owner.cookie);
    const ravi = (await c.post('/api/agency/employees', { name: 'Ravi', username: 'ravi', password: 'ravi-pass-1' })).json().member;
    const [domain] = await db.insert(sendingDomains).values({ tenantId, domain: 'count.in', identityStatus: 'VERIFIED', dkimStatus: 'VERIFIED', ownershipStatus: 'VERIFIED' }).returning();
    await db.update(tenants).set({ postalAddress: '1 MG Road' }).where(eq(tenants.id, tenantId));
    const [sender] = await db.insert(senders).values({ tenantId, domainId: domain!.id, fromName: 'Count', fromEmail: 'hi@count.in', isDefault: true }).returning();
    await db.insert(contacts).values([1, 2, 3].map((i) => ({ tenantId, email: `c${i}@example.com`, phone: `+9190000000${i}`, whatsappStatus: 'SUBSCRIBED' as const })));
    const [camp] = await db.insert(campaigns).values({ tenantId, name: 'Diwali', subject: 'Hi', html: '<p>Hi</p>', senderId: sender!.id, createdById: ravi.id }).returning();
    await startCampaign(camp!.id, { enqueue: fakeQueue().enqueue });
    await db.update(messages).set({ sentAt: new Date() }).where(eq(messages.campaignId, camp!.id));
    await db.insert(messages).values({ tenantId, channel: 'WHATSAPP', toAddress: '+919000000001', sentAt: new Date() }); // a reminder

    const t = (await c.get('/api/agency')).json();
    expect(t.seats).toEqual({ used: 1, limit: 5 });
    expect(t.people.find((p: { id: string }) => p.id === ravi.id).usage).toMatchObject({ email: 3, whatsapp: 0, broadcasts: 1 });
    expect(t.automatic).toMatchObject({ email: 0, whatsapp: 1 });
    expect(t.totals).toEqual({ email: 3, whatsapp: 1 });
  });
});

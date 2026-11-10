import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { packages, trips, tripDues, tripPayments } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { setAiClient } from '../src/modules/ai/quote-draft.js';
import { recordIncoming } from '../src/modules/inbox/service.js';
import { api, signup } from './api-helpers.js';
import { makeContact, resetDb, makeLine } from './helpers.js';

let app: Awaited<ReturnType<typeof buildApp>>;
const calls: { system: string; prompt: string }[] = [];
let answer = '';
beforeAll(async () => {
  app = await buildApp({ authRateLimit: 10_000 });
});
afterAll(async () => {
  await app.close();
  await closeRedis();
  await closeDatabase();
});
beforeEach(async () => {
  calls.length = 0;
  answer = JSON.stringify({ situation: 'price_enquiry', language: 'Telugu', reply: 'నమస్కారం రవి గారు 🙏 కేరళ 3 రాత్రుల ప్యాకేజీ ఒక్కరికి ₹18,500.', needsHuman: false, note: null });
  setAiClient({
    async complete(input) {
      calls.push(input);
      return `Here you go:\n${answer}`;
    },
  });
  await resetDb();
});
afterEach(() => setAiClient(null));

describe('Drona AI: suggested replies on WhatsApp', () => {
  it('answers from the agency’s packages, the customer’s trip and the conversation', async () => {
    const owner = await signup(app, { companyName: 'Sai Travels' });
    const tenantId = owner.json.tenant.id;
    const c = api(app, owner.cookie);
    const ravi = await makeContact(tenantId, { phone: '+919848012345', firstName: 'Ravi' });
    await db.insert(packages).values({ tenantId, name: 'Kerala Houseboat', destination: 'Kerala', nights: 3, pricePerAdult: 1_850_000, inclusions: ['Houseboat stay', 'All meals'] });
    const [trip] = await db.insert(trips).values({ tenantId, number: 7, contactId: ravi.id, customerName: 'Ravi', title: 'Ravi, Kerala', destination: 'Kerala', startDate: '2026-12-20', adults: 4, price: 7_400_000, status: 'BOOKED' }).returning();
    await db.insert(tripDues).values({ tenantId, tripId: trip!.id, label: 'Advance', amount: 2_000_000, dueDate: '2026-11-10', position: 0 });
    await db.insert(tripPayments).values({ tenantId, tripId: trip!.id, amount: 500_000, receiptNumber: 1, paidAt: new Date('2026-11-01'), method: 'UPI' });
    await c.put('/api/ai/notes', { aiNotes: 'Office hours 9 am to 8 pm. We accept UPI and bank transfer.' });
    const chatId = await recordIncoming(tenantId, (await makeLine(tenantId, { userId: owner.json.user.id })).id, { phone: '+919848012345', text: 'కేరళ ప్యాకేజీ ధర ఎంత?', waId: 'w1', at: new Date() });

    const r = await c.post(`/api/inbox/${chatId}/suggest`, { hint: 'mention the December offer' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ situation: 'price_enquiry', language: 'Telugu', needsHuman: false });
    expect(r.json().reply).toContain('₹18,500');

    const { system, prompt } = calls[0]!;
    expect(system).toContain('Sai Travels');
    expect(system).toMatch(/Never invent prices/);
    expect(prompt).toContain('Kerala Houseboat (Kerala): 3 nights, ₹18,500 per adult');
    expect(prompt).toContain('paid ₹5,000, balance ₹69,000, next due ₹15,000 on 2026-11-10');
    expect(prompt).toContain('Office hours 9 am to 8 pm');
    expect(prompt).toContain('Customer, ');
    expect(prompt).toContain('కేరళ ప్యాకేజీ ధర ఎంత?');
    expect(prompt).toContain('mention the December offer');
  });

  it('says so when there is nothing to answer, a bad answer, or no AI set up', async () => {
    const owner = await signup(app);
    const tenantId = owner.json.tenant.id;
    const c = api(app, owner.cookie);
    const chatId = await recordIncoming(tenantId, (await makeLine(tenantId, { userId: owner.json.user.id })).id, { phone: '+919000000001', text: 'Hello', waId: 'w2', at: new Date() });
    answer = 'Sorry, I cannot help';
    expect((await c.post(`/api/inbox/${chatId}/suggest`, {})).json().error).toBe('ai_bad_answer');
    setAiClient(null);
    // No AI key on this test server
    expect((await c.post(`/api/inbox/${chatId}/suggest`, {})).statusCode).toBe(503);
  });

  it('keeps each agency’s conversations and notes to itself; employees can’t change the notes', async () => {
    const a = await signup(app);
    const b = await signup(app);
    const chatId = await recordIncoming(a.json.tenant.id, (await makeLine(a.json.tenant.id, { userId: a.json.user.id })).id, { phone: '+919000000002', text: 'Hi', waId: 'w3', at: new Date() });
    expect((await api(app, b.cookie).post(`/api/inbox/${chatId}/suggest`, {})).statusCode).toBe(404);
    const emp = await api(app, a.cookie).post('/api/agency/employees', { name: 'E', username: 'emp1', password: 'password-1' });
    expect(emp.statusCode).toBe(201);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { agency: a.json.tenant.loginCode, username: 'emp1', password: 'password-1' } });
    const cookie = `sid=${login.cookies.find((x) => x.name === 'sid')!.value}`;
    expect((await api(app, cookie).put('/api/ai/notes', { aiNotes: 'x' })).statusCode).toBe(403);
    expect((await api(app, cookie).get('/api/ai/notes')).statusCode).toBe(200);
  });
});

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { messages, notifications, quotes, tenants, tripDues, trips } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { setAiClient } from '../src/modules/ai/quote-draft.js';
import { runTripFollowups } from '../src/modules/trips/followups.js';
import { api, signup } from './api-helpers.js';
import { resetDb } from './helpers.js';

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  app = await buildApp({ authRateLimit: 10_000 });
});
afterAll(async () => {
  setAiClient(null);
  await app.close();
  await closeRedis();
  await closeDatabase();
});
beforeEach(resetDb);

async function setup() {
  const s = await signup(app);
  const c = api(app, s.cookie);
  const trip = (await c.post('/api/trips', { customer: { name: 'Lakshmi Prasad', phone: '9848012345', email: 'lakshmi@example.com' }, destination: 'Kerala', startDate: '2026-12-12', endDate: '2026-12-16', adults: 4 })).json().trip;
  const houseboat = (await c.post('/api/rates', { kind: 'HOTEL', name: 'Houseboat, deluxe room', destination: 'Kerala', unit: 'PER_NIGHT', price: '9,500', cost: '7,000' })).json().rate;
  const car = (await c.post('/api/rates', { kind: 'TRANSPORT', name: 'Innova Crysta with driver', destination: 'Kerala', unit: 'PER_DAY', price: 4200 })).json().rate;
  await c.post('/api/rates', { kind: 'HOTEL', name: 'Taj, sea view', destination: 'Goa', unit: 'PER_NIGHT', price: 12000 });
  return { ...s, c, trip, houseboat, car };
}

const lines = (houseboat: { id: string }, car: { id: string }) => [
  { label: 'Houseboat, deluxe room', kind: 'HOTEL', unit: 'PER_NIGHT', quantity: 2, times: 4, unitPrice: 950_000, unitCost: 700_000, rateItemId: houseboat.id },
  { label: 'Innova Crysta with driver', kind: 'TRANSPORT', unit: 'PER_DAY', quantity: 1, times: 5, unitPrice: 420_000, unitCost: 300_000, rateItemId: car.id },
];

describe('price list', () => {
  it('rates for the destination come first; archived ones disappear', async () => {
    const { c, houseboat } = await setup();
    const names = (await c.get('/api/rates?destination=Goa')).json().rates.map((r: { name: string }) => r.name);
    expect(names[0]).toBe('Taj, sea view');
    expect((await c.post('/api/rates', { kind: 'HOTEL', name: 'X', unit: 'PER_NIGHT', price: 'abc' })).json().details.fields.price).toBe('Enter an amount like 4,500');
    expect((await c.del(`/api/rates/${houseboat.id}`)).statusCode).toBe(204);
    expect((await c.get('/api/rates')).json().rates).toHaveLength(2);
  });
});

describe('quotes', () => {
  it('starts from the trip: one day per day of the trip, sensible inclusions, valid a week', async () => {
    const { c, trip } = await setup();
    const q = (await c.post(`/api/trips/${trip.id}/quotes`)).json().quote;
    expect(q).toMatchObject({ version: 1, status: 'DRAFT' });
    expect(q.days).toHaveLength(5);
    expect(q.days[0].title).toBe('Arrival');
    expect(q.inclusions.length).toBeGreaterThan(0);
    expect(q.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('totals, per person and the private margin are worked out here', async () => {
    const { c, trip, houseboat, car } = await setup();
    const q = (await c.post(`/api/trips/${trip.id}/quotes`)).json().quote;
    const saved = (await c.patch(`/api/quotes/${q.id}`, { lines: lines(houseboat, car), discount: 100_000 })).json().quote;
    // 2 rooms × 4 nights × 9,500 + 1 car × 5 days × 4,200 − 1,000
    expect(saved.totals).toEqual({ subtotal: 9_700_000, discount: 100_000, total: 9_600_000, perPerson: 2_400_000, margin: 9_600_000 - (5_600_000 + 1_500_000) });
    expect(saved.lines[0].total).toBe(7_600_000);
  });

  it('sending marks the trip as quoted at that price; a sent quote is fixed; a new version copies it', async () => {
    const { c, trip, houseboat, car } = await setup();
    const q = (await c.post(`/api/trips/${trip.id}/quotes`)).json().quote;
    expect((await c.post(`/api/quotes/${q.id}/send`, { via: 'MANUAL' })).json().error).toBe('quote_empty');
    await c.patch(`/api/quotes/${q.id}`, { lines: lines(houseboat, car) });
    const sent = (await c.post(`/api/quotes/${q.id}/send`, { via: 'MANUAL' })).json().quote;
    expect(sent.status).toBe('SENT');
    const t = (await c.get(`/api/trips/${trip.id}`)).json().trip;
    expect(t).toMatchObject({ status: 'QUOTED', price: 9_700_000 });
    expect((await c.patch(`/api/quotes/${q.id}`, { discount: 5 })).json().error).toBe('quote_sent');
    const v2 = (await c.post(`/api/trips/${trip.id}/quotes`)).json().quote;
    expect(v2).toMatchObject({ version: 2, status: 'DRAFT' });
    expect(v2.lines).toHaveLength(2);
  });

  it('by email: a message with the link goes to the customer', async () => {
    const { c, trip, houseboat, car } = await setup();
    const q = (await c.post(`/api/trips/${trip.id}/quotes`)).json().quote;
    await c.patch(`/api/quotes/${q.id}`, { lines: lines(houseboat, car) });
    // The signup company has no sending address yet
    expect((await c.post(`/api/quotes/${q.id}/send`, { via: 'EMAIL' })).json().error).toBe('no_sender');
  });
});

describe('the customer’s quote page', () => {
  async function sentQuote() {
    const s = await setup();
    const q = (await s.c.post(`/api/trips/${s.trip.id}/quotes`)).json().quote;
    await s.c.patch(`/api/quotes/${q.id}`, { lines: lines(s.houseboat, s.car), days: [{ title: 'Arrive in Kochi', description: 'Pickup at the airport, drive to Munnar.' }] });
    await s.c.post(`/api/quotes/${q.id}/send`, { via: 'MANUAL' });
    const token = q.url.split('/q/')[1];
    return { ...s, q, token };
  }

  it('shows the plan, the package and the total, never the line prices or the margin', async () => {
    const { token } = await sentQuote();
    const r = await app.inject({ method: 'GET', url: `/q/${token}` });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('Arrive in Kochi');
    expect(r.body).toContain('₹97,000');
    expect(r.body).toContain('₹24,250 per person');
    expect(r.body).toContain('Houseboat, deluxe room');
    expect(r.body).toContain('2 × 4 nights');
    expect(r.body).not.toContain('₹9,500'); // the unit price
    expect(r.body).not.toContain('₹7,000'); // the cost
    expect(r.body).toContain('Accept this quote');
    const q = await db.query.quotes.findFirst({ where: eq(quotes.publicToken, token) });
    expect(q!.viewedAt).toBeTruthy();
  });

  it('accepting: the price and the usual advance + balance are set, and the agency is told', async () => {
    const { token, trip, json } = await sentQuote();
    const r = await app.inject({ method: 'POST', url: `/q/${token}/accept` });
    expect(r.statusCode).toBe(303);
    const page = await app.inject({ method: 'GET', url: `/q/${token}` });
    expect(page.body).toContain('Accepted on');
    expect(page.body).toContain('/p/');
    const dues = await db.select().from(tripDues).where(eq(tripDues.tripId, trip.id));
    expect(dues.map((d) => d.label)).toEqual(['Advance', 'Balance']);
    expect(dues.reduce((a, d) => a + d.amount, 0)).toBe(9_700_000);
    const n = await db.select().from(notifications).where(eq(notifications.tenantId, json.tenant.id));
    expect(n.map((x) => x.title)).toContain('Lakshmi Prasad accepted the quote for Kerala trip');
  });

  it('asking for changes records the note and tells the agency', async () => {
    const { token, json } = await sentQuote();
    await app.inject({ method: 'POST', url: `/q/${token}/decline`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'note=Can+we+do+a+cheaper+hotel%3F' });
    const q = await db.query.quotes.findFirst({ where: eq(quotes.publicToken, token) });
    expect(q).toMatchObject({ status: 'DECLINED', responseNote: 'Can we do a cheaper hotel?' });
    const n = await db.select().from(notifications).where(eq(notifications.tenantId, json.tenant.id));
    expect(n.find((x) => x.type === 'quotes.declined')!.body).toBe('Can we do a cheaper hotel?');
  });

  it('an old link leads to the newer version once it’s sent', async () => {
    const { c, trip, token } = await sentQuote();
    const v2 = (await c.post(`/api/trips/${trip.id}/quotes`)).json().quote;
    await c.post(`/api/quotes/${v2.id}/send`, { via: 'MANUAL' });
    const r = await app.inject({ method: 'GET', url: `/q/${token}` });
    expect(r.statusCode).toBe(303);
    expect(r.headers.location).toBe(`/q/${v2.url.split('/q/')[1]}`);
  });

  it('no reply in 2 days: one follow-up with the quote link (on by default)', async () => {
    const { q, trip, token } = await sentQuote();
    await db.update(quotes).set({ sentAt: new Date('2026-11-08T06:00:00Z') }).where(eq(quotes.id, q.id));
    const email: string[] = [];
    const opts = { now: new Date('2026-11-10T05:00:00Z'), enqueueEmail: async (ids: string[]) => void email.push(...ids), enqueueWhatsApp: async () => undefined };
    // Give the company a sending address so the follow-up can go by email
    const t = await db.query.trips.findFirst({ where: eq(trips.id, trip.id) });
    const { senders, sendingDomains } = await import('../src/db/schema.js');
    const [dom] = await db.insert(sendingDomains).values({ tenantId: t!.tenantId, domain: 'kt-test.in', identityStatus: 'VERIFIED', dkimStatus: 'VERIFIED', ownershipStatus: 'VERIFIED' }).returning();
    await db.insert(senders).values({ tenantId: t!.tenantId, domainId: dom!.id, fromName: 'KT', fromEmail: 'trips@kt-test.in', isDefault: true });
    // A fresh signup is on the 5-day trial, which would have ended by this test's "today"
    await db.update(tenants).set({ plan: 'PAID' }).where(eq(tenants.id, t!.tenantId));

    expect((await runTripFollowups(opts)).sent).toBe(1);
    expect((await runTripFollowups(opts)).sent).toBe(0);
    const msg = (await db.query.messages.findFirst({ where: eq(messages.id, email[0]!) }))!;
    expect(msg).toMatchObject({ service: true, subject: 'Your quote for Kerala trip' });
    expect(msg.body).toContain(`/q/${token}`);
  });

  it('no follow-up when switched off', async () => {
    const { q, trip } = await sentQuote();
    await db.update(quotes).set({ sentAt: new Date('2026-11-08T06:00:00Z') }).where(eq(quotes.id, q.id));
    const t = await db.query.trips.findFirst({ where: eq(trips.id, trip.id) });
    await db.update(tenants).set({ tripMessageSettings: { quoteFollowup: { enabled: false } } }).where(eq(tenants.id, t!.tenantId));
    expect((await runTripFollowups({ now: new Date('2026-11-10T05:00:00Z'), enqueueEmail: async () => undefined, enqueueWhatsApp: async () => undefined })).sent).toBe(0);
  });
});

describe('Draft with AI', () => {
  it('hidden without a key', async () => {
    setAiClient(null);
    const { c, trip } = await setup();
    expect((await c.get('/api/ai')).json().enabled).toBe(false);
    const q = (await c.post(`/api/trips/${trip.id}/quotes`)).json().quote;
    expect((await c.post(`/api/quotes/${q.id}/draft`, {})).json().error).toBe('ai_not_configured');
  });

  it('prices come from the price list, never from the AI; unknown items come back at ₹0 to price', async () => {
    const { c, trip, houseboat } = await setup();
    let prompt = '';
    setAiClient({
      async complete(input) {
        prompt = input.prompt;
        return `Here you go:\n${JSON.stringify({
          intro: 'A relaxed Kerala trip.',
          days: [{ title: 'Arrive in Kochi', description: 'Drive to Munnar.' }],
          items: [
            { rateId: houseboat.id, label: 'whatever', kind: 'OTHER', unit: 'PER_GROUP', quantity: 2, times: 4 },
            { rateId: null, label: 'Kathakali show tickets', kind: 'ACTIVITY', unit: 'PER_PERSON', quantity: 4, times: 1 },
          ],
          inclusions: ['Breakfast'],
          exclusions: ['Flights'],
        })}`;
      },
    });
    expect((await c.get('/api/ai')).json().enabled).toBe(true);
    const q = (await c.post(`/api/trips/${trip.id}/quotes`)).json().quote;
    const r = await c.post(`/api/quotes/${q.id}/draft`, { language: 'te', instructions: 'Houseboat on the last night' });
    expect(r.statusCode).toBe(200);
    const draft = r.json().draft;
    expect(draft.lines[0]).toMatchObject({ label: 'Houseboat, deluxe room', kind: 'HOTEL', unit: 'PER_NIGHT', unitPrice: 950_000, needsPrice: false });
    expect(draft.lines[1]).toMatchObject({ label: 'Kathakali show tickets', unitPrice: 0, needsPrice: true });
    expect(prompt).toContain('Telugu');
    expect(prompt).toContain('Houseboat on the last night');
    expect(prompt).toContain(houseboat.id);
  });

  it('a garbled answer is a clear error, not a broken quote', async () => {
    const { c, trip } = await setup();
    setAiClient({ complete: async () => 'Sorry, I cannot help with that.' });
    const q = (await c.post(`/api/trips/${trip.id}/quotes`)).json().quote;
    expect((await c.post(`/api/quotes/${q.id}/draft`, {})).json().error).toBe('ai_bad_answer');
  });
});

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { contacts, messages, trips, type TripMessageSettings } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { MemoryEmailProvider } from '../src/modules/email/memory-provider.js';
import { processSendJob } from '../src/modules/sending/send-message.js';
import { runTripFollowups } from '../src/modules/trips/followups.js';
import { addDays } from '../src/modules/trips/money.js';
import { api, signup } from './api-helpers.js';
import { makeContact, makeTenant, resetDb } from './helpers.js';

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

const NOW = new Date('2026-11-10T05:00:00Z'); // 10:30 in India
const TODAY = '2026-11-10';
const REVIEW_URL = 'https://g.page/r/kurukshetra/review';
const ALL_ON: TripMessageSettings = { preTrip: { enabled: true }, review: { enabled: true, url: REVIEW_URL }, whereNext: { enabled: true } };

function q() {
  const email: string[] = [];
  return { email, opts: { enqueueEmail: async (ids: string[]) => void email.push(...ids), enqueueWhatsApp: async () => undefined } };
}

async function trip(settings: TripMessageSettings, t: { status: 'BOOKED' | 'COMPLETED'; start: number; end?: number }, contact: Partial<typeof contacts.$inferInsert> = {}) {
  const { tenant } = await makeTenant({ tripMessageSettings: settings });
  const c = await makeContact(tenant.id, { firstName: 'Lakshmi', email: 'lakshmi@example.com', ...contact });
  const [row] = await db
    .insert(trips)
    .values({ tenantId: tenant.id, number: 1, status: t.status, contactId: c.id, customerName: 'Lakshmi Prasad', title: 'Kerala backwaters', destination: 'Kerala', startDate: addDays(TODAY, t.start), endDate: addDays(TODAY, t.end ?? t.start + 4) })
    .returning();
  return { tenant, contact: c, trip: row! };
}

describe('trip message settings', () => {
  it('a review request needs the review link, and its wording must include it', async () => {
    const { cookie } = await signup(app);
    const c = api(app, cookie);
    let r = await c.patch('/api/trips/messages', { review: { enabled: true } });
    expect(r.json().details.fields).toMatchObject({ 'review.url': 'Add your Google review link to switch this on' });
    r = await c.patch('/api/trips/messages', { review: { enabled: true, url: REVIEW_URL, text: 'Hi {first_name}, please tell us how {trip} went!' } });
    expect(r.json().details.fields['review.text']).toBe('Include {review_link}, so they can leave the review');
    r = await c.patch('/api/trips/messages', { review: { enabled: true, url: REVIEW_URL }, whereNext: { enabled: true, days: 120 } });
    expect(r.statusCode).toBe(200);
    expect(r.json().settings).toMatchObject({ review: { enabled: true, url: REVIEW_URL, days: 1 }, whereNext: { enabled: true, days: 120 }, preTrip: { enabled: false } });
  });
});

describe('trip messages', () => {
  it('nothing goes out unless the company switched it on', async () => {
    await trip({}, { status: 'BOOKED', start: 2 });
    const queue = q();
    expect(await runTripFollowups({ now: NOW, ...queue.opts })).toEqual({ sent: 0, skipped: 0 });
  });

  it('before the trip: a service message, once, even to someone who opted out of offers', async () => {
    const { trip: t } = await trip(ALL_ON, { status: 'BOOKED', start: 2 }, { emailStatus: 'UNSUBSCRIBED' });
    const queue = q();
    expect((await runTripFollowups({ now: NOW, ...queue.opts })).sent).toBe(1);
    expect((await runTripFollowups({ now: NOW, ...queue.opts })).sent).toBe(0);
    const msg = (await db.query.messages.findFirst({ where: eq(messages.id, queue.email[0]!) }))!;
    expect(msg).toMatchObject({ service: true, tripId: t.id, subject: 'Your Kerala backwaters starts soon' });
    expect(msg.body).toContain('your Kerala backwaters starts on 12 Nov 2026');
    const provider = new MemoryEmailProvider();
    expect(await processSendJob(msg.id, provider)).toBe('sent');
    expect(provider.outbox[0]!.headers).not.toHaveProperty('List-Unsubscribe');
  });

  it('review request the day after they’re back, with the link, and an unsubscribe', async () => {
    await trip(ALL_ON, { status: 'COMPLETED', start: -6, end: -1 });
    const queue = q();
    expect((await runTripFollowups({ now: NOW, ...queue.opts })).sent).toBe(1);
    const msg = (await db.query.messages.findFirst({ where: eq(messages.id, queue.email[0]!) }))!;
    expect(msg).toMatchObject({ service: false, subject: 'Welcome back from Kerala' });
    expect(msg.body).toContain(REVIEW_URL);
    const provider = new MemoryEmailProvider();
    await processSendJob(msg.id, provider);
    expect(provider.outbox[0]!.headers).toHaveProperty('List-Unsubscribe');
    expect(provider.outbox[0]!.html).toContain('Unsubscribe');
  });

  it('review and "where next" need consent: opted-out customers are skipped quietly', async () => {
    await trip(ALL_ON, { status: 'COMPLETED', start: -6, end: -1 }, { emailStatus: 'UNSUBSCRIBED' });
    const queue = q();
    expect(await runTripFollowups({ now: NOW, ...queue.opts })).toEqual({ sent: 0, skipped: 1 });
  });

  it('"where next?" a few months later, but not if it was missed by more than a few days', async () => {
    await trip(ALL_ON, { status: 'COMPLETED', start: -95, end: -90 });
    const queue = q();
    expect((await runTripFollowups({ now: NOW, ...queue.opts })).sent).toBe(1);
    expect((await db.query.messages.findFirst({ where: eq(messages.id, queue.email[0]!) }))!.subject).toBe('Where to next?');

    await resetDb();
    await trip(ALL_ON, { status: 'COMPLETED', start: -105, end: -100 });
    expect((await runTripFollowups({ now: NOW, ...queue.opts })).sent).toBe(0);
  });

  it('cancelled and lost trips get nothing', async () => {
    const { trip: t } = await trip(ALL_ON, { status: 'BOOKED', start: 2 });
    await db.update(trips).set({ status: 'CANCELLED' }).where(eq(trips.id, t.id));
    expect((await runTripFollowups({ now: NOW, ...q().opts })).sent).toBe(0);
  });
});


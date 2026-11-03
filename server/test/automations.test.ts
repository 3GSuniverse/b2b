import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { automations, automationSends, contacts, customFields, messages, templates } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { runAutomationsTick } from '../src/modules/automations/engine.js';
import { describeRule } from '../src/modules/automations/routes.js';
import { MemoryEmailProvider } from '../src/modules/email/memory-provider.js';
import { processSendJob } from '../src/modules/sending/send-message.js';
import { api, signup } from './api-helpers.js';
import { fakeQueue, makeContact, makeTenant, resetDb } from './helpers.js';

const provider = new MemoryEmailProvider();
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  app = await buildApp({ authRateLimit: 10_000 });
});
afterAll(async () => {
  await app.close();
  await closeRedis();
  await closeDatabase();
});
beforeEach(async () => {
  await resetDb();
  provider.clear();
});

const T = (iso: string) => new Date(iso);

/** A tenant with a DATE field, a template and an ACTIVE automation. */
async function setup(opts: { key?: string; offsetDays?: number; sendTime?: string; repeat?: 'ONCE' | 'YEARLY'; activatedAt?: Date; monthlyQuota?: number } = {}) {
  const { tenant, sender } = await makeTenant({ monthlyQuota: opts.monthlyQuota ?? 1000 });
  const key = opts.key ?? 'trip_date';
  const [field] = await db.insert(customFields).values({ tenantId: tenant.id, key, label: key === 'trip_date' ? 'Trip date' : 'Birthday', type: 'DATE' }).returning();
  const [tpl] = await db
    .insert(templates)
    .values({ tenantId: tenant.id, name: 'Reminder', subject: '{first_name|Hi}, your trip is on {trip_date|soon}', html: '<p>See you on {trip_date}</p>' })
    .returning();
  const [auto] = await db
    .insert(automations)
    .values({
      tenantId: tenant.id,
      name: 'Trip reminder',
      status: 'ACTIVE',
      dateFieldId: field!.id,
      offsetDays: opts.offsetDays ?? -3,
      sendTime: opts.sendTime ?? '09:00',
      repeat: opts.repeat ?? 'ONCE',
      templateId: tpl!.id,
      senderId: sender.id,
      activatedAt: opts.activatedAt ?? T('2026-01-01T00:00:00Z'),
    })
    .returning();
  return { tenant, sender, field: field!, auto: auto! };
}

async function sends(automationId: string) {
  return db.select().from(automationSends).where(eq(automationSends.automationId, automationId));
}

describe('rule text', () => {
  it('reads like a sentence', () => {
    expect(describeRule({ offsetDays: -3, sendTime: '09:00', repeat: 'ONCE' }, 'Trip date')).toBe('3 days before Trip date · 9:00 AM');
    expect(describeRule({ offsetDays: 0, sendTime: '08:00', repeat: 'YEARLY' }, 'Birthday')).toBe('On Birthday · 8:00 AM · every year');
    expect(describeRule({ offsetDays: 2, sendTime: '18:30', repeat: 'ONCE' }, 'Return date')).toBe('2 days after Return date · 6:30 PM');
  });
});

describe('trip reminder (3 days before, 9:00 AM IST)', () => {
  // Trip on 9 Nov → due 6 Nov 09:00 IST = 6 Nov 03:30 UTC
  it('sends at exactly the right moment in India time, and only once', async () => {
    const { tenant, auto } = await setup();
    await makeContact(tenant.id, { firstName: 'Ravi', attributes: { trip_date: '2026-11-09' } });
    const q = fakeQueue();

    expect((await runAutomationsTick({ now: T('2026-11-06T03:29:00Z'), enqueue: q.enqueue })).queued).toBe(0);
    expect((await runAutomationsTick({ now: T('2026-11-06T03:31:00Z'), enqueue: q.enqueue })).queued).toBe(1);
    expect((await runAutomationsTick({ now: T('2026-11-06T03:32:00Z'), enqueue: q.enqueue })).queued).toBe(0); // never twice

    const [s] = await sends(auto.id);
    expect(s).toMatchObject({ occurrenceDate: '2026-11-09', status: 'PENDING' });
    expect(s!.dueAt.toISOString()).toBe('2026-11-06T03:30:00.000Z');

    expect(await processSendJob(q.queued[0]!, provider)).toBe('sent');
    expect(provider.outbox[0]!.subject).toBe('Ravi, your trip is on 9 Nov 2026');
    expect((await sends(auto.id))[0]!.status).toBe('SENT');
    expect((await db.query.automations.findFirst({ where: eq(automations.id, auto.id) }))!.sent).toBe(1);
  });

  it('catches up after the server was down, but not when it’s too late to be useful', async () => {
    const { tenant } = await setup();
    await makeContact(tenant.id, { email: 'late@x.in', attributes: { trip_date: '2026-11-09' } });
    await makeContact(tenant.id, { email: 'tooLate@x.in', attributes: { trip_date: '2026-11-07' } }); // due 4 Nov
    const q = fakeQueue();
    const r = await runAutomationsTick({ now: T('2026-11-06T08:00:00Z'), enqueue: q.enqueue }); // back up 4.5 h late
    expect(r.queued).toBe(1);
    const [m] = await db.select().from(messages);
    expect(m!.toAddress).toBe('late@x.in');
  });

  it('never back-fills dates that passed before the automation was switched on', async () => {
    const { tenant } = await setup({ activatedAt: T('2026-11-06T05:00:00Z') });
    await makeContact(tenant.id, { attributes: { trip_date: '2026-11-09' } }); // due 03:30, before activation
    expect((await runAutomationsTick({ now: T('2026-11-06T05:01:00Z'), enqueue: fakeQueue().enqueue })).queued).toBe(0);
  });

  it('follows a changed trip date', async () => {
    const { tenant } = await setup();
    const c = await makeContact(tenant.id, { attributes: { trip_date: '2026-11-09' } });
    await db.update(contacts).set({ attributes: { trip_date: '2026-11-20' } }).where(eq(contacts.id, c.id));
    const q = fakeQueue();
    expect((await runAutomationsTick({ now: T('2026-11-06T03:31:00Z'), enqueue: q.enqueue })).queued).toBe(0);
    expect((await runAutomationsTick({ now: T('2026-11-17T03:31:00Z'), enqueue: q.enqueue })).queued).toBe(1);
  });

  it('skips people who unsubscribed, have no date, or have rubbish in the date field', async () => {
    const { tenant } = await setup();
    await makeContact(tenant.id, { emailStatus: 'UNSUBSCRIBED', attributes: { trip_date: '2026-11-09' } });
    await makeContact(tenant.id, { attributes: {} });
    await makeContact(tenant.id, { attributes: { trip_date: 'next week' } });
    expect((await runAutomationsTick({ now: T('2026-11-06T03:31:00Z'), enqueue: fakeQueue().enqueue })).queued).toBe(0);
  });

  it('does nothing while paused, and respects the monthly limit', async () => {
    const { tenant, auto } = await setup({ monthlyQuota: 1 });
    await makeContact(tenant.id, { attributes: { trip_date: '2026-11-09' } });
    await makeContact(tenant.id, { attributes: { trip_date: '2026-11-09' } });

    await db.update(automations).set({ status: 'PAUSED' }).where(eq(automations.id, auto.id));
    expect((await runAutomationsTick({ now: T('2026-11-06T03:31:00Z'), enqueue: fakeQueue().enqueue })).automations).toBe(0);

    await db.update(automations).set({ status: 'ACTIVE' }).where(eq(automations.id, auto.id));
    const r = await runAutomationsTick({ now: T('2026-11-06T03:31:00Z'), enqueue: fakeQueue().enqueue });
    expect(r).toMatchObject({ queued: 1, skipped: 1 });
    expect((await sends(auto.id)).map((s) => s.status).sort()).toEqual(['PENDING', 'SKIPPED']);
  });
});

describe('birthday (every year, 8:00 AM IST)', () => {
  it('sends every year on the day', async () => {
    const { tenant, auto } = await setup({ key: 'birthday', offsetDays: 0, sendTime: '08:00', repeat: 'YEARLY' });
    await makeContact(tenant.id, { attributes: { birthday: '1990-11-06' } });
    const q = fakeQueue();
    expect((await runAutomationsTick({ now: T('2026-11-06T02:31:00Z'), enqueue: q.enqueue })).queued).toBe(1);
    expect((await runAutomationsTick({ now: T('2027-11-06T02:31:00Z'), enqueue: q.enqueue })).queued).toBe(1);
    expect((await sends(auto.id)).map((s) => s.occurrenceDate).sort()).toEqual(['2026-11-06', '2027-11-06']);
  });

  it('a 29 February birthday is celebrated on 28 February in normal years', async () => {
    const { tenant } = await setup({ key: 'birthday', offsetDays: 0, sendTime: '08:00', repeat: 'YEARLY' });
    await makeContact(tenant.id, { attributes: { birthday: '2000-02-29' } });
    expect((await runAutomationsTick({ now: T('2027-02-28T02:31:00Z'), enqueue: fakeQueue().enqueue })).queued).toBe(1);
  });

  it('“3 days before” a 2 January birthday goes out on 30 December', async () => {
    const { tenant, auto } = await setup({ key: 'birthday', offsetDays: -3, sendTime: '10:00', repeat: 'YEARLY' });
    await makeContact(tenant.id, { attributes: { birthday: '1985-01-02' } });
    expect((await runAutomationsTick({ now: T('2026-12-30T04:31:00Z'), enqueue: fakeQueue().enqueue })).queued).toBe(1);
    expect((await sends(auto.id))[0]!.occurrenceDate).toBe('2027-01-02');
  });
});

describe('automations API', () => {
  it('creates, describes, activates and shows who gets it next', async () => {
    const { cookie, json } = await signup(app);
    const c = api(app, cookie);
    const tenantId = json.tenant.id;
    const field = (await c.post('/api/fields', { label: 'Trip date', type: 'DATE' })).json().field;
    const text = (await c.post('/api/fields', { label: 'City' })).json().field;
    const tpl = (await c.post('/api/templates/from-starter', { starterId: 'trip-reminder' })).json().template;

    expect((await c.post('/api/automations', { name: 'x', dateFieldId: text.id })).json().error).toBe('not_a_date_field');
    const a = (await c.post('/api/automations', { name: 'Trip reminder', dateFieldId: field.id, offsetDays: -3, sendTime: '09:00', templateId: tpl.id })).json().automation;
    expect(a).toMatchObject({ status: 'DRAFT', rule: '3 days before Trip date · 9:00 AM', timezone: 'Asia/Kolkata' });

    // can't switch on without a sender that can send
    expect((await c.post(`/api/automations/${a.id}/activate`)).json().error).toBe('no_sender');

    const inThreeDays = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await c.post('/api/contacts', { email: 'ravi@x.in', firstName: 'Ravi', attributes: { trip_date: inThreeDays } });
    await c.post('/api/contacts', { email: 'nodate@x.in' });
    const up = (await c.get(`/api/automations/${a.id}/upcoming?days=7`)).json();
    expect(up.total).toBe(1);
    expect(up.days[0].people[0]).toMatchObject({ name: 'Ravi', email: 'ravi@x.in' });
    expect(up.audience).toEqual({ matching: 2, withDate: 1 });
    expect(tenantId).toBeTruthy();
  });

  it('starter templates are available to every company', async () => {
    const { cookie } = await signup(app);
    const list = (await api(app, cookie).get('/api/templates/starters')).json().starters;
    expect(list.map((s: { id: string }) => s.id)).toEqual(['offer-spotlight', 'package-grid', 'plain-letter', 'trip-reminder', 'birthday']);
  });

  it('companies can’t see each other’s automations or templates', async () => {
    const a = await signup(app);
    const b = await signup(app);
    const tpl = (await api(app, a.cookie).post('/api/templates', { name: 'Secret', subject: 's', html: '<p>x</p>' })).json().template;
    expect((await api(app, b.cookie).get(`/api/templates/${tpl.id}`)).statusCode).toBe(404);
    expect((await api(app, b.cookie).get('/api/templates')).json().templates).toEqual([]);
  });
});

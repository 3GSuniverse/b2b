import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { contacts, customFields, trips } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { addDays, formatInr, localDate, rupeesToPaise, suggestSchedule, tripMoney } from '../src/modules/trips/money.js';
import { completeFinishedTrips } from '../src/modules/trips/service.js';
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

const TODAY = '2026-11-10';
const due = (id: string, amount: number, dueDate: string, position = 0) => ({ id, label: id, amount, dueDate, position });

describe('trip money', () => {
  it('applies payments to the earliest due first', () => {
    const m = tripMoney({ price: 100_000, dues: [due('balance', 75_000, '2026-12-01', 1), due('advance', 25_000, '2026-11-01', 0)], payments: [{ amount: 40_000 }] }, TODAY);
    expect(m.dues.map((d) => [d.id, d.paid, d.state])).toEqual([
      ['advance', 25_000, 'PAID'],
      ['balance', 15_000, 'PART_PAID'],
    ]);
    expect(m).toMatchObject({ paid: 40_000, balance: 60_000, overdue: 0 });
    expect(m.nextDue).toMatchObject({ id: 'balance', remaining: 60_000 });
  });

  it('a due date that has passed with money owed is overdue; today is "due today"', () => {
    const m = tripMoney({ price: 30_000, dues: [due('a', 10_000, '2026-11-09'), due('b', 10_000, TODAY, 1), due('c', 10_000, '2026-11-20', 2)], payments: [{ amount: 4_000 }] }, TODAY);
    expect(m.dues.map((d) => d.state)).toEqual(['OVERDUE', 'DUE_TODAY', 'UPCOMING']);
    expect(m.overdue).toBe(6_000);
  });

  it('ignores cancelled payments and shows overpayment as a negative balance', () => {
    const m = tripMoney({ price: 10_000, dues: [], payments: [{ amount: 12_000 }, { amount: 5_000, voidedAt: new Date() }] }, TODAY);
    expect(m).toMatchObject({ paid: 12_000, balance: -2_000, nextDue: null });
  });

  it('reads amounts the way people type them', () => {
    expect(rupeesToPaise('18,500')).toBe(1_850_000);
    expect(rupeesToPaise('₹ 1,20,000.50')).toBe(12_000_050);
    expect(rupeesToPaise(250)).toBe(25_000);
    expect(rupeesToPaise('12.345')).toBeNull();
    expect(rupeesToPaise('-5')).toBeNull();
    expect(formatInr(12_000_050)).toBe('₹1,20,000.50');
    expect(formatInr(1_850_000)).toBe('₹18,500');
  });

  it('suggests an advance now and the balance 15 days before departure', () => {
    expect(suggestSchedule(8_000_000, '2026-12-20', TODAY)).toEqual([
      { label: 'Advance', amount: 2_000_000, dueDate: TODAY },
      { label: 'Balance', amount: 6_000_000, dueDate: '2026-12-05' },
    ]);
    // Trip sooner than 15 days: balance is due today, not in the past
    expect(suggestSchedule(1_000_000, '2026-11-15', TODAY)[1]!.dueDate).toBe(TODAY);
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('knows "today" in the company’s time zone', () => {
    // 20:00 UTC on the 10th is already the 11th in India
    expect(localDate('Asia/Kolkata', new Date('2026-11-10T20:00:00Z'))).toBe('2026-11-11');
  });
});

describe('trips', () => {
  async function company() {
    const s = await signup(app);
    return { ...s, c: api(app, s.cookie) };
  }

  it('an enquiry creates the customer as a contact, numbered per company', async () => {
    const { c } = await company();
    const r = await c.post('/api/trips', {
      customer: { name: 'Lakshmi Prasad', phone: '98480 12345', whatsappOptIn: true },
      destination: 'Kashmir',
      startDate: '2026-12-20',
      endDate: '2026-12-26',
      adults: 4,
      budget: '80,000',
      source: 'PHONE',
    });
    expect(r.statusCode).toBe(201);
    const trip = r.json().trip;
    expect(trip).toMatchObject({ number: 1, status: 'ENQUIRY', title: 'Kashmir trip', budget: 8_000_000, adults: 4 });
    expect(trip.customer).toMatchObject({ name: 'Lakshmi Prasad', phone: '+919848012345', whatsappStatus: 'SUBSCRIBED' });

    // Same phone again: same contact, next number
    const again = (await c.post('/api/trips', { customer: { name: 'Lakshmi', phone: '+91 98480 12345' }, destination: 'Goa' })).json().trip;
    expect(again.number).toBe(2);
    expect(again.customer.id).toBe(trip.customer.id);

    // Another company starts at #1 and can't see these
    const other = await company();
    expect((await other.c.post('/api/trips', { customer: { name: 'X', email: 'x@example.com' } })).json().trip.number).toBe(1);
    expect((await other.c.get(`/api/trips/${trip.id}`)).statusCode).toBe(404);
  });

  it('needs a way to reach the customer, and dates in order', async () => {
    const { c } = await company();
    const r = await c.post('/api/trips', { customer: { name: 'No contact' }, startDate: '2026-12-20', endDate: '2026-12-10' });
    expect(r.statusCode).toBe(400);
    expect(r.json().details.fields).toMatchObject({ 'customer.phone': 'Enter a phone number or an email' });
  });

  it('schedule → payment → booked, with receipts numbered and the trip dates on the contact', async () => {
    const { c } = await company();
    const trip = (await c.post('/api/trips', { customer: { name: 'Ravi', email: 'ravi@example.com' }, destination: 'Kerala', startDate: '2027-01-10', endDate: '2027-01-15', price: '60,000' })).json().trip;

    let r = await c.patch(`/api/trips/${trip.id}`, {}); // nothing changes
    expect(r.json().trip.suggestedSchedule).toHaveLength(2);

    r = await c.put(`/api/trips/${trip.id}/dues`, { dues: [{ label: 'Advance', amount: '15,000', dueDate: '2026-11-01' }, { label: 'Balance', amount: 45000, dueDate: '2026-12-26' }] });
    expect(r.statusCode).toBe(200);
    expect(r.json().trip.money).toMatchObject({ scheduled: 6_000_000, unscheduled: 0 });

    r = await c.post(`/api/trips/${trip.id}/payments`, { amount: '15,000', method: 'UPI', reference: 'UPI-4411' });
    expect(r.statusCode).toBe(201);
    expect(r.json().receiptNumber).toBe(1);
    const t = r.json().trip;
    expect(t.status).toBe('BOOKED'); // money received → booked
    expect(t.money).toMatchObject({ paid: 1_500_000, balance: 4_500_000, overdue: 0 });
    expect(t.money.dues[0].state).toBe('PAID');
    expect(t.activity.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['trip.create', 'trip.payment', 'trip.status']));

    // The contact now carries the trip, so date automations work
    const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, t.customer.id) });
    expect(contact!.attributes).toMatchObject({ trip_date: '2027-01-10', return_date: '2027-01-15', destination: 'Kerala' });
    const fields = await db.select().from(customFields).where(eq(customFields.tenantId, (await db.query.trips.findFirst({ where: eq(trips.id, trip.id) }))!.tenantId));
    expect(fields.map((f) => [f.key, f.type])).toEqual(expect.arrayContaining([['trip_date', 'DATE'], ['return_date', 'DATE']]));

    // Second payment gets receipt 2; a trip with payments can't be deleted
    expect((await c.post(`/api/trips/${trip.id}/payments`, { amount: 1000, method: 'CASH' })).json().receiptNumber).toBe(2);
    expect((await c.del(`/api/trips/${trip.id}`)).statusCode).toBe(409);

    // Cancelling a trip takes its dates off the contact: no reminders for a trip that isn't happening
    await c.patch(`/api/trips/${trip.id}`, { status: 'CANCELLED', lostReason: 'Family emergency' });
    const after = await db.query.contacts.findFirst({ where: eq(contacts.id, t.customer.id) });
    expect(after!.attributes).not.toHaveProperty('trip_date');
  });

  it('a wrong payment is cancelled, not deleted, and the balance comes back', async () => {
    const { c } = await company();
    const trip = (await c.post('/api/trips', { customer: { name: 'Ravi', phone: '9000000001' }, price: 10000, status: 'BOOKED' })).json().trip;
    const paid = (await c.post(`/api/trips/${trip.id}/payments`, { amount: 10000, method: 'CASH' })).json().trip;
    expect(paid.money.balance).toBe(0);
    const pid = paid.payments[0].id;
    expect((await c.post(`/api/trips/${trip.id}/payments/${pid}/void`, { reason: '' })).statusCode).toBe(400);
    const voided = (await c.post(`/api/trips/${trip.id}/payments/${pid}/void`, { reason: 'Entered twice' })).json().trip;
    expect(voided.money.balance).toBe(1_000_000);
    expect(voided.payments[0]).toMatchObject({ voidReason: 'Entered twice', receiptNumber: 1 });
    expect(voided.payments[0].voidedAt).toBeTruthy();
  });

  it('lists, searches and filters by overdue payments; stats add up', async () => {
    const { c } = await company();
    const a = (await c.post('/api/trips', { customer: { name: 'Anil Kumar', phone: '9000000011' }, destination: 'Goa', price: 20000, status: 'BOOKED' })).json().trip;
    await c.post('/api/trips', { customer: { name: 'Bhavani', phone: '9000000022' }, destination: 'Ooty', price: '45,000', status: 'QUOTED' });
    await c.put(`/api/trips/${a.id}/dues`, { dues: [{ label: 'Advance', amount: 5000, dueDate: '2020-01-01' }] });

    expect((await c.get('/api/trips?search=ooty')).json().trips.map((t: { destination: string }) => t.destination)).toEqual(['Ooty']);
    expect((await c.get('/api/trips?search=%232')).json().trips.map((t: { number: number }) => t.number)).toEqual([2]);
    expect((await c.get('/api/trips?search=0000011')).json().trips).toHaveLength(1);
    const overdue = (await c.get('/api/trips?payments=overdue')).json();
    expect(overdue.trips.map((t: { id: string }) => t.id)).toEqual([a.id]);

    const stats = (await c.get('/api/trips/stats')).json().stats;
    expect(stats.counts).toMatchObject({ BOOKED: 1, QUOTED: 1, ENQUIRY: 0 });
    expect(stats).toMatchObject({ pipelineValue: 4_500_000, overdue: 500_000, overdueTrips: 1 });
  });

  it('booked trips become completed after the return date', async () => {
    const { c } = await company();
    const done = (await c.post('/api/trips', { customer: { name: 'A', phone: '9000000031' }, startDate: '2026-01-01', endDate: '2026-01-05', status: 'BOOKED' })).json().trip;
    const future = (await c.post('/api/trips', { customer: { name: 'B', phone: '9000000032' }, startDate: '2099-01-01', status: 'BOOKED' })).json().trip;
    expect(await completeFinishedTrips(new Date('2026-06-01T06:00:00Z'))).toBe(1);
    expect((await c.get(`/api/trips/${done.id}`)).json().trip.status).toBe('COMPLETED');
    expect((await c.get(`/api/trips/${future.id}`)).json().trip.status).toBe('BOOKED');
    // Only a booked trip can be completed by hand
    const enquiry = (await c.post('/api/trips', { customer: { name: 'C', phone: '9000000033' } })).json().trip;
    expect((await c.patch(`/api/trips/${enquiry.id}`, { status: 'COMPLETED' })).statusCode).toBe(409);
  });
});

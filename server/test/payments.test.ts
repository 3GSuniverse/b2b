import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { contacts, messages, notifications, suppressions, tenants, tripDues, tripPayments, tripReminders, trips, users, whatsappSessions } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { MemoryEmailProvider } from '../src/modules/email/memory-provider.js';
import { runPaymentReminders } from '../src/modules/payments/reminders.js';
import { setRazorpayClient } from '../src/modules/payments/razorpay.js';
import { encryptSecret } from '../src/lib/crypto.js';
import { rupeesInWords, upiLink } from '../src/modules/payments/upi.js';
import { processSendJob } from '../src/modules/sending/send-message.js';
import { addDays } from '../src/modules/trips/money.js';
import { MemoryWhatsAppGateway } from '../src/modules/whatsapp/gateway.js';
import { processWhatsAppJob } from '../src/modules/whatsapp/service.js';
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

// 10:30 in India on 10 Nov 2026
const NOW = new Date('2026-11-10T05:00:00Z');
const TODAY = '2026-11-10';

function queues() {
  const email: string[] = [];
  const whatsapp: string[] = [];
  return {
    email,
    whatsapp,
    opts: { enqueueEmail: async (ids: string[]) => void email.push(...ids), enqueueWhatsApp: async (ids: string[]) => void whatsapp.push(...ids) },
  };
}

/** A paid company, a booked trip for Lakshmi, and an instalment due in `dueIn` days. */
async function bookedTrip(opts: { dueIn?: number; amount?: number; contact?: Partial<typeof contacts.$inferInsert>; tenant?: Partial<typeof tenants.$inferInsert> } = {}) {
  const { tenant, sender } = await makeTenant(opts.tenant);
  const contact = await makeContact(tenant.id, { firstName: 'Lakshmi', email: 'lakshmi@example.com', phone: '+919848012345', ...opts.contact });
  const [trip] = await db
    .insert(trips)
    .values({ tenantId: tenant.id, number: 7, status: 'BOOKED', contactId: contact.id, customerName: 'Lakshmi Prasad', title: 'Kashmir family trip', startDate: '2026-12-20', endDate: '2026-12-26', price: 6_000_000 })
    .returning();
  const [due] = await db
    .insert(tripDues)
    .values({ tenantId: tenant.id, tripId: trip!.id, label: 'Balance', amount: opts.amount ?? 4_500_000, dueDate: addDays(TODAY, opts.dueIn ?? 2) })
    .returning();
  return { tenant, sender, contact, trip: trip!, due: due! };
}

describe('money helpers', () => {
  it('writes amounts in words the Indian way', () => {
    expect(rupeesInWords(8_100_000)).toBe('Rupees Eighty-One Thousand Only');
    expect(rupeesInWords(12_050_075)).toBe('Rupees One Lakh Twenty Thousand Five Hundred and Seventy-Five Paise Only');
    expect(rupeesInWords(270_000_000)).toBe('Rupees Twenty-Seven Lakh Only');
    expect(rupeesInWords(1_500_000_000)).toBe('Rupees One Crore Fifty Lakh Only');
    expect(rupeesInWords(10_000)).toBe('Rupees One Hundred Only');
  });

  it('builds a UPI link every app understands', () => {
    expect(upiLink({ upiId: 'kt@okhdfcbank', payeeName: 'Kurukshetra Travels', paise: 4_500_000, note: 'Trip 7 Kashmir' })).toBe(
      'upi://pay?pa=kt%40okhdfcbank&pn=Kurukshetra%20Travels&am=45000.00&cu=INR&tn=Trip%207%20Kashmir',
    );
  });
});

describe('payment settings', () => {
  it('validates the UPI ID and reminder wording, and never returns secrets', async () => {
    const { cookie } = await signup(app);
    const c = api(app, cookie);
    let r = await c.patch('/api/payments/settings', { upiId: 'not a upi id', beforeText: 'Hi {first_name}, please pay {amount} by {deadline}.' });
    expect(r.statusCode).toBe(400);
    expect(r.json().details.fields).toMatchObject({ upiId: 'Enter a UPI ID like kurukshetra@okhdfcbank', beforeText: 'Unknown tag: {deadline}' });

    r = await c.patch('/api/payments/settings', { upiId: 'KT@okhdfcbank', contactPhone: '98480 22338', daysBefore: 5, razorpayKeyId: 'rzp_test_abcdefgh12', razorpayKeySecret: 'very-secret-value' });
    expect(r.statusCode).toBe(200);
    const s = r.json().settings;
    expect(s).toMatchObject({ upiId: 'kt@okhdfcbank', contactPhone: '+919848022338', daysBefore: 5, remindersEnabled: true, razorpay: { connected: true, keyId: 'rzp_test_abcdefgh12' } });
    expect(JSON.stringify(s)).not.toContain('very-secret-value');
    // Stored encrypted
    const t = await db.query.tenants.findFirst({ where: eq(tenants.slug, (await db.query.tenants.findMany())[0]!.slug) });
    expect(JSON.stringify(t!.paymentSettings)).not.toContain('very-secret-value');
  });

  it('only admins can change them', async () => {
    const { cookie, json } = await signup(app);
    await db.update(users).set({ role: 'MEMBER' }).where(eq(users.id, json.user.id));
    expect((await api(app, cookie).patch('/api/payments/settings', { daysBefore: 4 })).statusCode).toBe(403);
  });
});

describe('payment reminders', () => {
  it('a few days before, by email when WhatsApp isn’t linked; once only', async () => {
    const { trip, due } = await bookedTrip({ dueIn: 2 });
    const q = queues();
    expect(await runPaymentReminders({ now: NOW, ...q.opts })).toEqual({ sent: 1, skipped: 0 });
    expect(q.email).toHaveLength(1);
    const msg = await db.query.messages.findFirst({ where: eq(messages.id, q.email[0]!) });
    expect(msg).toMatchObject({ channel: 'EMAIL', tripId: trip.id, toAddress: 'lakshmi@example.com', subject: 'Payment reminder: Kashmir family trip' });
    expect(msg!.body).toContain('Hi Lakshmi');
    expect(msg!.body).toContain('the balance of ₹45,000 for your Kashmir family trip is due on 12 Nov 2026');
    expect(msg!.body).toContain(`/p/${trip.publicToken}`);

    // Reruns, restarts: nothing more
    expect(await runPaymentReminders({ now: new Date(NOW.getTime() + 3_600_000), ...q.opts })).toEqual({ sent: 0, skipped: 0 });
    expect((await db.select().from(tripReminders).where(eq(tripReminders.dueId, due.id))).map((r) => r.kind)).toEqual(['BEFORE']);
  });

  it('not before 10 am, not too early, not when paid, not when switched off', async () => {
    const q = queues();
    await bookedTrip({ dueIn: 2 });
    expect((await runPaymentReminders({ now: new Date('2026-11-10T03:00:00Z'), ...q.opts })).sent).toBe(0); // 08:30 in India
    await resetDb();

    await bookedTrip({ dueIn: 6 }); // default is 3 days before
    expect((await runPaymentReminders({ now: NOW, ...q.opts })).sent).toBe(0);
    await resetDb();

    const paid = await bookedTrip({ dueIn: 2 });
    await db.insert(tripPayments).values({ tenantId: paid.tenant.id, tripId: paid.trip.id, receiptNumber: 1, amount: 4_500_000, method: 'UPI', paidAt: NOW });
    expect((await runPaymentReminders({ now: NOW, ...q.opts })).sent).toBe(0);
    await resetDb();

    await bookedTrip({ dueIn: 2, tenant: { paymentSettings: { remindersEnabled: false } } });
    expect((await runPaymentReminders({ now: NOW, ...q.opts })).sent).toBe(0);
    expect(q.email).toHaveLength(0);
  });

  it('the day after a missed payment, with the overdue wording', async () => {
    const { due } = await bookedTrip({ dueIn: -1 });
    const q = queues();
    expect((await runPaymentReminders({ now: NOW, ...q.opts })).sent).toBe(1);
    const msg = await db.query.messages.findFirst({ where: eq(messages.id, q.email[0]!) });
    expect(msg!.subject).toBe('Payment overdue: Kashmir family trip');
    expect(msg!.body).toContain('was due on 9 Nov 2026 and we haven’t received it yet');
    expect((await db.select().from(tripReminders).where(eq(tripReminders.dueId, due.id)))[0]!.kind).toBe('OVERDUE');
  });

  it('on WhatsApp when the number is linked, even to someone who didn’t opt in to offers', async () => {
    const { tenant, contact } = await bookedTrip({ dueIn: 1, tenant: { whatsappWebEnabled: true }, contact: { whatsappStatus: 'UNSUBSCRIBED' } });
    await db.insert(whatsappSessions).values({ tenantId: tenant.id, status: 'CONNECTED', phone: '+919000000001', intervalSeconds: 0 });
    const q = queues();
    await runPaymentReminders({ now: NOW, ...q.opts });
    expect(q.whatsapp).toHaveLength(1);
    const gw = new MemoryWhatsAppGateway();
    expect(await processWhatsAppJob(q.whatsapp[0]!, gw, NOW)).toBe('sent');
    expect(gw.sent[0]).toMatchObject({ to: contact.phone });
    expect(gw.sent[0]!.text).toContain('Hi Lakshmi');
  });

  it('never to someone who replied STOP; falls back to email', async () => {
    const { tenant, contact } = await bookedTrip({ dueIn: 1, tenant: { whatsappWebEnabled: true } });
    await db.insert(whatsappSessions).values({ tenantId: tenant.id, status: 'CONNECTED', phone: '+919000000001' });
    await db.insert(suppressions).values({ tenantId: tenant.id, channel: 'WHATSAPP', address: contact.phone!, reason: 'UNSUBSCRIBE' });
    const q = queues();
    await runPaymentReminders({ now: NOW, ...q.opts });
    expect(q.whatsapp).toHaveLength(0);
    expect(q.email).toHaveLength(1);
  });

  it('with no way to reach them: recorded as skipped, and the company is told once', async () => {
    const { tenant } = await bookedTrip({ dueIn: 1, contact: { email: null } });
    const q = queues();
    expect(await runPaymentReminders({ now: NOW, ...q.opts })).toEqual({ sent: 0, skipped: 1 });
    expect(await runPaymentReminders({ now: NOW, ...q.opts })).toEqual({ sent: 0, skipped: 0 });
    const n = await db.select().from(notifications).where(and(eq(notifications.tenantId, tenant.id), eq(notifications.type, 'payments.reminder_skipped')));
    expect(n).toHaveLength(1);
  });
});

describe('sending a reminder email', () => {
  it('goes to people who unsubscribed from offers, has no unsubscribe header, and links the pay page', async () => {
    const { trip } = await bookedTrip({ dueIn: 1, contact: { emailStatus: 'UNSUBSCRIBED' } });
    const q = queues();
    await runPaymentReminders({ now: NOW, ...q.opts });
    const provider = new MemoryEmailProvider();
    expect(await processSendJob(q.email[0]!, provider)).toBe('sent');
    const sent = provider.outbox[0]!;
    expect(sent.subject).toBe('Payment reminder: Kashmir family trip');
    expect(sent.headers).not.toHaveProperty('List-Unsubscribe');
    expect(sent.html).toContain(`/p/${trip.publicToken}`);
    expect(sent.html).toContain('See what’s due and pay');
  });

  it('is never sent to an address that bounced', async () => {
    await bookedTrip({ dueIn: 1 });
    const q = queues();
    await runPaymentReminders({ now: NOW, ...q.opts });
    const msg = (await db.query.messages.findFirst({ where: eq(messages.id, q.email[0]!) }))!;
    await db.update(contacts).set({ emailStatus: 'BOUNCED' }).where(eq(contacts.id, msg.contactId!));
    expect(await processSendJob(msg.id, new MemoryEmailProvider())).toBe('suppressed');
  });
});

describe('the customer’s pages', () => {
  it('trip page: what’s due, UPI QR and button, receipts; a bad token is a 404', async () => {
    const { trip, tenant } = await bookedTrip({ dueIn: 5, tenant: { paymentSettings: { upiId: 'kt@okhdfcbank', contactPhone: '+919848022338' } } });
    await db.insert(tripPayments).values({ tenantId: tenant.id, tripId: trip.id, receiptNumber: 3, amount: 1_500_000, method: 'UPI', paidAt: NOW });
    const r = await app.inject({ method: 'GET', url: `/p/${trip.publicToken}`, headers: { accept: 'text/html' } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-robots-tag']).toContain('noindex');
    expect(r.body).toContain('Kashmir family trip');
    expect(r.body).toContain('₹45,000'); // the balance instalment
    expect(r.body).toContain('upi://pay?pa=kt%40okhdfcbank');
    expect(r.body).toContain('data:image/png;base64'); // QR
    expect(r.body).toContain('Receipt #3');
    expect(r.body).toContain('https://wa.me/919848022338');

    expect((await app.inject({ method: 'GET', url: '/p/not-a-real-token-but-long-enough-to-pass-0123456789', headers: { accept: 'text/html' } })).statusCode).toBe(404);
  });

  it('receipt: amount in words, balance today, and marked when cancelled', async () => {
    const { trip, tenant } = await bookedTrip({ dueIn: 5 });
    const [p] = await db.insert(tripPayments).values({ tenantId: tenant.id, tripId: trip.id, receiptNumber: 12, amount: 1_500_000, method: 'BANK', reference: 'NEFT 4471', paidAt: NOW }).returning();
    let r = await app.inject({ method: 'GET', url: `/r/${p!.publicToken}` });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('#12');
    expect(r.body).toContain('Rupees Fifteen Thousand Only');
    expect(r.body).toContain('NEFT 4471');
    expect(r.body).toContain('₹45,000'); // balance today
    expect(r.body).toContain('not a tax invoice');

    await db.update(tripPayments).set({ voidedAt: NOW, voidReason: 'Entered twice' }).where(eq(tripPayments.id, p!.id));
    r = await app.inject({ method: 'GET', url: `/r/${p!.publicToken}` });
    expect(r.body).toContain('CANCELLED · Entered twice');
  });

  it('the trip page link and receipt links come back with the trip', async () => {
    const { cookie } = await signup(app);
    const c = api(app, cookie);
    const t = (await c.post('/api/trips', { customer: { name: 'Ravi', phone: '9000000001' }, price: 1000, status: 'BOOKED' })).json().trip;
    expect(t.payPageUrl).toMatch(/\/p\/[a-z0-9]{40,}$/);
    const paid = (await c.post(`/api/trips/${t.id}/payments`, { amount: 500, method: 'CASH' })).json().trip;
    expect(paid.payments[0].receiptUrl).toMatch(/\/r\/[a-z0-9]{40,}$/);
  });
});

describe('editing a schedule', () => {
  it('keeps instalments that didn’t change, so their reminders aren’t sent again', async () => {
    const { cookie } = await signup(app);
    const c = api(app, cookie);
    const t = (await c.post('/api/trips', { customer: { name: 'Ravi', phone: '9000000002' }, price: 30000, status: 'BOOKED' })).json().trip;
    const first = (await c.put(`/api/trips/${t.id}/dues`, { dues: [{ label: 'Advance', amount: 10000, dueDate: '2026-12-01' }, { label: 'Balance', amount: 20000, dueDate: '2026-12-20' }] })).json().trip;
    const second = (await c.put(`/api/trips/${t.id}/dues`, { dues: [{ label: 'Advance', amount: 10000, dueDate: '2026-12-01' }, { label: 'Balance', amount: 20000, dueDate: '2026-12-22' }] })).json().trip;
    expect(second.money.dues[0].id).toBe(first.money.dues[0].id); // unchanged
    expect(second.money.dues[1].id).not.toBe(first.money.dues[1].id); // new date
  });
});

describe('online payments with the agency’s own Razorpay', () => {
  const created: { amount: number; notes: Record<string, string> }[] = [];
  setRazorpayClient({
    async createPaymentLink(creds, input) {
      if (creds.keySecret !== 'key-secret-1234') throw new Error('bad keys');
      created.push({ amount: input.amount, notes: input.notes });
      return { id: 'plink_1', shortUrl: 'https://rzp.io/i/abc' };
    },
  });
  const WEBHOOK_SECRET = 'whsec-agency-1';
  const razorpay = { razorpayKeyId: 'rzp_test_abcdefgh12', razorpayKeySecretEnc: encryptSecret('key-secret-1234'), razorpayWebhookSecretEnc: encryptSecret(WEBHOOK_SECRET) };

  function paidEvent(tripId: string, paymentId = 'pay_123', amount = 4_500_000) {
    return JSON.stringify({ event: 'payment_link.paid', payload: { payment: { entity: { id: paymentId, amount, method: 'upi' } }, payment_link: { entity: { id: 'plink_1', notes: { trip_id: tripId } } } } });
  }
  const sign = (body: string, secret = WEBHOOK_SECRET) => createHmac('sha256', secret).update(body).digest('hex');

  it('“Pay online” makes a link for what’s due now and sends the customer to it', async () => {
    const { trip } = await bookedTrip({ dueIn: 5, tenant: { paymentSettings: razorpay } });
    const page = await app.inject({ method: 'GET', url: `/p/${trip.publicToken}` });
    expect(page.body).toContain(`action="/p/${trip.publicToken}/pay"`);
    const r = await app.inject({ method: 'POST', url: `/p/${trip.publicToken}/pay` });
    expect(r.statusCode).toBe(303);
    expect(r.headers.location).toBe('https://rzp.io/i/abc');
    expect(created.at(-1)).toMatchObject({ amount: 4_500_000, notes: { trip_id: trip.id } });
  });

  it('a signed “paid” webhook records the payment once and tells the company', async () => {
    const { trip, tenant } = await bookedTrip({ dueIn: 5, tenant: { paymentSettings: razorpay } });
    const body = paidEvent(trip.id);
    const post = (b: string, sig: string) => app.inject({ method: 'POST', url: `/webhooks/razorpay/${tenant.id}`, headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig }, payload: b });

    expect((await post(body, sign(body, 'wrong-secret'))).statusCode).toBe(401);
    expect((await post(body, sign(body))).statusCode).toBe(200);
    expect((await post(body, sign(body))).json()).toMatchObject({ ok: true, duplicate: true }); // Razorpay retries

    const pays = await db.select().from(tripPayments).where(eq(tripPayments.tripId, trip.id));
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ amount: 4_500_000, method: 'ONLINE', providerPaymentId: 'pay_123', recordedById: null });
    const n = await db.select().from(notifications).where(and(eq(notifications.tenantId, tenant.id), eq(notifications.type, 'payments.received')));
    expect(n[0]!.title).toBe('₹45,000 received online from Lakshmi Prasad');
  });

  it('a webhook can’t record a payment on another company’s trip', async () => {
    const a = await bookedTrip({ dueIn: 5, tenant: { paymentSettings: razorpay } });
    const b = await bookedTrip({ dueIn: 5 });
    const body = paidEvent(b.trip.id, 'pay_999');
    const r = await app.inject({ method: 'POST', url: `/webhooks/razorpay/${a.tenant.id}`, headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(body) }, payload: body });
    expect(r.statusCode).toBe(404);
    expect(await db.select().from(tripPayments).where(eq(tripPayments.tripId, b.trip.id))).toHaveLength(0);
  });
});

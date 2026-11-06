import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { billingPayments, tenants, users } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { BILLING_PLANS, nextPeriod } from '../src/modules/billing/plans.js';
import { runPlanExpiry, setBillingGateway } from '../src/modules/billing/service.js';
import { api, signup } from './api-helpers.js';
import { resetDb } from './helpers.js';

const SECRET = 'test_secret_abc';
const WEBHOOK_SECRET = 'whsec_test';
const orders: { amount: number; notes: Record<string, string> }[] = [];

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  Object.assign(env, { BILLING_RAZORPAY_KEY_ID: 'rzp_test_key', BILLING_RAZORPAY_KEY_SECRET: SECRET, BILLING_RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET });
  setBillingGateway({
    async createOrder(input) {
      orders.push(input);
      return { id: `order_${orders.length}${Math.random().toString(36).slice(2, 8)}`, amount: input.amount, currency: 'INR' };
    },
  });
  app = await buildApp({ authRateLimit: 10_000 });
});
afterAll(async () => {
  await app.close();
  await closeRedis();
  await closeDatabase();
});
beforeEach(async () => {
  orders.length = 0;
  await resetDb();
});

const sign = (orderId: string, paymentId: string) => createHmac('sha256', SECRET).update(`${orderId}|${paymentId}`).digest('hex');

describe('paying for a plan', () => {
  it('charges the server’s price, switches the plan on only with a valid signature, once', async () => {
    const { cookie, json } = await signup(app);
    const c = api(app, cookie);
    const o = await c.post('/api/billing/orders', { plan: 'team10', period: 'month', amount: 100 }); // a browser can't set the price
    expect(o.statusCode).toBe(201);
    expect(o.json()).toMatchObject({ amount: 349_900, currency: 'INR', keyId: 'rzp_test_key', kind: 'NEW' });
    expect(orders[0]!.notes).toMatchObject({ plan: 'team10', period: 'month', tenant_id: json.tenant.id });
    const { orderId } = o.json();

    const bad = await c.post('/api/billing/verify', { razorpay_order_id: orderId, razorpay_payment_id: 'pay_1', razorpay_signature: 'nope' });
    expect(bad.statusCode).toBe(400);
    expect((await db.query.tenants.findFirst({ where: eq(tenants.id, json.tenant.id) }))!.plan).toBe('TRIAL');

    const ok = await c.post('/api/billing/verify', { razorpay_order_id: orderId, razorpay_payment_id: 'pay_1', razorpay_signature: sign(orderId, 'pay_1') });
    expect(ok.statusCode).toBe(200);
    const t = (await db.query.tenants.findFirst({ where: eq(tenants.id, json.tenant.id) }))!;
    expect(t).toMatchObject({ plan: 'PAID', planId: 'team10', monthlyQuota: 25_000 });
    const days = (t.paidUntil!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);

    // Again (double click, or the webhook too): nothing changes
    await c.post('/api/billing/verify', { razorpay_order_id: orderId, razorpay_payment_id: 'pay_1', razorpay_signature: sign(orderId, 'pay_1') });
    const again = (await db.query.tenants.findFirst({ where: eq(tenants.id, json.tenant.id) }))!;
    expect(again.paidUntil!.getTime()).toBe(t.paidUntil!.getTime());

    // A smaller plan waits until the end of this one; a bigger one costs only the difference for the days left
    expect((await c.post('/api/billing/orders', { plan: 'team5', period: 'month' })).json().error).toBe('downgrade_later');
    const up = (await c.post('/api/billing/orders', { plan: 'team20', period: 'year' })).json();
    expect(up.kind).toBe('UPGRADE');
    expect(up.amount).toBeGreaterThan(240_000); // ₹2,500 a month more, for nearly a whole month
    expect(up.amount).toBeLessThanOrEqual(250_000);
    await c.post('/api/billing/verify', { razorpay_order_id: up.orderId, razorpay_payment_id: 'pay_2', razorpay_signature: sign(up.orderId, 'pay_2') });
    const upgraded = (await db.query.tenants.findFirst({ where: eq(tenants.id, json.tenant.id) }))!;
    expect(upgraded).toMatchObject({ planId: 'team20', monthlyQuota: 50_000 });
    expect(upgraded.paidUntil!.getTime()).toBe(t.paidUntil!.getTime());

    const summary = (await c.get('/api/billing')).json();
    expect(summary.payments).toHaveLength(2);
    expect(summary.current).toMatchObject({ plan: 'PAID', planId: 'team20' });
    expect(summary.seats).toEqual({ used: 0, limit: 20 });
  });

  it('only the agency owner pays, and only for their own orders', async () => {
    const a = await signup(app);
    const b = await signup(app);
    const orderId = (await api(app, a.cookie).post('/api/billing/orders', { plan: 'team5', period: 'year' })).json().orderId;
    const steal = await api(app, b.cookie).post('/api/billing/verify', { razorpay_order_id: orderId, razorpay_payment_id: 'pay_x', razorpay_signature: sign(orderId, 'pay_x') });
    expect(steal.statusCode).toBe(404);

    await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, a.json.user.id));
    expect((await api(app, a.cookie).post('/api/billing/orders', { plan: 'team5', period: 'month' })).statusCode).toBe(403);
    expect((await api(app, b.cookie).post('/api/billing/orders', { plan: 'gold', period: 'month' })).statusCode).toBe(400);
  });

  it('the webhook switches the plan on if the browser closed first', async () => {
    const { cookie, json } = await signup(app);
    const orderId = (await api(app, cookie).post('/api/billing/orders', { plan: 'team5', period: 'month' })).json().orderId;
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_9', order_id: orderId } } } });
    const wrong = await app.inject({ method: 'POST', url: '/webhooks/razorpay-billing', headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'x' }, payload: body });
    expect(wrong.statusCode).toBe(401);
    const sig = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
    const r = await app.inject({ method: 'POST', url: '/webhooks/razorpay-billing', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig }, payload: body });
    expect(r.statusCode).toBe(200);
    expect((await db.query.tenants.findFirst({ where: eq(tenants.id, json.tenant.id) }))).toMatchObject({ plan: 'PAID', planId: 'team5', monthlyQuota: 10_000 });
    const [p] = await db.select().from(billingPayments);
    expect(p).toMatchObject({ status: 'PAID', razorpayPaymentId: 'pay_9' });
  });
});

describe('plan periods', () => {
  it('renewing early adds to the time left', () => {
    const now = new Date('2026-11-06T10:00:00Z');
    const until = new Date('2026-11-20T10:00:00Z');
    expect(nextPeriod(until, 'month', now).end.toISOString()).toBe('2026-12-20T10:00:00.000Z');
    expect(nextPeriod(null, 'year', now).end.toISOString()).toBe('2027-11-06T10:00:00.000Z');
  });

  it('an unpaid plan ends 3 days after its date', async () => {
    const { json } = await signup(app);
    const ended = new Date(Date.now() - 4 * 86_400_000);
    await db.update(tenants).set({ plan: 'PAID', planId: 'team5', paidUntil: ended }).where(eq(tenants.id, json.tenant.id));
    expect((await runPlanExpiry()).lapsed).toBe(1);
    expect((await db.query.tenants.findFirst({ where: eq(tenants.id, json.tenant.id) }))!.plan).toBe('TRIAL');
  });

  it('the Pricing page shows the prices the server charges', () => {
    const web = readFileSync(new URL('../../web/src/lib/brand.ts', import.meta.url), 'utf8');
    for (const [id, p] of Object.entries(BILLING_PLANS)) {
      const block = web.slice(web.indexOf(`id: '${id}'`), web.indexOf('}', web.indexOf(`id: '${id}'`)));
      const num = (k: string) => Number(block.match(new RegExp(`${k}: ([\\d_]+)`))![1]!.replace(/_/g, ''));
      expect({ month: num('price'), year: num('yearly'), emails: num('emails') }).toEqual({ month: p.month, year: p.year, emails: p.emails });
    }
  });
});

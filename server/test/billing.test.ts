import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { auditLogs, billingPayments, tenants, users } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { BILLING_PLANS, monthlyPrice, nextPeriod } from '../src/modules/billing/plans.js';
import { useAi } from '../src/modules/plans/entitlements.js';
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

const tenantOf = (id: string) => db.query.tenants.findFirst({ where: eq(tenants.id, id) }).then((t) => t!);
async function payFor(c: ReturnType<typeof api>, body: Record<string, unknown>, paymentId: string) {
  const o = await c.post('/api/billing/orders', body);
  expect(o.statusCode).toBe(201);
  const { orderId } = o.json();
  const v = await c.post('/api/billing/verify', { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(orderId, paymentId) });
  expect(v.statusCode).toBe(200);
  return v.json();
}

describe('paying for a plan', () => {
  it('charges the server’s price for the plan and logins chosen, only with a valid signature, once', async () => {
    const { cookie, json } = await signup(app);
    const c = api(app, cookie);
    // Professional with 3 logins: ₹2,999 + 2 × ₹600
    const o = await c.post('/api/billing/orders', { plan: 'professional', seats: 3, period: 'month', amount: 100 }); // a browser can't set the price
    expect(o.statusCode).toBe(201);
    expect(o.json()).toMatchObject({ amount: 419_900, currency: 'INR', keyId: 'rzp_test_key', kind: 'NEW' });
    expect(orders[0]!.notes).toMatchObject({ plan: 'professional', seats: '3', period: 'month', tenant_id: json.tenant.id });
    const { orderId } = o.json();

    const bad = await c.post('/api/billing/verify', { razorpay_order_id: orderId, razorpay_payment_id: 'pay_1', razorpay_signature: 'nope' });
    expect(bad.statusCode).toBe(400);
    expect((await tenantOf(json.tenant.id)).plan).toBe('TRIAL');

    const ok = await c.post('/api/billing/verify', { razorpay_order_id: orderId, razorpay_payment_id: 'pay_1', razorpay_signature: sign(orderId, 'pay_1') });
    expect(ok.statusCode).toBe(200);
    const t = await tenantOf(json.tenant.id);
    expect(t).toMatchObject({ plan: 'PAID', planId: 'professional', seats: 3, monthlyQuota: 15_000 });
    expect(Math.round((t.paidUntil!.getTime() - Date.now()) / 86_400_000)).toBe(30);

    // Again (double click, or the webhook too): nothing changes
    await c.post('/api/billing/verify', { razorpay_order_id: orderId, razorpay_payment_id: 'pay_1', razorpay_signature: sign(orderId, 'pay_1') });
    expect((await tenantOf(json.tenant.id)).paidUntil!.getTime()).toBe(t.paidUntil!.getTime());

    // Yearly is 10 months' price; Basic with 1 login is ₹1,499
    expect((await c.post('/api/billing/quote', { plan: 'basic', seats: 1, period: 'month' })).json()).toMatchObject({ ok: false, reason: 'locked' });
    const summary = (await c.get('/api/billing')).json();
    expect(summary.current).toMatchObject({ plan: 'PAID', planId: 'professional', seats: 3 });
    expect(summary.seats).toEqual({ used: 0, limit: 3 });
    expect(summary.change.state).toBe('locked');
    expect(summary.entitlements).toMatchObject({ plan: 'professional', ai: true, aiPerDay: 120, automations: true, leadApi: false });
  });

  it('the plan and logins stay fixed during a period; the next period can be paid for in its last 5 days, with any plan', async () => {
    const { cookie, json } = await signup(app);
    const c = api(app, cookie);
    const id = json.tenant.id;
    await payFor(c, { plan: 'basic', seats: 2, period: 'month' }, 'pay_a');
    // Mid-period: no changes, bigger or smaller
    for (const body of [
      { plan: 'ultra', seats: 2, period: 'month' },
      { plan: 'basic', seats: 5, period: 'month' },
      { plan: 'basic', seats: 1, period: 'month' },
      { plan: 'basic', seats: 2, period: 'month' },
    ]) {
      expect((await c.post('/api/billing/quote', body)).json()).toMatchObject({ ok: false, reason: 'locked' });
    }
    const early = await c.post('/api/billing/orders', { plan: 'ultra', seats: 2, period: 'month' });
    expect(early.statusCode).toBe(409);
    expect(early.json().error).toBe('locked');
    // 4 days before the end, the window opens
    const until = new Date(Date.now() + 4 * 86_400_000);
    await db.update(tenants).set({ paidUntil: until }).where(eq(tenants.id, id));
    expect((await c.post('/api/billing/quote', { plan: 'basic', seats: 2, period: 'month' })).json()).toMatchObject({ ok: true, kind: 'RENEW', amount: 189_900 });
    const r = await payFor(c, { plan: 'ultra', seats: 4, period: 'year' }, 'pay_b');
    expect(new Date(r.startsAt).getTime()).toBe(until.getTime());
    // Paid, but the current period carries on as it was
    let t = await tenantOf(id);
    expect(t).toMatchObject({ planId: 'basic', seats: 2, monthlyQuota: 6_000 });
    expect(Math.round((t.paidUntil!.getTime() - until.getTime()) / 86_400_000)).toBe(365);
    expect((await c.post('/api/billing/quote', { plan: 'ultra', seats: 4, period: 'year' })).json().reason).toBe('already_paid');
    const [next] = await db.select().from(billingPayments).where(eq(billingPayments.razorpayPaymentId, 'pay_b'));
    expect(next).toMatchObject({ kind: 'CHANGE', seats: 4, amount: (4_999 + 3 * 900) * 10 * 100, appliedAt: null });
    expect((await c.get('/api/billing')).json().change).toMatchObject({ state: 'paid', next: { planId: 'ultra', seats: 4 } });

    // The day it starts, the new plan takes over
    expect((await runPlanExpiry(new Date(until.getTime() - 60_000))).applied).toBe(0);
    expect((await runPlanExpiry(new Date(until.getTime() + 60_000))).applied).toBe(1);
    t = await tenantOf(id);
    expect(t).toMatchObject({ planId: 'ultra', seats: 4, monthlyQuota: 40_000 });
    expect((await runPlanExpiry(new Date(until.getTime() + 120_000))).applied).toBe(0);
  });

  it('logins can’t be fewer than the employees switched on, and a smaller next period holds new logins back', async () => {
    const { cookie, json } = await signup(app);
    const c = api(app, cookie);
    for (let i = 1; i <= 3; i++) expect((await c.post('/api/agency/employees', { name: `E${i}`, username: `emp${i}`, password: 'password-1' })).statusCode).toBe(201);
    expect((await c.post('/api/billing/quote', { plan: 'basic', seats: 2, period: 'month' })).json()).toMatchObject({ reason: 'too_small' });
    await payFor(c, { plan: 'basic', seats: 5, period: 'month' }, 'pay_c');
    expect((await c.post('/api/agency/employees', { name: 'E4', username: 'emp4', password: 'password-1' })).statusCode).toBe(201);
    // Next period: 4 logins. A fifth can't be switched on now, though this period has room for it.
    await db.update(tenants).set({ paidUntil: new Date(Date.now() + 2 * 86_400_000) }).where(eq(tenants.id, json.tenant.id));
    await payFor(c, { plan: 'basic', seats: 4, period: 'month' }, 'pay_d');
    expect((await c.post('/api/agency/employees', { name: 'E5', username: 'emp5', password: 'password-1' })).json().error).toBe('seats_full');
  });

  it('only the agency owner pays, and only for their own orders', async () => {
    const a = await signup(app);
    const b = await signup(app);
    const orderId = (await api(app, a.cookie).post('/api/billing/orders', { plan: 'basic', seats: 1, period: 'year' })).json().orderId;
    const steal = await api(app, b.cookie).post('/api/billing/verify', { razorpay_order_id: orderId, razorpay_payment_id: 'pay_x', razorpay_signature: sign(orderId, 'pay_x') });
    expect(steal.statusCode).toBe(404);

    await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, a.json.user.id));
    expect((await api(app, a.cookie).post('/api/billing/orders', { plan: 'basic', seats: 1, period: 'month' })).statusCode).toBe(403);
    for (const bad of [{ plan: 'gold', seats: 1 }, { plan: 'basic', seats: 0 }, { plan: 'basic', seats: 51 }, { plan: 'basic', seats: 2.5 }]) {
      expect((await api(app, b.cookie).post('/api/billing/quote', { ...bad, period: 'month' })).statusCode).toBe(400);
    }
  });

  it('the webhook switches the plan on if the browser closed first', async () => {
    const { cookie, json } = await signup(app);
    const orderId = (await api(app, cookie).post('/api/billing/orders', { plan: 'basic', seats: 2, period: 'month' })).json().orderId;
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_9', order_id: orderId } } } });
    const wrong = await app.inject({ method: 'POST', url: '/webhooks/razorpay-billing', headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'x' }, payload: body });
    expect(wrong.statusCode).toBe(401);
    const sig = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
    const r = await app.inject({ method: 'POST', url: '/webhooks/razorpay-billing', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig }, payload: body });
    expect(r.statusCode).toBe(200);
    expect(await tenantOf(json.tenant.id)).toMatchObject({ plan: 'PAID', planId: 'basic', seats: 2, monthlyQuota: 6_000 });
    const [p] = await db.select().from(billingPayments);
    expect(p).toMatchObject({ status: 'PAID', razorpayPaymentId: 'pay_9' });
  });
});

describe('what each plan has', () => {
  it('Basic has no Drona AI, automatic messages, group departures or leads API; the trial has everything', async () => {
    const { cookie, json } = await signup(app);
    const c = api(app, cookie);
    expect((await c.get('/api/auth/me')).json().tenant.plan.entitlements).toMatchObject({ plan: 'ultra', source: 'trial', ai: true, automations: true });
    await db.update(tenants).set({ plan: 'PAID', planId: 'basic', seats: 1, paidUntil: new Date(Date.now() + 20 * 86_400_000) }).where(eq(tenants.id, json.tenant.id));
    const locked = async (method: 'post', url: string, body: unknown = {}) => {
      const r = await c[method](url, body);
      expect(r.statusCode, url).toBe(403);
      expect(r.json().error).toBe('plan_upgrade');
      return r.json().message as string;
    };
    expect(await locked('post', '/api/groups', { title: 'Kashi yatra' })).toMatch(/Professional plan/);
    expect(await locked('post', '/api/api-keys', { name: 'Call agent' })).toMatch(/Ultra Premium plan/);
    expect(await locked('post', '/api/automations', {})).toMatch(/Automatic messages/);
    expect((await c.get('/api/ai')).json()).toMatchObject({ enabled: false, inPlan: false });
    expect((await c.get('/api/auth/me')).json().tenant.plan.entitlements).toMatchObject({ plan: 'basic', seats: 1, ai: false, domains: 1 });
  });

  it('Drona AI answers a day: 40 per login on Professional, replies and quote drafts together', async () => {
    const { json } = await signup(app);
    await db.update(tenants).set({ plan: 'PAID', planId: 'professional', seats: 1, paidUntil: new Date(Date.now() + 20 * 86_400_000) }).where(eq(tenants.id, json.tenant.id));
    await db.insert(auditLogs).values(Array.from({ length: 40 }, (_, i) => ({ tenantId: json.tenant.id, action: i % 2 ? 'ai.reply' : 'ai.draft', entity: 'x' })));
    await expect(useAi(json.tenant.id)).rejects.toMatchObject({ code: 'ai_limit' });
    await db.update(tenants).set({ seats: 2 }).where(eq(tenants.id, json.tenant.id));
    await expect(useAi(json.tenant.id)).resolves.toEqual({ limit: 80, used: 40 });
  });
});

describe('plan periods', () => {
  it('a month is 30 days and a year 365, from where the paid time ends', () => {
    const now = new Date('2026-11-06T10:00:00Z');
    const until = new Date('2026-11-20T10:00:00Z');
    expect(nextPeriod(until, 'month', now).end.toISOString()).toBe('2026-12-20T10:00:00.000Z');
    expect(nextPeriod(null, 'year', now).end.toISOString()).toBe('2027-11-06T10:00:00.000Z');
    expect(monthlyPrice('basic', 1)).toBe(1_499);
    expect(monthlyPrice('professional', 10)).toBe(2_999 + 9 * 600);
    expect(monthlyPrice('ultra', 50)).toBe(4_999 + 49 * 900);
  });

  it('an unpaid plan ends 3 days after its date', async () => {
    const { json } = await signup(app);
    const ended = new Date(Date.now() - 4 * 86_400_000);
    await db.update(tenants).set({ plan: 'PAID', planId: 'basic', seats: 1, paidUntil: ended }).where(eq(tenants.id, json.tenant.id));
    expect((await runPlanExpiry()).lapsed).toBe(1);
    expect((await tenantOf(json.tenant.id)).plan).toBe('TRIAL');
  });

  it('the Pricing page shows the prices the server charges', () => {
    const web = readFileSync(new URL('../../web/src/lib/brand.ts', import.meta.url), 'utf8');
    for (const [id, p] of Object.entries(BILLING_PLANS)) {
      const at = web.indexOf(`{ id: '${id}'`);
      expect(at, id).toBeGreaterThan(-1);
      const block = web.slice(at, web.indexOf('}', at));
      const num = (k: string) => Number(block.match(new RegExp(`${k}: ([\\d_]+)`))![1]!.replace(/_/g, ''));
      expect({ first: num('first'), extra: num('extra'), emails: num('emailsPerLogin'), ai: num('aiPerLogin'), domains: num('domains') }).toEqual({
        first: p.first,
        extra: p.extra,
        emails: p.emailsPerLogin,
        ai: p.aiPerLogin,
        domains: p.domains,
      });
      expect(block).toContain(`name: '${p.name}'`);
    }
    // The feature table's per-login numbers too
    expect(web).toContain('(3_000 * n)');
    expect(web).toContain('(5_000 * n)');
    expect(web).toContain('(10_000 * n)');
    expect(web).toContain('`${40 * n} a day`');
    expect(web).toContain('`${100 * n} a day`');
  });
});

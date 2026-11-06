import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNotNull, lte } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { auditLogs, billingPayments, tenants, type BillingPayment } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import { notify } from '../notifications/service.js';
import { BILLING_PLANS, nextPeriod, pricePaise, type Period, type PlanId } from './plans.js';

/**
 * Agencies paying Dhrona for their plan, through the platform's Razorpay account
 * (Standard Checkout): we create an order for the plan's price, the browser opens Razorpay's
 * payment window, and the plan switches on only after Razorpay's signature is checked here.
 * The webhook does the same if the browser closes before telling us.
 */

export const billingEnabled = () => !!(env.BILLING_RAZORPAY_KEY_ID && env.BILLING_RAZORPAY_KEY_SECRET);

export interface BillingGateway {
  createOrder(input: { amount: number; receipt: string; notes: Record<string, string> }): Promise<{ id: string; amount: number; currency: string }>;
}

class BillingError extends AppError {}

const httpGateway: BillingGateway = {
  async createOrder(input) {
    const auth = Buffer.from(`${env.BILLING_RAZORPAY_KEY_ID}:${env.BILLING_RAZORPAY_KEY_SECRET}`).toString('base64');
    let res: Response;
    try {
      res = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
        body: JSON.stringify({ amount: input.amount, currency: 'INR', receipt: input.receipt, notes: input.notes }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new BillingError(502, 'razorpay_unreachable', 'Couldn’t reach Razorpay. Try again in a minute.');
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string; amount?: number; currency?: string; error?: { description?: string } };
    if (res.status === 401) {
      logger.error('Razorpay rejected the billing keys');
      throw new BillingError(502, 'razorpay_auth', 'Online payment isn’t working right now. Please write to support.');
    }
    if (!res.ok || !data.id) throw new BillingError(502, 'razorpay_error', data.error?.description ?? 'Razorpay couldn’t start the payment. Try again.');
    return { id: data.id, amount: data.amount ?? input.amount, currency: data.currency ?? 'INR' };
  },
};

let gateway: BillingGateway = httpGateway;
export function setBillingGateway(g: BillingGateway) {
  gateway = g;
}

const hmac = (data: string, secret: string) => createHmac('sha256', secret).update(data).digest('hex');
function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Checkout's proof of payment: HMAC-SHA256(order_id + "|" + payment_id) with the key secret. */
export function validCheckoutSignature(orderId: string, paymentId: string, signature: string) {
  return safeEqual(hmac(`${orderId}|${paymentId}`, env.BILLING_RAZORPAY_KEY_SECRET ?? ''), signature);
}

export async function createBillingOrder(tenantId: string, userId: string, plan: PlanId, period: Period) {
  if (!billingEnabled()) throw new AppError(503, 'billing_off', 'Online payment isn’t switched on yet. Write to support to upgrade.');
  // While a plan is running, only that plan can be renewed online; a change mid-period is done by support, fairly
  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId), columns: { plan: true, planId: true, paidUntil: true } });
  if (t?.plan === 'PAID' && t.planId && t.planId !== plan && t.paidUntil && t.paidUntil.getTime() > Date.now()) {
    throw new AppError(409, 'plan_switch', 'To change plan while yours is running, write to support and we’ll move you over without losing the days you’ve paid for.');
  }
  const amount = pricePaise(plan, period);
  const receipt = `dhr_${tenantId.slice(0, 12)}_${Date.now().toString(36)}`;
  const order = await gateway.createOrder({ amount, receipt, notes: { tenant_id: tenantId, plan, period } });
  await db.insert(billingPayments).values({ tenantId, planId: plan, period, amount: order.amount, currency: order.currency, razorpayOrderId: order.id, createdById: userId });
  return { orderId: order.id, amount: order.amount, currency: order.currency, keyId: env.BILLING_RAZORPAY_KEY_ID! };
}

/**
 * Switches the plan on for a paid order. Safe to call twice (the browser and the webhook both
 * may): the second call finds the payment already PAID and changes nothing.
 */
export async function activatePayment(orderId: string, paymentId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(billingPayments).where(eq(billingPayments.razorpayOrderId, orderId)).for('update');
    if (!p) throw new AppError(404, 'order_not_found', 'This payment isn’t one we started');
    if (p.status === 'PAID') return { payment: p, already: true };
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, p.tenantId)).for('update');
    const plan = BILLING_PLANS[p.planId as PlanId];
    const { start, end } = nextPeriod(t!.plan === 'PAID' ? t!.paidUntil : null, p.period as Period, now);
    const [paid] = await tx
      .update(billingPayments)
      .set({ status: 'PAID', razorpayPaymentId: paymentId, paidAt: now, periodStart: start, periodEnd: end })
      .where(eq(billingPayments.id, p.id))
      .returning();
    await tx
      .update(tenants)
      .set({ plan: 'PAID', planId: p.planId, paidUntil: end, monthlyQuota: plan.emails, trialEndedAt: null, updatedAt: now })
      .where(eq(tenants.id, p.tenantId));
    await tx.insert(auditLogs).values({
      tenantId: p.tenantId,
      userId: p.createdById,
      action: 'billing.paid',
      entity: 'billing_payment',
      entityId: p.id,
      meta: { plan: p.planId, period: p.period, amount: p.amount, paymentId, until: end.toISOString() },
    });
    return { payment: paid!, already: false };
  });
}

export async function verifyCheckout(tenantId: string, input: { orderId: string; paymentId: string; signature: string }) {
  if (!billingEnabled()) throw new AppError(503, 'billing_off', 'Online payment isn’t switched on');
  if (!validCheckoutSignature(input.orderId, input.paymentId, input.signature)) {
    logger.warn({ tenantId, orderId: input.orderId }, 'billing: checkout signature mismatch');
    throw new AppError(400, 'invalid_signature', 'We couldn’t confirm this payment. If money was taken, write to support with the payment ID.');
  }
  const owned = await db.query.billingPayments.findFirst({ where: and(eq(billingPayments.razorpayOrderId, input.orderId), eq(billingPayments.tenantId, tenantId)) });
  if (!owned) throw new AppError(404, 'order_not_found', 'This payment isn’t one we started');
  const r = await activatePayment(input.orderId, input.paymentId);
  if (!r.already) await thankYou(r.payment);
  return r.payment;
}

/** Razorpay → us, for payments whose browser closed before it could tell us. */
export async function handleBillingWebhook(raw: string, signature: string | undefined) {
  const secret = env.BILLING_RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return { status: 404, body: { error: 'not_configured' } };
  if (!signature || !safeEqual(hmac(raw, secret), signature)) return { status: 401, body: { error: 'invalid_signature' } };
  let event: { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string } } } };
  try {
    event = JSON.parse(raw);
  } catch {
    return { status: 400, body: { error: 'bad_json' } };
  }
  const pay = event.payload?.payment?.entity;
  if (!['payment.captured', 'order.paid'].includes(event.event ?? '') || !pay?.id || !pay.order_id) return { status: 200, body: { ok: true, ignored: event.event } };
  try {
    const r = await activatePayment(pay.order_id, pay.id);
    if (!r.already) await thankYou(r.payment);
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 404) return { status: 200, body: { ok: true, ignored: 'unknown_order' } }; // an order from elsewhere on the account
    throw err;
  }
  return { status: 200, body: { ok: true } };
}

const dateIn = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

async function thankYou(p: BillingPayment) {
  const plan = BILLING_PLANS[p.planId as PlanId];
  await notify(p.tenantId, {
    type: 'billing.paid',
    level: 'SUCCESS',
    title: `Thank you: ${plan.name} plan is active`,
    body: `Paid ₹${(p.amount / 100).toLocaleString('en-IN')}. Your plan runs until ${dateIn(p.periodEnd!)}, with ${plan.emails.toLocaleString('en-IN')} emails a month.`,
    link: '/settings/billing',
    dedupeKey: `billing.paid:${p.id}`,
  });
}

export async function billingSummary(tenantId: string) {
  const [t, payments] = await Promise.all([
    db.query.tenants.findFirst({ where: eq(tenants.id, tenantId), columns: { plan: true, planId: true, paidUntil: true, monthlyQuota: true, trialEndsAt: true } }),
    db.select().from(billingPayments).where(and(eq(billingPayments.tenantId, tenantId), eq(billingPayments.status, 'PAID'))).orderBy(desc(billingPayments.paidAt)).limit(24),
  ]);
  return {
    enabled: billingEnabled(),
    plans: Object.entries(BILLING_PLANS).map(([id, p]) => ({ id, ...p })),
    current: { plan: t!.plan, planId: t!.planId, paidUntil: t!.paidUntil, monthlyQuota: t!.monthlyQuota, trialEndsAt: t!.trialEndsAt },
    payments: payments.map((p) => ({
      id: p.id,
      planId: p.planId,
      period: p.period,
      amount: p.amount,
      paidAt: p.paidAt,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      paymentId: p.razorpayPaymentId,
    })),
  };
}

const GRACE_DAYS = 3;

/**
 * With the maintenance tick: a reminder 3 days before a paid plan runs out; and 3 days after it
 * runs out unpaid, the account goes back to the ended state (the trial clean-up then turns sending off).
 */
export async function runPlanExpiry(now = new Date()) {
  const soon = new Date(now.getTime() + GRACE_DAYS * 86_400_000);
  const ending = await db
    .select({ id: tenants.id, paidUntil: tenants.paidUntil })
    .from(tenants)
    .where(and(eq(tenants.plan, 'PAID'), isNotNull(tenants.paidUntil), gt(tenants.paidUntil, now), lte(tenants.paidUntil, soon)));
  for (const t of ending) {
    await notify(t.id, {
      type: 'billing.ending',
      level: 'WARNING',
      title: `Your plan runs until ${dateIn(t.paidUntil!)}`,
      body: 'Renew in Plan & billing to keep your reminders and broadcasts going.',
      link: '/settings/billing',
      dedupeKey: `billing.ending:${t.paidUntil!.toISOString().slice(0, 10)}`,
    });
  }
  const cutoff = new Date(now.getTime() - GRACE_DAYS * 86_400_000);
  const lapsed = await db
    .update(tenants)
    .set({ plan: 'TRIAL', trialEndsAt: now, trialEndedAt: null })
    .where(and(eq(tenants.plan, 'PAID'), isNotNull(tenants.paidUntil), lte(tenants.paidUntil, cutoff)))
    .returning({ id: tenants.id });
  return { reminded: ending.length, lapsed: lapsed.length };
}

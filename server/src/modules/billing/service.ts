import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNotNull, isNull, lte } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { auditLogs, billingPayments, tenants, type BillingPayment } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import { notify } from '../notifications/service.js';
import { entitlements } from '../plans/entitlements.js';
import { seatLimit, seatsUsed } from '../team/service.js';
import {
  BILLING_PLANS,
  CHANGE_WINDOW_DAYS,
  emailsFor,
  isPlanId,
  MAX_SEATS,
  MIN_SEATS,
  nextPeriod,
  PLAN_IDS,
  pricePaise,
  validSeats,
  YEAR_MONTHS,
  type Period,
  type PlanId,
} from './plans.js';

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

const withGst = (base: number) => {
  const gst = Math.round((base * env.BILLING_GST_PERCENT) / 100);
  return { amount: base + gst, gst };
};

const DAY = 86_400_000;
const dateIn = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** A payment already made for the period after this one (it takes effect when this one ends). */
const upcoming = (tenantId: string) =>
  db.query.billingPayments.findFirst({ where: and(eq(billingPayments.tenantId, tenantId), eq(billingPayments.status, 'PAID'), isNull(billingPayments.appliedAt)) });

/**
 * Where the agency stands for changing its plan: during a paid period the plan and logins are
 * fixed; payment for the next period (with any plan and logins) opens 5 days before it ends.
 */
export async function changeWindow(tenantId: string, now = new Date()) {
  const t = (await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }))!;
  const active = t.plan === 'PAID' && isPlanId(t.planId) && t.paidUntil && t.paidUntil.getTime() > now.getTime() ? t.paidUntil : null;
  if (!active) return { state: 'open' as const, startsAt: now, opensAt: null, next: null };
  const next = await upcoming(tenantId);
  if (next) return { state: 'paid' as const, startsAt: next.periodStart!, opensAt: null, next };
  const opensAt = new Date(active.getTime() - CHANGE_WINDOW_DAYS * DAY);
  return { state: opensAt.getTime() <= now.getTime() ? ('open' as const) : ('locked' as const), startsAt: active, opensAt, next: null };
}

/** What paying for this plan with this many logins would mean right now. */
export async function quote(tenantId: string, plan: PlanId, seats: number, period: Period, now = new Date()) {
  if (!validSeats(seats)) return { ok: false as const, reason: 'bad_seats', message: `Choose ${MIN_SEATS} to ${MAX_SEATS} employee logins. For more, write to us.` };
  const t = (await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }))!;
  const w = await changeWindow(tenantId, now);
  if (w.state === 'paid') {
    return { ok: false as const, reason: 'already_paid', message: `You’ve already paid for your next billing cycle. It starts on ${dateIn(w.startsAt)}.` };
  }
  if (w.state === 'locked') {
    return {
      ok: false as const,
      reason: 'locked',
      message: `Your plan and logins stay as they are until ${dateIn(w.startsAt)}. From ${dateIn(w.opensAt!)} you can pay for the next billing cycle, with any plan and number of logins.`,
    };
  }
  const employees = await seatsUsed(tenantId);
  if (employees > seats) {
    const off = employees - seats;
    return { ok: false as const, reason: 'too_small', message: `You have ${employees} employee logins switched on. Switch off ${off} in Team first, or choose ${employees} or more.` };
  }
  const renewing = t.plan === 'PAID' && isPlanId(t.planId) && t.paidUntil && t.paidUntil.getTime() > now.getTime();
  const same = renewing && t.planId === plan && t.seats === seats;
  const kind = !renewing ? ('NEW' as const) : same ? ('RENEW' as const) : ('CHANGE' as const);
  return { ok: true as const, kind, period, seats, startsAt: w.startsAt, ...withGst(pricePaise(plan, seats, period)) };
}

export async function createBillingOrder(tenantId: string, userId: string, plan: PlanId, seats: number, period: Period) {
  if (!billingEnabled()) throw new AppError(503, 'billing_off', 'Online payment isn’t switched on yet. Write to support to upgrade.');
  const q = await quote(tenantId, plan, seats, period);
  if (!q.ok) throw new AppError(409, q.reason, q.message);
  const receipt = `dhr_${tenantId.slice(0, 12)}_${Date.now().toString(36)}`;
  const order = await gateway.createOrder({ amount: q.amount, receipt, notes: { tenant_id: tenantId, plan, seats: String(seats), period, kind: q.kind } });
  await db.insert(billingPayments).values({
    tenantId,
    planId: plan,
    seats,
    period,
    kind: q.kind,
    amount: order.amount,
    gst: q.gst,
    currency: order.currency,
    razorpayOrderId: order.id,
    createdById: userId,
  });
  return { orderId: order.id, amount: order.amount, currency: order.currency, keyId: env.BILLING_RAZORPAY_KEY_ID!, kind: q.kind };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The plan and logins a payment bought take effect. */
async function applyPayment(tx: Tx, p: BillingPayment, now: Date) {
  const plan = p.planId as PlanId;
  await tx.update(tenants).set({ planId: plan, seats: p.seats, monthlyQuota: emailsFor(plan, p.seats), updatedAt: now }).where(eq(tenants.id, p.tenantId));
  await tx.update(billingPayments).set({ appliedAt: now }).where(eq(billingPayments.id, p.id));
}

/**
 * Switches the plan on for a paid order. Safe to call twice (the browser and the webhook both
 * may): the second call finds the payment already PAID and changes nothing.
 * Paid during a period, it buys the next one: the new plan and logins wait until then.
 */
export async function activatePayment(orderId: string, paymentId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(billingPayments).where(eq(billingPayments.razorpayOrderId, orderId)).for('update');
    if (!p) throw new AppError(404, 'order_not_found', 'This payment isn’t one we started');
    if (p.status === 'PAID') return { payment: p, already: true };
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, p.tenantId)).for('update');
    const { start, end } = nextPeriod(t!.plan === 'PAID' ? t!.paidUntil : null, p.period as Period, now);
    const [paid] = await tx
      .update(billingPayments)
      .set({ status: 'PAID', razorpayPaymentId: paymentId, paidAt: now, periodStart: start, periodEnd: end })
      .where(eq(billingPayments.id, p.id))
      .returning();
    await tx.update(tenants).set({ plan: 'PAID', paidUntil: end, trialEndedAt: null, updatedAt: now }).where(eq(tenants.id, p.tenantId));
    if (start.getTime() <= now.getTime()) await applyPayment(tx, paid!, now);
    await tx.insert(auditLogs).values({
      tenantId: p.tenantId,
      userId: p.createdById,
      action: 'billing.paid',
      entity: 'billing_payment',
      entityId: p.id,
      meta: { plan: p.planId, seats: p.seats, period: p.period, amount: p.amount, paymentId, from: start.toISOString(), until: end.toISOString() },
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

const planLine = (plan: PlanId, seats: number) => `${BILLING_PLANS[plan].name}, ${seats} employee login${seats > 1 ? 's' : ''}`;

async function thankYou(p: BillingPayment) {
  const plan = p.planId as PlanId;
  const later = p.periodStart!.getTime() > (p.paidAt ?? new Date()).getTime() + 60_000;
  await notify(p.tenantId, {
    type: 'billing.paid',
    level: 'SUCCESS',
    title: later ? `Paid: ${planLine(plan, p.seats)} from ${dateIn(p.periodStart!)}` : `Thank you: ${planLine(plan, p.seats)} is active`,
    body: `Paid ₹${(p.amount / 100).toLocaleString('en-IN')}. ${emailsFor(plan, p.seats).toLocaleString('en-IN')} emails a month, ${dateIn(p.periodStart!)} to ${dateIn(p.periodEnd!)}.`,
    link: '/agency/billing',
    dedupeKey: `billing.paid:${p.id}`,
  });
}

export async function billingSummary(tenantId: string) {
  const [t, payments, employees, window] = await Promise.all([
    db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }),
    db.select().from(billingPayments).where(and(eq(billingPayments.tenantId, tenantId), eq(billingPayments.status, 'PAID'))).orderBy(desc(billingPayments.paidAt)).limit(24),
    seatsUsed(tenantId),
    changeWindow(tenantId),
  ]);
  const last = payments.find((p) => p.appliedAt);
  return {
    enabled: billingEnabled(),
    gstPercent: env.BILLING_GST_PERCENT,
    plans: PLAN_IDS.map((id) => ({ id, ...BILLING_PLANS[id] })),
    limits: { minSeats: MIN_SEATS, maxSeats: MAX_SEATS, yearMonths: YEAR_MONTHS, windowDays: CHANGE_WINDOW_DAYS },
    seats: { used: employees, limit: seatLimit(t!) },
    entitlements: entitlements(t!),
    current: {
      plan: t!.plan,
      planId: isPlanId(t!.planId) ? t!.planId : null,
      seats: t!.seats,
      period: last?.period ?? 'month',
      paidUntil: t!.paidUntil,
      monthlyQuota: t!.monthlyQuota,
      trialEndsAt: t!.trialEndsAt,
    },
    // Can the owner pay now: 'open' (yes, from startsAt), 'locked' (from opensAt), 'paid' (next period already paid)
    change: {
      state: window.state,
      startsAt: window.startsAt,
      opensAt: window.opensAt,
      next: window.next ? { planId: window.next.planId, seats: window.next.seats, period: window.next.period, periodStart: window.next.periodStart, periodEnd: window.next.periodEnd } : null,
    },
    payments: payments.map((p) => ({
      id: p.id,
      planId: p.planId,
      seats: p.seats,
      period: p.period,
      kind: p.kind,
      amount: p.amount,
      gst: p.gst,
      paidAt: p.paidAt,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      paymentId: p.razorpayPaymentId,
    })),
  };
}

/** For the plan page: the price and what paying would mean, for a choice the owner is looking at. */
export async function billingQuote(tenantId: string, plan: PlanId, seats: number, period: Period) {
  const q = await quote(tenantId, plan, seats, period);
  return q.ok ? { ok: true, kind: q.kind, amount: q.amount, gst: q.gst, startsAt: q.startsAt } : { ok: false, reason: q.reason, message: q.message };
}

const GRACE_DAYS = 3;

/**
 * With the maintenance tick:
 * - a payment for the next period takes effect when that period starts (its plan, logins and emails);
 * - a reminder 5 days before a paid plan runs out, when payment for the next period opens;
 * - 3 days after it runs out unpaid, the account goes back to the ended state (the trial clean-up then turns sending off).
 */
export async function runPlanExpiry(now = new Date()) {
  const due = await db
    .select()
    .from(billingPayments)
    .where(and(eq(billingPayments.status, 'PAID'), isNull(billingPayments.appliedAt), lte(billingPayments.periodStart, now)));
  for (const p of due) {
    await db.transaction((tx) => applyPayment(tx, p, now));
    // Fewer logins than before: tell the owner if more people are still switched on
    const on = await seatsUsed(p.tenantId);
    if (on > p.seats) {
      await notify(p.tenantId, {
        type: 'billing.seats',
        level: 'WARNING',
        title: `${on} employee logins are on; your plan now has ${p.seats}`,
        body: 'Switch off the logins you no longer need in Team. Nobody new can be added until then.',
        link: '/agency/team',
        dedupeKey: `billing.seats:${p.id}`,
      });
    }
  }

  const soon = new Date(now.getTime() + CHANGE_WINDOW_DAYS * DAY);
  const ending = await db
    .select({ id: tenants.id, paidUntil: tenants.paidUntil })
    .from(tenants)
    .where(and(eq(tenants.plan, 'PAID'), isNotNull(tenants.paidUntil), gt(tenants.paidUntil, now), lte(tenants.paidUntil, soon)));
  for (const t of ending) {
    await notify(t.id, {
      type: 'billing.ending',
      level: 'WARNING',
      title: `Your plan runs until ${dateIn(t.paidUntil!)}`,
      body: 'Pay for the next billing cycle in Plan & billing. You can change your plan and number of logins now.',
      link: '/agency/billing',
      dedupeKey: `billing.ending:${t.paidUntil!.toISOString().slice(0, 10)}`,
    });
  }
  const cutoff = new Date(now.getTime() - GRACE_DAYS * DAY);
  const lapsed = await db
    .update(tenants)
    .set({ plan: 'TRIAL', trialEndsAt: now, trialEndedAt: null })
    .where(and(eq(tenants.plan, 'PAID'), isNotNull(tenants.paidUntil), lte(tenants.paidUntil, cutoff)))
    .returning({ id: tenants.id });
  return { applied: due.length, reminded: ending.length, lapsed: lapsed.length };
}

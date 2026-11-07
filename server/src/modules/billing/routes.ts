import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseBody } from '../../lib/http.js';
import { requireAuth, requireRole, tenantOf } from '../auth/guard.js';
import { MAX_SEATS, MIN_SEATS, PLAN_IDS, type PlanId } from './plans.js';
import { billingQuote, billingSummary, createBillingOrder, handleBillingWebhook, verifyCheckout } from './service.js';

const orderBody = z.object({
  plan: z.enum(PLAN_IDS as [PlanId, ...PlanId[]]),
  seats: z.coerce.number().int().min(MIN_SEATS).max(MAX_SEATS),
  period: z.enum(['month', 'year']),
});
const verifyBody = z.object({
  razorpay_order_id: z.string().min(1).max(64),
  razorpay_payment_id: z.string().min(1).max(64),
  razorpay_signature: z.string().min(1).max(256),
});

export async function billingRoutes(app: FastifyInstance) {
  app.get('/api/billing', { preHandler: requireAuth }, async (req) => billingSummary(tenantOf(req)));

  // Only the agency owner pays; the price comes from the server, never from the browser
  app.post('/api/billing/orders', { preHandler: [requireAuth, requireRole('OWNER')], config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parseBody(orderBody, req.body);
    return reply.code(201).send(await createBillingOrder(tenantOf(req), req.auth!.userId, b.plan, b.seats, b.period));
  });

  app.post('/api/billing/quote', { preHandler: [requireAuth, requireRole('OWNER')], config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const b = parseBody(orderBody, req.body);
    return billingQuote(tenantOf(req), b.plan, b.seats, b.period);
  });

  app.post('/api/billing/verify', { preHandler: [requireAuth, requireRole('OWNER')], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const b = parseBody(verifyBody, req.body);
    const p = await verifyCheckout(tenantOf(req), { orderId: b.razorpay_order_id, paymentId: b.razorpay_payment_id, signature: b.razorpay_signature });
    return { ok: true, paidUntil: p.periodEnd, plan: p.planId, seats: p.seats, startsAt: p.periodStart };
  });

  // Razorpay → us. Own scope, so the signature is checked against the raw body.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    scope.post('/webhooks/razorpay-billing', async (req, reply) => {
      const r = await handleBillingWebhook(typeof req.body === 'string' ? req.body : '', req.headers['x-razorpay-signature'] as string | undefined);
      return reply.code(r.status).send(r.body);
    });
  });
}

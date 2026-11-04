import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { tenants, trips, type Tenant } from '../../db/schema.js';
import { decryptSecret } from '../../lib/crypto.js';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { notify } from '../notifications/service.js';
import { formatInr, localDate, tripMoney, type DueInput } from '../trips/money.js';
import { recordPayment } from '../trips/service.js';
import { resolvedSettings } from './settings.js';

/**
 * Online payments through the agency's OWN Razorpay account: we create a payment link with
 * their keys, the money goes to them, and Razorpay's webhook tells us it was paid, so the
 * payment is recorded and the receipt exists without anyone typing it in.
 */

export interface PaymentLinkInput {
  amount: number; // paise
  description: string;
  referenceId: string;
  customer: { name: string; contact?: string; email?: string };
  notes: Record<string, string>;
  callbackUrl: string;
}

export interface RazorpayClient {
  createPaymentLink(creds: { keyId: string; keySecret: string }, input: PaymentLinkInput): Promise<{ id: string; shortUrl: string }>;
}

export class RazorpayError extends Error {}

const httpClient: RazorpayClient = {
  async createPaymentLink(creds, input) {
    const res = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString('base64')}` },
      body: JSON.stringify({
        amount: input.amount,
        currency: 'INR',
        accept_partial: false,
        description: input.description.slice(0, 2048),
        reference_id: input.referenceId.slice(0, 40),
        customer: input.customer,
        notify: { sms: false, email: false }, // we already message them
        reminder_enable: false,
        notes: input.notes,
        callback_url: input.callbackUrl,
        callback_method: 'get',
        expire_by: Math.floor(Date.now() / 1000) + 7 * 86_400,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; short_url?: string; error?: { description?: string } };
    if (!res.ok || !data.id || !data.short_url) throw new RazorpayError(data.error?.description ?? `Razorpay answered ${res.status}`);
    return { id: data.id, shortUrl: data.short_url };
  },
};

let client: RazorpayClient = httpClient;
export function setRazorpayClient(c: RazorpayClient) {
  client = c;
}

export function razorpayCreds(t: Pick<Tenant, 'paymentSettings'>) {
  const s = resolvedSettings(t);
  if (!s.razorpayKeyId || !s.razorpaySecretEnc) return null;
  return { keyId: s.razorpayKeyId, keySecret: decryptSecret(s.razorpaySecretEnc), webhookSecret: s.razorpayWebhookSecretEnc ? decryptSecret(s.razorpayWebhookSecretEnc) : null };
}

/** Razorpay signs the raw body with the webhook secret (HMAC-SHA256, hex). */
export function validRazorpaySignature(rawBody: string, signature: string | undefined, secret: string) {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** What the customer should pay now: anything overdue, else the next instalment, else the balance. */
export function amountDueNow(m: ReturnType<typeof tripMoney>) {
  return m.overdue > 0 ? m.overdue : m.nextDue ? m.nextDue.remaining : Math.max(0, m.balance);
}

export async function razorpayRoutes(app: FastifyInstance) {
  // From the customer's page: make a payment link for what's due now, and send them to it
  app.post<{ Params: { token: string } }>(
    '/p/:token/pay',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const back = `/p/${req.params.token}`;
      const trip = await db.query.trips.findFirst({ where: eq(trips.publicToken, req.params.token), with: { dues: true, payments: true, contact: true } });
      if (!trip || trip.status === 'LOST' || trip.status === 'CANCELLED') return reply.redirect(back, 303);
      const tenant = (await db.query.tenants.findFirst({ where: eq(tenants.id, trip.tenantId) }))!;
      const creds = razorpayCreds(tenant);
      const m = tripMoney({ price: trip.price, dues: trip.dues as DueInput[], payments: trip.payments }, localDate(tenant.timezone));
      const amount = amountDueNow(m);
      if (!creds || amount < 100) return reply.redirect(back, 303);
      try {
        const link = await client.createPaymentLink(creds, {
          amount,
          description: `${trip.title} (trip #${trip.number}) · ${tenant.name}`,
          referenceId: `T${trip.number}-${Date.now().toString(36)}`,
          customer: { name: trip.customerName, ...(trip.contact?.phone ? { contact: trip.contact.phone } : {}), ...(trip.contact?.email ? { email: trip.contact.email } : {}) },
          notes: { trip_id: trip.id, tenant_id: tenant.id },
          callbackUrl: `${env.PUBLIC_URL.replace(/\/$/, '')}${back}?paid=1`,
        });
        return reply.redirect(link.shortUrl, 303);
      } catch (err) {
        req.log.error({ err, tripId: trip.id }, 'could not create Razorpay payment link');
        await notify(tenant.id, {
          type: 'payments.razorpay_error',
          level: 'ERROR',
          title: 'A customer couldn’t pay online',
          body: `Razorpay refused to create a payment link: ${(err as Error).message}. Check the keys in Settings → Payments.`,
          link: '/settings/payments',
          dedupeKey: `razorpay.error:${tenant.id}:${new Date().toISOString().slice(0, 13)}`,
        });
        return reply.redirect(`${back}?error=online`, 303);
      }
    },
  );

  // Razorpay → us. Kept in its own scope so this route sees the raw body (the signature covers it byte for byte).
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    scope.post<{ Params: { tenantId: string } }>('/webhooks/razorpay/:tenantId', async (req, reply) => {
      const raw = typeof req.body === 'string' ? req.body : '';
      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, req.params.tenantId) });
      const creds = tenant ? razorpayCreds(tenant) : null;
      if (!tenant || !creds?.webhookSecret) return reply.code(404).send({ error: 'not_configured' });
      if (!validRazorpaySignature(raw, req.headers['x-razorpay-signature'] as string | undefined, creds.webhookSecret)) {
        req.log.warn({ tenantId: tenant.id }, 'rejected Razorpay webhook with bad signature');
        return reply.code(401).send({ error: 'invalid_signature' });
      }
      let event: {
        event?: string;
        payload?: { payment?: { entity?: { id?: string; amount?: number; method?: string } }; payment_link?: { entity?: { notes?: { trip_id?: string } } } };
      };
      try {
        event = JSON.parse(raw);
      } catch {
        return reply.code(400).send({ error: 'bad_json' });
      }
      if (event.event !== 'payment_link.paid') return { ok: true, ignored: event.event };

      const payment = event.payload?.payment?.entity;
      const tripId = event.payload?.payment_link?.entity?.notes?.trip_id;
      if (!payment?.id || !payment.amount || !tripId) return reply.code(400).send({ error: 'missing_fields' });
      const trip = await db.query.trips.findFirst({ where: eq(trips.id, tripId) });
      if (!trip || trip.tenantId !== tenant.id) return reply.code(404).send({ error: 'trip_not_found' });
      try {
        const { payment: p } = await recordPayment({ tenantId: tenant.id, userId: null }, trip.id, {
          amount: payment.amount,
          method: 'ONLINE',
          reference: `Razorpay ${payment.id}${payment.method ? ` (${payment.method})` : ''}`,
          providerPaymentId: payment.id,
        });
        await notify(tenant.id, {
          type: 'payments.received',
          level: 'SUCCESS',
          title: `${formatInr(payment.amount)} received online from ${trip.customerName}`,
          body: `For #${trip.number} ${trip.title}. Receipt #${p.receiptNumber} is ready.`,
          link: `/trips/${trip.id}`,
          dedupeKey: `razorpay.paid:${payment.id}`,
        });
      } catch (err) {
        // The same payment delivered twice: already recorded
        if ((err as { code?: string }).code === '23505' || String((err as Error).message).includes('provider_payment_id')) return { ok: true, duplicate: true };
        logger.error({ err, tripId }, 'could not record Razorpay payment');
        await notify(tenant.id, {
          type: 'payments.unrecorded',
          level: 'ERROR',
          title: `${formatInr(payment.amount)} was paid online but couldn’t be recorded`,
          body: `For #${trip.number} ${trip.title} (Razorpay ${payment.id}): ${(err as Error).message} Record it by hand.`,
          link: `/trips/${trip.id}`,
          dedupeKey: `razorpay.unrecorded:${payment.id}`,
        });
      }
      return { ok: true };
    });
  });
}

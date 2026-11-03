import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { handleSesEvent, type SesEvent } from './ses-events.js';
import { isAwsSnsUrl, isSnsMessage, verifySnsMessage, type SnsMessage } from './sns.js';

export interface WebhookOptions {
  /** Overridable in tests */
  verify?: (m: SnsMessage) => Promise<boolean>;
  confirmSubscription?: (url: string) => Promise<void>;
}

async function defaultConfirm(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SNS subscription confirmation failed (${res.status})`);
}

export async function webhookRoutes(app: FastifyInstance, opts: WebhookOptions) {
  const verify = opts.verify ?? ((m: SnsMessage) => verifySnsMessage(m, { topicArn: env.SES_SNS_TOPIC_ARN || undefined }));
  const confirm = opts.confirmSubscription ?? defaultConfirm;

  // SNS posts JSON with Content-Type: text/plain
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(null, body);
    }
  });

  app.post('/webhooks/ses', async (req, reply) => {
    const body = req.body;
    if (!isSnsMessage(body)) return reply.code(400).send({ error: 'not_an_sns_message' });

    if (!(await verify(body))) {
      req.log.warn({ topic: body.TopicArn }, 'rejected SNS message with bad signature');
      return reply.code(403).send({ error: 'invalid_signature' });
    }

    if (body.Type === 'SubscriptionConfirmation') {
      if (!isAwsSnsUrl(body.SubscribeURL, 'subscribe')) return reply.code(400).send({ error: 'bad_subscribe_url' });
      await confirm(body.SubscribeURL!);
      req.log.info({ topic: body.TopicArn }, 'SNS subscription confirmed');
      return reply.send({ ok: true, confirmed: true });
    }

    if (body.Type !== 'Notification') return reply.send({ ok: true });

    let event: SesEvent;
    try {
      event = JSON.parse(body.Message) as SesEvent;
    } catch {
      return reply.code(400).send({ error: 'bad_event_json' });
    }
    if (!event?.mail?.messageId) return reply.send({ ok: true, result: 'ignored' });

    // Errors bubble up as 500 → SNS retries later, and the unique event id prevents double counting
    const result = await handleSesEvent(event, body.MessageId);
    return reply.send({ ok: true, result });
  });
}

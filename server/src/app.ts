import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { env, isProd } from './config/env.js';
import { AppError, registerErrorHandler } from './lib/http.js';
import { authRoutes } from './modules/auth/routes.js';
import { campaignRoutes } from './modules/campaigns/routes.js';
import { contactRoutes } from './modules/contacts/routes.js';
import { notificationRoutes } from './modules/notifications/service.js';
import { overviewRoutes } from './modules/overview/service.js';
import { importRoutes } from './modules/imports/routes.js';
import { fieldRoutes } from './modules/contacts/fields.js';
import { domainRoutes } from './modules/domains/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { mailboxRoutes } from './modules/mailboxes/routes.js';
import { senderRoutes } from './modules/senders/routes.js';
import { unsubscribeRoutes } from './modules/unsubscribe/routes.js';
import { webhookRoutes, type WebhookOptions } from './modules/webhooks/routes.js';

export interface AppOptions {
  webhooks?: WebhookOptions;
  /** Sign-in / sign-up attempts per IP per 15 minutes (default 10) */
  authRateLimit?: number;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp(opts: AppOptions = {}) {
  const app = Fastify({
    logger:
      env.NODE_ENV === 'test'
        ? false
        : isProd
          ? { level: 'info' }
          : { level: 'debug', transport: { target: 'pino-pretty', options: { colorize: true } } },
    trustProxy: true, // behind the Cloudflare tunnel
    bodyLimit: 1024 * 1024,
  });

  registerErrorHandler(app);

  await app.register(helmet, {
    // The unsubscribe page has a small inline <style>; everything else stays locked down
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], styleSrc: ["'unsafe-inline'"], formAction: ["'self'"], imgSrc: ["'self'", 'data:'] },
    },
  });
  await app.register(cors, { origin: isProd ? env.PUBLIC_URL : true, credentials: true });
  await app.register(sensible);
  await app.register(cookie);
  await app.register(formbody); // one-click unsubscribe posts form-encoded
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 20 } }); // CSV imports
  await app.register(rateLimit, { global: false }); // enabled per route (login, signup, DNS checks)

  // CSRF protection for the API: browsers can't send a cross-site JSON body without
  // a CORS preflight, so requiring JSON on every write blocks forged form posts.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/') || !MUTATING.has(req.method)) return;
    const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
    const type = String(req.headers['content-type'] ?? '');
    const uploadOk = req.url.startsWith('/api/imports') && type.startsWith('multipart/form-data');
    if (hasBody && !type.startsWith('application/json') && !uploadOk) {
      throw new AppError(415, 'json_required', 'Send the request body as JSON');
    }
  });

  await app.register(healthRoutes);
  await app.register(authRoutes, { rateLimitMax: opts.authRateLimit });
  await app.register(domainRoutes);
  await app.register(senderRoutes);
  await app.register(mailboxRoutes);
  await app.register(fieldRoutes);
  await app.register(contactRoutes);
  await app.register(importRoutes);
  await app.register(campaignRoutes);
  await app.register(overviewRoutes);
  await app.register(notificationRoutes);
  await app.register(unsubscribeRoutes);
  await app.register(webhookRoutes, opts.webhooks ?? {});

  return app;
}

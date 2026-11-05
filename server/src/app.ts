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
import { accountRoutes } from './modules/account/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { automationRoutes } from './modules/automations/routes.js';
import { campaignRoutes } from './modules/campaigns/routes.js';
import { templateRoutes } from './modules/templates/routes.js';
import { tripRoutes } from './modules/trips/routes.js';
import { tripMessageRoutes } from './modules/trips/followups.js';
import { apiKeyRoutes } from './modules/api-keys/routes.js';
import { quoteRoutes } from './modules/quotes/routes.js';
import { groupRoutes } from './modules/groups/routes.js';
import { packageRoutes } from './modules/packages/service.js';
import { paymentSettingsRoutes } from './modules/payments/settings.js';
import { publicPaymentRoutes } from './modules/payments/public.js';
import { razorpayRoutes } from './modules/payments/razorpay.js';
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
import { webRoutes } from './modules/web/routes.js';
import { blockedOnLinksHost, NOT_A_LINK_PAGE } from './lib/links.js';
import { whatsappRoutes } from './modules/whatsapp/routes.js';

export interface AppOptions {
  webhooks?: WebhookOptions;
  /** Sign-in / sign-up attempts per IP per 15 minutes (default 10) */
  authRateLimit?: number;
  /** Built dashboard to serve (defaults to WEB_DIST or ../web/dist) */
  webRoot?: string;
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
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"], // no inline or third-party scripts, anywhere
        // Email designs use inline styles; previews render them in sandboxed frames
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'], // images inside email previews live on other sites
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'", 'https://accounts.google.com'],
        frameAncestors: ["'none'"],
      },
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
  // The neutral links address serves customer pages only: no app, no sign-in, no branding
  app.addHook('onRequest', async (req, reply) => {
    if (blockedOnLinksHost(req.headers.host, req.url)) {
      return reply.code(404).header('cache-control', 'no-store').type('text/html; charset=utf-8').send(NOT_A_LINK_PAGE);
    }
  });

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
  await app.register(accountRoutes);
  await app.register(domainRoutes);
  await app.register(senderRoutes);
  await app.register(mailboxRoutes);
  await app.register(fieldRoutes);
  await app.register(contactRoutes);
  await app.register(importRoutes);
  await app.register(campaignRoutes);
  await app.register(templateRoutes);
  await app.register(automationRoutes);
  await app.register(apiKeyRoutes);
  await app.register(quoteRoutes);
  await app.register(groupRoutes);
  await app.register(packageRoutes);
  await app.register(tripMessageRoutes);
  await app.register(tripRoutes);
  await app.register(paymentSettingsRoutes);
  await app.register(publicPaymentRoutes);
  await app.register(razorpayRoutes);
  await app.register(overviewRoutes);
  await app.register(whatsappRoutes);
  await app.register(notificationRoutes);
  await app.register(unsubscribeRoutes);
  await app.register(webhookRoutes, opts.webhooks ?? {});
  await app.register(webRoutes, { root: opts.webRoot });

  return app;
}

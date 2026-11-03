import Fastify from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import { env, isProd } from './config/env.js';
import { healthRoutes } from './modules/health/routes.js';
import { unsubscribeRoutes } from './modules/unsubscribe/routes.js';
import { webhookRoutes, type WebhookOptions } from './modules/webhooks/routes.js';

export interface AppOptions {
  webhooks?: WebhookOptions;
}

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

  await app.register(helmet, {
    // The unsubscribe page has a small inline <style>; everything else stays locked down
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], styleSrc: ["'unsafe-inline'"], formAction: ["'self'"], imgSrc: ["'self'", 'data:'] },
    },
  });
  await app.register(cors, { origin: isProd ? env.PUBLIC_URL : true, credentials: true });
  await app.register(sensible);
  await app.register(formbody); // one-click unsubscribe posts form-encoded

  await app.register(healthRoutes);
  await app.register(unsubscribeRoutes);
  await app.register(webhookRoutes, opts.webhooks ?? {});

  return app;
}

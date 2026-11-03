import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import { env, isProd } from './config/env.js';
import { healthRoutes } from './modules/health/routes.js';

export async function buildApp() {
  const app = Fastify({
    logger: isProd
      ? { level: 'info' }
      : { level: 'debug', transport: { target: 'pino-pretty', options: { colorize: true } } },
    trustProxy: true, // behind the Cloudflare tunnel
  });

  await app.register(helmet);
  await app.register(cors, { origin: isProd ? env.PUBLIC_URL : true, credentials: true });
  await app.register(sensible);

  await app.register(healthRoutes);

  return app;
}

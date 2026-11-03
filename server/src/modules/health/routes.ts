import type { FastifyInstance } from 'fastify';
import { checkDatabase } from '../../lib/db.js';
import { checkRedis } from '../../lib/redis.js';

export async function healthRoutes(app: FastifyInstance) {
  // Used by uptime checks and the deploy script.
  app.get('/health', async (_req, reply) => {
    const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
    const ok = database && redis;
    return reply.code(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'degraded',
      database: database ? 'up' : 'down',
      redis: redis ? 'up' : 'down',
      time: new Date().toISOString(),
    });
  });
}

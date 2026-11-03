import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseBody } from '../../lib/http.js';
import { requireAuth, requireRole, tenantOf } from '../auth/guard.js';
import { addDomain, deleteDomain, getDomain, listDomains, refreshDomain } from './service.js';

const addBody = z.object({ domain: z.string().trim().min(3, 'Enter your domain').max(253) });
type IdParams = { Params: { id: string } };

export async function domainRoutes(app: FastifyInstance) {
  app.get('/api/domains', { preHandler: requireAuth }, async (req) => ({ domains: await listDomains(tenantOf(req)) }));

  app.post('/api/domains', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const { domain } = parseBody(addBody, req.body);
    return reply.code(201).send({ domain: await addDomain(tenantOf(req), domain) });
  });

  app.get<IdParams>('/api/domains/:id', { preHandler: requireAuth }, async (req) => ({
    domain: await getDomain(tenantOf(req), req.params.id),
  }));

  // "Check now" button — rate limited so it can't be used to hammer DNS
  app.post<IdParams>(
    '/api/domains/:id/check',
    { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => ({ domain: await refreshDomain(tenantOf(req), req.params.id) }),
  );

  app.delete<IdParams>('/api/domains/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    await deleteDomain(tenantOf(req), req.params.id);
    return reply.code(204).send();
  });
}

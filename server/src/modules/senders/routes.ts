import type { FastifyInstance } from 'fastify';
import { parseBody } from '../../lib/http.js';
import { requireAuth, requireRole, tenantOf, viewerOf } from '../auth/guard.js';
import { createSender, createSenderBody, deleteSender, listSenders, updateSender, updateSenderBody } from './service.js';

type IdParams = { Params: { id: string } };

export async function senderRoutes(app: FastifyInstance) {
  app.get('/api/senders', { preHandler: requireAuth }, async (req) => ({ senders: await listSenders(viewerOf(req)) }));

  app.post('/api/senders', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const body = parseBody(createSenderBody, req.body);
    return reply.code(201).send({ sender: await createSender(tenantOf(req), body) });
  });

  app.patch<IdParams>('/api/senders/:id', { preHandler: requireAuth }, async (req) => {
    const body = parseBody(updateSenderBody, req.body);
    return { sender: await updateSender(viewerOf(req), req.params.id, body) };
  });

  // Your own Gmail sender; the agency's domain addresses are for owners and managers
  app.delete<IdParams>('/api/senders/:id', { preHandler: requireAuth }, async (req, reply) => {
    await deleteSender(viewerOf(req), req.params.id);
    return reply.code(204).send();
  });
}

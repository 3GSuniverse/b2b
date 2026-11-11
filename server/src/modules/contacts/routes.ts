import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseBody } from '../../lib/http.js';
import { requireAuth, seesAll, tenantOf, viewerOf } from '../auth/guard.js';
import type { FastifyRequest } from 'fastify';
import {
  addToList,
  contactStats,
  createContact,
  createContactBody,
  createList,
  deleteContacts,
  deleteList,
  getContact,
  listContacts,
  listLists,
  listQuery,
  removeFromList,
  updateContact,
  updateContactBody,
  updateList,
} from './service.js';

type IdParams = { Params: { id: string } };
const idsBody = z.object({ contactIds: z.array(z.string()).min(1, 'Choose at least one contact').max(1000) });
const listBody = z.object({
  name: z.string().trim().min(1, 'Enter a list name').max(80),
  description: z.string().trim().max(300).optional(),
});

/** An employee works on their own customers only; owners and managers on everyone's. */
const only = (req: FastifyRequest) => {
  const v = viewerOf(req);
  return seesAll(v) ? undefined : v.userId;
};

export async function contactRoutes(app: FastifyInstance) {
  app.get('/api/contacts', { preHandler: requireAuth }, async (req) =>
    listContacts(tenantOf(req), parseBody(listQuery, req.query), only(req)),
  );

  app.get('/api/contacts/stats', { preHandler: requireAuth }, async (req) => ({ stats: await contactStats(tenantOf(req), only(req)) }));

  app.post('/api/contacts', { preHandler: requireAuth }, async (req, reply) => {
    const body = parseBody(createContactBody, req.body);
    return reply.code(201).send({ contact: await createContact(tenantOf(req), body, req.auth!.userId) });
  });

  app.get<IdParams>('/api/contacts/:id', { preHandler: requireAuth }, async (req) => ({
    contact: await getContact(tenantOf(req), req.params.id, only(req)),
  }));

  app.patch<IdParams>('/api/contacts/:id', { preHandler: requireAuth }, async (req) => ({
    contact: await updateContact(tenantOf(req), req.params.id, parseBody(updateContactBody, req.body), only(req)),
  }));

  app.delete<IdParams>('/api/contacts/:id', { preHandler: requireAuth }, async (req, reply) => {
    await deleteContacts(tenantOf(req), [req.params.id], only(req));
    return reply.code(204).send();
  });

  app.post('/api/contacts/delete', { preHandler: requireAuth }, async (req) => {
    const { contactIds } = parseBody(idsBody, req.body);
    return { deleted: await deleteContacts(tenantOf(req), contactIds, only(req)) };
  });

  // Lists
  app.get('/api/lists', { preHandler: requireAuth }, async (req) => ({ lists: await listLists(tenantOf(req), only(req)) }));

  app.post('/api/lists', { preHandler: requireAuth }, async (req, reply) => {
    const body = parseBody(listBody, req.body);
    return reply.code(201).send({ list: await createList(tenantOf(req), body.name, body.description, req.auth!.userId) });
  });

  app.patch<IdParams>('/api/lists/:id', { preHandler: requireAuth }, async (req) => ({
    list: await updateList(tenantOf(req), req.params.id, parseBody(listBody.partial(), req.body), only(req)),
  }));

  app.delete<IdParams>('/api/lists/:id', { preHandler: requireAuth }, async (req, reply) => {
    await deleteList(tenantOf(req), req.params.id, only(req));
    return reply.code(204).send();
  });

  app.post<IdParams>('/api/lists/:id/members', { preHandler: requireAuth }, async (req) => ({
    added: await addToList(tenantOf(req), req.params.id, parseBody(idsBody, req.body).contactIds, only(req)),
  }));

  app.post<IdParams>('/api/lists/:id/members/remove', { preHandler: requireAuth }, async (req) => ({
    removed: await removeFromList(tenantOf(req), req.params.id, parseBody(idsBody, req.body).contactIds, only(req)),
  }));
}

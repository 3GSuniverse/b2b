import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { users } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { parseBody } from '../../lib/http.js';
import { requireAuth, requireRole, tenantOf } from '../auth/guard.js';
import {
  createTrip,
  createTripBody,
  deleteTrip,
  duesBody,
  getTrip,
  listTrips,
  listTripsQuery,
  paymentBody,
  recordPayment,
  setDues,
  tripStats,
  updateTrip,
  updateTripBody,
  voidPayment,
  type Actor,
} from './service.js';

type IdParams = { Params: { id: string } };
const actor = (req: FastifyRequest): Actor => ({ tenantId: tenantOf(req), userId: req.auth!.userId });
const voidBody = z.object({ reason: z.string().trim().min(3, 'Say why this payment is being cancelled').max(200) });

export async function tripRoutes(app: FastifyInstance) {
  app.get('/api/trips', { preHandler: requireAuth }, async (req) => listTrips(tenantOf(req), parseBody(listTripsQuery, req.query)));

  app.get('/api/trips/stats', { preHandler: requireAuth }, async (req) => ({ stats: await tripStats(tenantOf(req)) }));

  app.post('/api/trips', { preHandler: requireAuth }, async (req, reply) =>
    reply.code(201).send({ trip: await createTrip(actor(req), parseBody(createTripBody, req.body)) }),
  );

  app.get<IdParams>('/api/trips/:id', { preHandler: requireAuth }, async (req) => ({ trip: await getTrip(tenantOf(req), req.params.id) }));

  app.patch<IdParams>('/api/trips/:id', { preHandler: requireAuth }, async (req) => ({
    trip: await updateTrip(actor(req), req.params.id, parseBody(updateTripBody, req.body)),
  }));

  app.delete<IdParams>('/api/trips/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    await deleteTrip(actor(req), req.params.id);
    return reply.code(204).send();
  });

  app.put<IdParams>('/api/trips/:id/dues', { preHandler: requireAuth }, async (req) => ({
    trip: await setDues(actor(req), req.params.id, parseBody(duesBody, req.body)),
  }));

  app.post<IdParams>('/api/trips/:id/payments', { preHandler: requireAuth }, async (req, reply) => {
    const { payment, trip } = await recordPayment(actor(req), req.params.id, parseBody(paymentBody, req.body));
    return reply.code(201).send({ receiptNumber: payment.receiptNumber, trip });
  });

  // Correcting a mistake: the payment stays on record, marked as cancelled
  app.post<{ Params: { id: string; paymentId: string } }>('/api/trips/:id/payments/:paymentId/void', { preHandler: requireRole('ADMIN') }, async (req) => ({
    trip: await voidPayment(actor(req), req.params.id, req.params.paymentId, parseBody(voidBody, req.body).reason),
  }));

  // People a trip can be assigned to
  app.get('/api/team', { preHandler: requireAuth }, async (req) => ({
    team: await db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users).where(eq(users.tenantId, tenantOf(req))).orderBy(asc(users.name)),
  }));
}

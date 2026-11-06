import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseBody } from '../../lib/http.js';
import { requireRole, tenantOf } from '../auth/guard.js';
import { createEmployee, deleteEmployee, employeeBody, employeePatch, LOGIN_CODE, setLoginCode, teamOverview, updateEmployee } from './service.js';

type Id = { Params: { id: string } };
const owner = { preHandler: requireRole('OWNER') };

export async function teamRoutes(app: FastifyInstance) {
  app.get('/api/agency', owner, async (req) => teamOverview(tenantOf(req)));
  app.post('/api/agency/employees', owner, async (req, reply) => reply.code(201).send({ member: await createEmployee(tenantOf(req), parseBody(employeeBody, req.body)) }));
  app.patch<Id>('/api/agency/employees/:id', owner, async (req) => ({ member: await updateEmployee(tenantOf(req), req.params.id, parseBody(employeePatch, req.body)) }));
  app.delete<Id>('/api/agency/employees/:id', owner, async (req) => {
    await deleteEmployee(tenantOf(req), req.params.id);
    return { ok: true };
  });
  app.patch('/api/agency/id', owner, async (req) => ({ loginCode: await setLoginCode(tenantOf(req), parseBody(z.object({ loginCode: LOGIN_CODE }), req.body).loginCode) }));
}

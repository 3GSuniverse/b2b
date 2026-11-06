import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../lib/http.js';
import { findSession, SESSION_COOKIE } from './sessions.js';

export type Role = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: Role;
  sessionToken: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/** preHandler: rejects the request unless a valid session cookie is present. */
export async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) throw new AppError(401, 'not_signed_in', 'Please sign in');
  const s = await findSession(token);
  if (!s) throw new AppError(401, 'session_expired', 'Your session has ended. Please sign in again');
  if (s.user.disabledAt) throw new AppError(401, 'login_disabled', 'Your login has been switched off. Ask your agency owner.');
  req.auth = { userId: s.userId, tenantId: s.tenantId, role: s.user.role, sessionToken: token };
}

const RANK: Record<Role, number> = { MEMBER: 1, ADMIN: 2, OWNER: 3 };

/** preHandler factory: requireRole('ADMIN') allows admins and owners. */
export function requireRole(min: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.auth) await requireAuth(req, reply);
    if (RANK[req.auth!.role] < RANK[min]) {
      throw new AppError(403, 'forbidden', 'You don’t have permission to do this');
    }
  };
}

/** The tenant of the signed-in user. Every query in a route must be scoped by this. */
export function tenantOf(req: FastifyRequest): string {
  if (!req.auth) throw new AppError(401, 'not_signed_in', 'Please sign in');
  return req.auth.tenantId;
}

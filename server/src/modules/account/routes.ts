import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditLogs, tenants } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError, parseBody } from '../../lib/http.js';
import { requireAuth, requireRole, tenantOf } from '../auth/guard.js';

const patchBody = z.object({
  name: z.string().trim().min(2, 'Enter your company name').max(120).optional(),
  // Printed in every email footer — anti-spam law and Gmail/Yahoo rules expect a real address
  postalAddress: z.string().trim().min(10, 'Enter your full office address').max(300).optional(),
  // Let Dhrona customer care open this account to help (owner only)
  supportAccess: z.boolean().optional(),
});

async function account(tenantId: string) {
  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!t) throw new AppError(404, 'tenant_not_found', 'Account not found');
  return { name: t.name, postalAddress: t.postalAddress, supportAccess: t.supportAccess, timezone: t.timezone, monthlyQuota: t.monthlyQuota, status: t.status, createdAt: t.createdAt };
}

export async function accountRoutes(app: FastifyInstance) {
  app.get('/api/account', { preHandler: requireAuth }, async (req) => ({ account: await account(tenantOf(req)) }));

  app.patch('/api/account', { preHandler: requireRole('ADMIN') }, async (req) => {
    const b = parseBody(patchBody, req.body);
    if (b.supportAccess !== undefined && (req.auth!.role !== 'OWNER' || req.auth!.support)) throw new AppError(403, 'forbidden', 'Only the agency owner can change support access.');
    const patch = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    if (Object.keys(patch).length) {
      await db.update(tenants).set(patch).where(eq(tenants.id, tenantOf(req)));
      await db.insert(auditLogs).values({ tenantId: tenantOf(req), userId: req.auth!.userId, action: 'account.update', entity: 'tenant', entityId: tenantOf(req), meta: { fields: Object.keys(patch) } });
    }
    return { account: await account(tenantOf(req)) };
  });
}

import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { automations, customFields } from '../../db/schema.js';
import { db, type Tx } from '../../lib/db.js';
import { AppError, parseBody } from '../../lib/http.js';
import { requireAuth, requireRole, tenantOf } from '../auth/guard.js';
import { fieldKey, RESERVED_KEYS } from './normalize.js';

export type FieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN';

const createBody = z.object({
  label: z.string().trim().min(1, 'Enter a name for the field').max(60),
  type: z.enum(['TEXT', 'NUMBER', 'DATE', 'BOOLEAN']).default('TEXT'),
});

export async function listFields(tenantId: string) {
  return db.select().from(customFields).where(eq(customFields.tenantId, tenantId)).orderBy(asc(customFields.createdAt));
}

/** Creates a field, or returns the existing one with the same key. */
export async function ensureField(dbx: Tx | typeof db, tenantId: string, label: string, type: FieldType = 'TEXT', fixedKey?: string) {
  const key = fixedKey ?? fieldKey(label);
  if (!key || RESERVED_KEYS.has(key)) {
    throw new AppError(400, 'reserved_field', `"${label}" is a built-in field and can't be used as a custom field name`);
  }
  const [row] = await dbx
    .insert(customFields)
    .values({ tenantId, key, label: label.trim(), type })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  return (await dbx.query.customFields.findFirst({ where: and(eq(customFields.tenantId, tenantId), eq(customFields.key, key)) }))!;
}

export async function fieldRoutes(app: FastifyInstance) {
  app.get('/api/fields', { preHandler: requireAuth }, async (req) => ({ fields: await listFields(tenantOf(req)) }));

  app.post('/api/fields', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const body = parseBody(createBody, req.body);
    const tenantId = tenantOf(req);
    const key = fieldKey(body.label);
    const exists = await db.query.customFields.findFirst({ where: and(eq(customFields.tenantId, tenantId), eq(customFields.key, key)) });
    if (exists) throw new AppError(409, 'field_exists', `A field called "${exists.label}" already exists`);
    return reply.code(201).send({ field: await ensureField(db, tenantId, body.label, body.type) });
  });

  app.delete<{ Params: { id: string } }>('/api/fields/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const tenantId = tenantOf(req);
    const field = await db.query.customFields.findFirst({ where: and(eq(customFields.id, req.params.id), eq(customFields.tenantId, tenantId)) });
    if (!field) throw new AppError(404, 'field_not_found', 'Field not found');
    const used = await db.query.automations.findFirst({ where: eq(automations.dateFieldId, field.id), columns: { name: true } });
    if (used) throw new AppError(409, 'field_in_use', `The automation "${used.name}" uses this field`);
    await db.delete(customFields).where(eq(customFields.id, field.id));
    // Values stay in contacts' attributes; they simply stop appearing as a named field
    return reply.code(204).send();
  });
}

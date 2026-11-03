import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { automations, contacts, templates, tenants } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError, parseBody } from '../../lib/http.js';
import { requireAuth, tenantOf } from '../auth/guard.js';
import { buildMergeVars, renderEmail } from '../email/render.js';
import { STARTERS } from './starters.js';

const body = z.object({
  name: z.string().trim().min(1, 'Give the template a name').max(120),
  subject: z.string().trim().max(200).nullable().optional(),
  previewText: z.string().trim().max(200).nullable().optional(),
  html: z.string().max(500_000, 'The template is too large').nullable().optional(),
  text: z.string().max(200_000).nullable().optional(),
  design: z.unknown().optional(), // editor state, stored as-is
});
type IdParams = { Params: { id: string } };

async function owned(tenantId: string, id: string) {
  const t = await db.query.templates.findFirst({ where: and(eq(templates.id, id), eq(templates.tenantId, tenantId)) });
  if (!t) throw new AppError(404, 'template_not_found', 'Template not found');
  return t;
}

export async function templateRoutes(app: FastifyInstance) {
  app.get('/api/templates/starters', { preHandler: requireAuth }, async () => ({
    starters: STARTERS.map(({ id, name, description, subject, previewText }) => ({ id, name, description, subject, previewText })),
  }));

  app.post('/api/templates/from-starter', { preHandler: requireAuth }, async (req, reply) => {
    const { starterId, name } = parseBody(z.object({ starterId: z.string(), name: z.string().trim().max(120).optional() }), req.body);
    const s = STARTERS.find((x) => x.id === starterId);
    if (!s) throw new AppError(404, 'starter_not_found', 'Starter template not found');
    const [t] = await db
      .insert(templates)
      .values({ tenantId: tenantOf(req), name: name || s.name, subject: s.subject, previewText: s.previewText || null, html: s.html })
      .returning();
    return reply.code(201).send({ template: t });
  });

  app.get('/api/templates', { preHandler: requireAuth }, async (req) => ({
    templates: await db
      .select({ id: templates.id, name: templates.name, subject: templates.subject, previewText: templates.previewText, updatedAt: templates.updatedAt, createdAt: templates.createdAt })
      .from(templates)
      .where(eq(templates.tenantId, tenantOf(req)))
      .orderBy(desc(templates.updatedAt)),
  }));

  app.post('/api/templates', { preHandler: requireAuth }, async (req, reply) => {
    const b = parseBody(body, req.body);
    const [t] = await db.insert(templates).values({ tenantId: tenantOf(req), ...b, design: b.design ?? null }).returning();
    return reply.code(201).send({ template: t });
  });

  app.get<IdParams>('/api/templates/:id', { preHandler: requireAuth }, async (req) => ({ template: await owned(tenantOf(req), req.params.id) }));

  app.patch<IdParams>('/api/templates/:id', { preHandler: requireAuth }, async (req) => {
    await owned(tenantOf(req), req.params.id);
    const b = parseBody(body.partial(), req.body);
    const patch = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    const [t] = await db.update(templates).set(patch).where(eq(templates.id, req.params.id)).returning();
    return { template: t };
  });

  app.post<IdParams>('/api/templates/:id/duplicate', { preHandler: requireAuth }, async (req, reply) => {
    const t = await owned(tenantOf(req), req.params.id);
    const [copy] = await db
      .insert(templates)
      .values({ tenantId: t.tenantId, name: `Copy of ${t.name}`.slice(0, 120), subject: t.subject, previewText: t.previewText, html: t.html, text: t.text, design: t.design })
      .returning();
    return reply.code(201).send({ template: copy });
  });

  // Sent campaigns keep their own copy, so editing or deleting a template never changes history
  app.delete<IdParams>('/api/templates/:id', { preHandler: requireAuth }, async (req, reply) => {
    const t = await owned(tenantOf(req), req.params.id);
    const used = await db.query.automations.findFirst({ where: and(eq(automations.templateId, t.id), eq(automations.status, 'ACTIVE')), columns: { name: true } });
    if (used) throw new AppError(409, 'template_in_use', `The active automation "${used.name}" uses this template`);
    await db.delete(templates).where(eq(templates.id, t.id));
    return reply.code(204).send();
  });

  app.post<IdParams>('/api/templates/:id/preview', { preHandler: requireAuth }, async (req) => {
    const tenantId = tenantOf(req);
    const t = await owned(tenantId, req.params.id);
    const { contactId } = parseBody(z.object({ contactId: z.string().optional() }), req.body);
    const [tenant, contact] = await Promise.all([
      db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }),
      contactId ? db.query.contacts.findFirst({ where: and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)) }) : Promise.resolve(undefined),
    ]);
    const vars = buildMergeVars(contact ?? null, tenant!, { unsubscribe_url: '#unsubscribe-preview' });
    return { rendered: t.subject && t.html ? renderEmail({ subject: t.subject, html: t.html, text: t.text, previewText: t.previewText }, vars, tenant!) : null };
  });
}


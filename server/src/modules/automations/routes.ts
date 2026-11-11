import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { automations, automationSends, customFields, senders, templates } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError, parseBody } from '../../lib/http.js';
import { requireAuth, seesAll, tenantOf, viewerOf } from '../auth/guard.js';
import { PLACEHOLDER } from '../campaigns/checks.js';
import { audienceSchema } from '../campaigns/service.js';
import { countEmailAudience, countWhatsAppAudience, creatorScoped, scopeAudience } from '../audience/resolve.js';
import { requireFeature, whatsappWebAllowed } from '../plans/entitlements.js';
import { isDomainReady } from '../domains/service.js';
import { dueContactsQuery } from './engine.js';
import { attachmentIds, LIMITS, mergeRefs, resolveRefs, totalSize } from '../attachments/service.js';

const body = z.object({
  name: z.string().trim().min(1, 'Give the automation a name').max(120),
  dateFieldId: z.string().min(1, 'Choose the date it’s based on'),
  offsetDays: z.number().int().min(-365).max(365).default(0),
  sendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:00').default('09:00'),
  repeat: z.enum(['ONCE', 'YEARLY']).default('ONCE'),
  audience: audienceSchema.nullable().optional(),
  templateId: z.string().nullable().optional(),
  senderId: z.string().nullable().optional(),
  attachments: attachmentIds.optional(), // sent along with the template's own files
  text: z.string().max(4000, 'Keep the WhatsApp message under 4,000 characters').nullable().optional(), // WhatsApp only
});
const createBody = body.extend({ channel: z.enum(['EMAIL', 'WHATSAPP']).default('EMAIL') });
type IdParams = { Params: { id: string } };

/** "3 days before Trip date · 9:00 AM · every year" — the line shown on each automation card. */
export function describeRule(a: { offsetDays: number; sendTime: string; repeat: string }, fieldLabel: string) {
  const [h, m] = a.sendTime.split(':').map(Number) as [number, number];
  const time = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  const n = Math.abs(a.offsetDays);
  const when = a.offsetDays === 0 ? `On ${fieldLabel}` : `${n} day${n > 1 ? 's' : ''} ${a.offsetDays < 0 ? 'before' : 'after'} ${fieldLabel}`;
  return `${when} · ${time}${a.repeat === 'YEARLY' ? ' · every year' : ''}`;
}

async function owned(tenantId: string, id: string, only?: string) {
  const a = await db.query.automations.findFirst({
    where: and(eq(automations.id, id), eq(automations.tenantId, tenantId), only ? eq(automations.createdById, only) : undefined),
    with: { dateField: true, tenant: true, sender: { with: { domain: true, connection: true } }, template: true },
  });
  if (!a) throw new AppError(404, 'automation_not_found', 'Automation not found');
  return a;
}

/** An employee works with their own automations only; owners and managers with all. */
const only = (req: FastifyRequest) => {
  const v = viewerOf(req);
  return seesAll(v) ? undefined : v.userId;
};

async function assertRefs(tenantId: string, input: Partial<z.infer<typeof body>>) {
  if (input.dateFieldId) {
    const f = await db.query.customFields.findFirst({ where: and(eq(customFields.id, input.dateFieldId), eq(customFields.tenantId, tenantId)) });
    if (!f) throw new AppError(404, 'field_not_found', 'Field not found');
    if (f.type !== 'DATE') throw new AppError(400, 'not_a_date_field', `“${f.label}” isn’t a date field. Choose a field like Trip date or Birthday.`);
  }
  if (input.templateId) {
    const t = await db.query.templates.findFirst({ where: and(eq(templates.id, input.templateId), eq(templates.tenantId, tenantId)), columns: { id: true } });
    if (!t) throw new AppError(404, 'template_not_found', 'Template not found');
  }
  if (input.senderId) {
    const s = await db.query.senders.findFirst({ where: and(eq(senders.id, input.senderId), eq(senders.tenantId, tenantId)), columns: { id: true } });
    if (!s) throw new AppError(404, 'sender_not_found', 'Sender not found');
  }
}

async function dto(a: Awaited<ReturnType<typeof owned>>) {
  return {
    id: a.id,
    name: a.name,
    status: a.status,
    channel: a.channel,
    text: a.text,
    rule: describeRule(a, a.dateField.label),
    dateField: { id: a.dateField.id, key: a.dateField.key, label: a.dateField.label },
    offsetDays: a.offsetDays,
    sendTime: a.sendTime,
    repeat: a.repeat,
    timezone: a.tenant.timezone,
    audience: a.audience,
    template: a.template ? { id: a.template.id, name: a.template.name, subject: a.template.subject, attachments: a.template.attachments } : null,
    attachments: a.attachments,
    sender: a.sender ? { id: a.sender.id, fromName: a.sender.fromName, fromEmail: a.sender.fromEmail } : null,
    activatedAt: a.activatedAt,
    stats: { sent: a.sent, delivered: a.delivered, clicked: a.clicked, clickRate: a.sent ? Math.round((a.clicked / a.sent) * 1000) / 10 : 0 },
    createdAt: a.createdAt,
  };
}

export async function automationRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { channel?: string } }>('/api/automations', { preHandler: requireAuth }, async (req) => {
    const tenantId = tenantOf(req);
    const channel = req.query.channel === 'WHATSAPP' || req.query.channel === 'EMAIL' ? req.query.channel : undefined;
    const rows = await db.query.automations.findMany({
      where: and(eq(automations.tenantId, tenantId), only(req) ? eq(automations.createdById, only(req)!) : undefined, channel ? eq(automations.channel, channel) : undefined),
      with: { dateField: true, tenant: true, sender: { with: { domain: true, connection: true } }, template: true },
      orderBy: [desc(automations.createdAt)],
    });
    return { automations: await Promise.all(rows.map(dto)) };
  });

  app.post('/api/automations', { preHandler: requireAuth }, async (req, reply) => {
    const tenantId = tenantOf(req);
    await requireFeature(tenantId, 'automations');
    const { attachments: ids, ...b } = parseBody(createBody, req.body);
    await assertRefs(tenantId, b);
    const wa = b.channel === 'WHATSAPP';
    const [row] = await db
      .insert(automations)
      .values({
        tenantId,
        ...b,
        createdById: req.auth!.userId,
        audience: scopeAudience(b.audience ?? null, viewerOf(req)),
        templateId: wa ? null : (b.templateId ?? null),
        senderId: wa ? null : (b.senderId ?? null),
        text: wa ? (b.text ?? null) : null,
        attachments: await resolveRefs(tenantId, ids),
      })
      .returning();
    return reply.code(201).send({ automation: await dto(await owned(tenantId, row!.id)) });
  });

  app.get<IdParams>('/api/automations/:id', { preHandler: requireAuth }, async (req) => ({
    automation: await dto(await owned(tenantOf(req), req.params.id, only(req))),
  }));

  // Edits apply from now on. Emails already sent stay sent.
  app.patch<IdParams>('/api/automations/:id', { preHandler: requireAuth }, async (req) => {
    const tenantId = tenantOf(req);
    await owned(tenantId, req.params.id, only(req));
    const { attachments: ids, ...b } = parseBody(body.partial(), req.body);
    await assertRefs(tenantId, b);
    const patch: Record<string, unknown> = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    if (b.audience !== undefined) patch.audience = scopeAudience(b.audience, viewerOf(req));
    if (ids !== undefined) patch.attachments = await resolveRefs(tenantId, ids);
    if (Object.keys(patch).length) await db.update(automations).set(patch).where(eq(automations.id, req.params.id));
    return { automation: await dto(await owned(tenantId, req.params.id, only(req))) };
  });

  app.post<IdParams>('/api/automations/:id/activate', { preHandler: requireAuth }, async (req) => {
    const tenantId = tenantOf(req);
    await requireFeature(tenantId, 'automations');
    const a = await owned(tenantId, req.params.id, only(req));
    if (a.dateField.type !== 'DATE') throw new AppError(400, 'not_a_date_field', `“${a.dateField.label}” isn’t a date field`);
    if (a.channel === 'WHATSAPP') {
      if (!a.text?.trim() && !a.attachments.length) throw new AppError(400, 'no_content', 'Write the WhatsApp message first');
      const left = [...new Set(a.text?.match(PLACEHOLDER) ?? [])];
      if (left.length) throw new AppError(400, 'placeholders_left', `The message still has ${left.join(', ')}. Replace ${left.length > 1 ? 'them' : 'it'} before switching on.`);
      if (!a.tenant.whatsappWebEnabled && !whatsappWebAllowed(a.tenant)) throw new AppError(400, 'whatsapp_not_enabled', 'WhatsApp isn’t switched on for your account');
      await db.update(automations).set({ status: 'ACTIVE', activatedAt: new Date() }).where(eq(automations.id, a.id));
      return { automation: await dto(await owned(tenantId, a.id)) };
    }
    if (!a.template?.subject || !a.template.html) throw new AppError(400, 'no_template', 'Choose an email template with a subject and content first');
    const left = [...new Set(`${a.template.subject}\n${a.template.previewText ?? ''}\n${a.template.html}`.match(PLACEHOLDER) ?? [])];
    if (left.length) {
      throw new AppError(400, 'placeholders_left', `The template still has ${left.map((p) => (p.length > 40 ? p.slice(0, 38) + '…]' : p)).join(', ')}. Replace ${left.length > 1 ? 'them' : 'it'} before switching on.`);
    }
    if (!a.sender) throw new AppError(400, 'no_sender', 'Choose who the email is from first');
    if (totalSize(mergeRefs(a.template.attachments, a.attachments)) > LIMITS.emailTotalBytes) {
      throw new AppError(400, 'attachments_too_large', 'The attachments are too large for email (over 15 MB in all). Remove some first.');
    }
    const senderReady = a.sender.kind === 'DOMAIN' ? !!a.sender.domain && isDomainReady(a.sender.domain) : a.sender.connection?.status === 'ACTIVE';
    if (!senderReady) throw new AppError(400, 'sender_not_verified', `${a.sender.fromEmail} can’t send yet. Finish setting it up in Email → Sending setup.`);
    // From this moment only — switching on never emails people whose dates already passed
    await db.update(automations).set({ status: 'ACTIVE', activatedAt: new Date() }).where(eq(automations.id, a.id));
    return { automation: await dto(await owned(tenantId, a.id)) };
  });

  app.post<IdParams>('/api/automations/:id/pause', { preHandler: requireAuth }, async (req) => {
    const tenantId = tenantOf(req);
    await owned(tenantId, req.params.id, only(req));
    await db.update(automations).set({ status: 'PAUSED' }).where(eq(automations.id, req.params.id));
    return { automation: await dto(await owned(tenantId, req.params.id, only(req))) };
  });

  app.delete<IdParams>('/api/automations/:id', { preHandler: requireAuth }, async (req, reply) => {
    const tenantId = tenantOf(req);
    const a = await owned(tenantId, req.params.id, only(req));
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(automationSends).where(eq(automationSends.automationId, a.id));
    if (n > 0) throw new AppError(409, 'has_history', 'This automation has already sent messages. Pause it instead, to keep its reports.');
    await db.delete(automations).where(eq(automations.id, a.id));
    return reply.code(204).send();
  });

  /** "Coming up in the next 7 days" — who gets it, day by day, in the company's timezone. */
  app.get<IdParams & { Querystring: { days?: string } }>('/api/automations/:id/upcoming', { preHandler: requireAuth }, async (req) => {
    const tenantId = tenantOf(req);
    const a = await owned(tenantId, req.params.id, only(req));
    const days = Math.min(31, Math.max(1, Number(req.query.days ?? 7) || 7));
    const now = new Date();
    const to = new Date(now.getTime() + days * 86_400_000);
    const audience = await creatorScoped(db, a.audience, a.createdById);
    const rows = await db.execute<{ contact_id: string; email: string; first_name: string | null; occurrence_date: string; due_at: Date }>(
      dueContactsQuery({ ...a, audience: audience ?? null }, now, to),
    );
    const tz = a.tenant.timezone;
    const dayOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const byDay = new Map<string, { day: string; count: number; people: { name: string; email: string; occurrenceDate: string }[] }>();
    for (const r of rows.rows) {
      const day = dayOf(new Date(r.due_at));
      const entry = byDay.get(day) ?? { day, count: 0, people: [] };
      entry.count++;
      if (entry.people.length < 5) entry.people.push({ name: r.first_name ?? r.email, email: r.email, occurrenceDate: r.occurrence_date });
      byDay.set(day, entry);
    }
    const wa = a.channel === 'WHATSAPP';
    const matching = wa ? await countWhatsAppAudience(db, tenantId, audience) : await countEmailAudience(db, tenantId, audience);
    const [{ withDate } = { withDate: 0 }] = await db.execute<{ withDate: number }>(
      wa
        ? sql`select count(*)::int as "withDate" from contacts where tenant_id = ${tenantId} and (${audience?.ownerId ?? null}::text is null or owner_id = ${audience?.ownerId ?? null}) and whatsapp_status = 'SUBSCRIBED' and phone is not null
          and coalesce(attributes ->> ${a.dateField.key}, '') ~ '^\\d{4}-\\d{2}-\\d{2}$'`
        : sql`select count(*)::int as "withDate" from contacts where tenant_id = ${tenantId} and (${audience?.ownerId ?? null}::text is null or owner_id = ${audience?.ownerId ?? null}) and email_status = 'SUBSCRIBED'
          and coalesce(attributes ->> ${a.dateField.key}, '') ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
    ).then((r) => r.rows);
    return { days: [...byDay.values()], total: rows.rows.length, audience: { matching, withDate } };
  });
}

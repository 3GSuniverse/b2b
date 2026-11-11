import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { campaigns } from '../../db/schema.js';
import { AppError } from '../../lib/http.js';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { parseBody } from '../../lib/http.js';
import { countEmailAudience, countWhatsAppAudience, scopeAudience } from '../audience/resolve.js';
import { requireAuth, seesAll, tenantOf, viewerOf } from '../auth/guard.js';
import { assertCanUseSender } from '../senders/service.js';
import {
  audienceSchema,
  campaignBody,
  campaignReport,
  cancelCampaign,
  createCampaign,
  deleteCampaign,
  duplicateCampaign,
  getCampaign,
  listCampaigns,
  listCampaignsQuery,
  previewCampaign,
  scheduleCampaign,
  sendCampaignNow,
  sendTestEmail,
  sendTestWhatsApp,
  unscheduleCampaign,
  updateCampaign,
} from './service.js';

type IdParams = { Params: { id: string } };

const scheduleBody = z.object({
  // ISO 8601 with offset, e.g. 2026-11-08T10:00:00+05:30
  scheduledAt: z.iso.datetime({ offset: true, message: 'Pick a date and time' }).transform((v) => new Date(v)),
});
const testBody = z.object({
  emails: z
    .array(z.string().trim().toLowerCase().pipe(z.email({ message: 'Enter valid email addresses' })))
    .min(1, 'Enter at least one address')
    .max(5, 'Send a test to up to 5 addresses'),
});
const previewBody = z.object({ contactId: z.string().optional() });
const testPhonesBody = z.object({ phones: z.array(z.string().trim().min(6)).min(1, 'Enter at least one number').max(3, 'Send a test to up to 3 numbers') });

/** An employee may open only the campaigns they made; the owner and managers see all. */
async function ownCampaign(req: FastifyRequest<IdParams>) {
  const v = viewerOf(req);
  if (seesAll(v)) return;
  const c = await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, req.params.id), eq(campaigns.tenantId, v.tenantId)), columns: { createdById: true } });
  if (c && c.createdById !== v.userId) throw new AppError(404, 'campaign_not_found', 'Campaign not found');
}

export async function campaignRoutes(app: FastifyInstance) {
  app.get('/api/campaigns', { preHandler: requireAuth }, async (req) => {
    const v = viewerOf(req);
    return listCampaigns(v.tenantId, parseBody(listCampaignsQuery, req.query), seesAll(v) ? undefined : v.userId);
  });

  app.post('/api/campaigns', { preHandler: requireAuth }, async (req, reply) => {
    const body = parseBody(campaignBody, req.body);
    if (body.senderId) await assertCanUseSender(viewerOf(req), body.senderId);
    return reply.code(201).send({ campaign: await createCampaign(tenantOf(req), req.auth!.userId, body) });
  });

  app.get<IdParams>('/api/campaigns/:id', { preHandler: [requireAuth, ownCampaign] }, async (req) => ({ campaign: await getCampaign(tenantOf(req), req.params.id) }));

  app.patch<IdParams>('/api/campaigns/:id', { preHandler: [requireAuth, ownCampaign] }, async (req) => {
    const body = parseBody(campaignBody.partial(), req.body);
    // Employees send from the agency's addresses or their own Gmail, not a colleague's
    if (body.senderId) await assertCanUseSender(viewerOf(req), body.senderId);
    return { campaign: await updateCampaign(tenantOf(req), req.params.id, body) };
  });

  app.delete<IdParams>('/api/campaigns/:id', { preHandler: [requireAuth, ownCampaign] }, async (req, reply) => {
    await deleteCampaign(tenantOf(req), req.params.id);
    return reply.code(204).send();
  });

  app.post<IdParams>('/api/campaigns/:id/duplicate', { preHandler: [requireAuth, ownCampaign] }, async (req, reply) =>
    reply.code(201).send({ campaign: await duplicateCampaign(tenantOf(req), req.auth!.userId, req.params.id) }),
  );

  app.post<IdParams>('/api/campaigns/:id/preview', { preHandler: [requireAuth, ownCampaign] }, async (req) =>
    previewCampaign(tenantOf(req), req.params.id, parseBody(previewBody, req.body).contactId),
  );

  app.post<IdParams>(
    '/api/campaigns/:id/test',
    { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req) => {
      const b = req.body as { phones?: unknown } | undefined;
      if (b && Array.isArray(b.phones)) return sendTestWhatsApp(tenantOf(req), req.params.id, parseBody(testPhonesBody, req.body).phones);
      return sendTestEmail(tenantOf(req), req.params.id, parseBody(testBody, req.body).emails);
    },
  );

  app.post<IdParams>('/api/campaigns/:id/schedule', { preHandler: [requireAuth, ownCampaign] }, async (req) => ({
    campaign: await scheduleCampaign(tenantOf(req), req.params.id, parseBody(scheduleBody, req.body).scheduledAt),
  }));

  app.post<IdParams>('/api/campaigns/:id/unschedule', { preHandler: [requireAuth, ownCampaign] }, async (req) => ({
    campaign: await unscheduleCampaign(tenantOf(req), req.params.id),
  }));

  app.post<IdParams>('/api/campaigns/:id/send', { preHandler: [requireAuth, ownCampaign] }, async (req) => ({
    campaign: await sendCampaignNow(tenantOf(req), req.params.id),
  }));

  app.post<IdParams>('/api/campaigns/:id/cancel', { preHandler: [requireAuth, ownCampaign] }, async (req) => ({
    campaign: await cancelCampaign(tenantOf(req), req.params.id),
  }));

  app.get<IdParams>('/api/campaigns/:id/report', { preHandler: [requireAuth, ownCampaign] }, async (req) => campaignReport(tenantOf(req), req.params.id));

  // "186 contacts match" while the user builds an audience
  app.post('/api/audience/count', { preHandler: requireAuth }, async (req) => ({
    count: await (async () => {
      const { channel, ...audience } = parseBody(audienceSchema.extend({ channel: z.enum(['EMAIL', 'WHATSAPP']).optional() }), req.body);
      const scoped = scopeAudience(audience, viewerOf(req)) as typeof audience;
      return channel === 'WHATSAPP' ? countWhatsAppAudience(db, tenantOf(req), scoped) : countEmailAudience(db, tenantOf(req), scoped);
    })(),
  }));
}

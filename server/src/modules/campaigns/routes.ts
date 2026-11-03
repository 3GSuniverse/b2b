import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { parseBody } from '../../lib/http.js';
import { countEmailAudience } from '../audience/resolve.js';
import { requireAuth, tenantOf } from '../auth/guard.js';
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

export async function campaignRoutes(app: FastifyInstance) {
  app.get('/api/campaigns', { preHandler: requireAuth }, async (req) => listCampaigns(tenantOf(req), parseBody(listCampaignsQuery, req.query)));

  app.post('/api/campaigns', { preHandler: requireAuth }, async (req, reply) => {
    const body = parseBody(campaignBody, req.body);
    return reply.code(201).send({ campaign: await createCampaign(tenantOf(req), req.auth!.userId, body) });
  });

  app.get<IdParams>('/api/campaigns/:id', { preHandler: requireAuth }, async (req) => ({ campaign: await getCampaign(tenantOf(req), req.params.id) }));

  app.patch<IdParams>('/api/campaigns/:id', { preHandler: requireAuth }, async (req) => ({
    campaign: await updateCampaign(tenantOf(req), req.params.id, parseBody(campaignBody.partial(), req.body)),
  }));

  app.delete<IdParams>('/api/campaigns/:id', { preHandler: requireAuth }, async (req, reply) => {
    await deleteCampaign(tenantOf(req), req.params.id);
    return reply.code(204).send();
  });

  app.post<IdParams>('/api/campaigns/:id/duplicate', { preHandler: requireAuth }, async (req, reply) =>
    reply.code(201).send({ campaign: await duplicateCampaign(tenantOf(req), req.auth!.userId, req.params.id) }),
  );

  app.post<IdParams>('/api/campaigns/:id/preview', { preHandler: requireAuth }, async (req) =>
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

  app.post<IdParams>('/api/campaigns/:id/schedule', { preHandler: requireAuth }, async (req) => ({
    campaign: await scheduleCampaign(tenantOf(req), req.params.id, parseBody(scheduleBody, req.body).scheduledAt),
  }));

  app.post<IdParams>('/api/campaigns/:id/unschedule', { preHandler: requireAuth }, async (req) => ({
    campaign: await unscheduleCampaign(tenantOf(req), req.params.id),
  }));

  app.post<IdParams>('/api/campaigns/:id/send', { preHandler: requireAuth }, async (req) => ({
    campaign: await sendCampaignNow(tenantOf(req), req.params.id),
  }));

  app.post<IdParams>('/api/campaigns/:id/cancel', { preHandler: requireAuth }, async (req) => ({
    campaign: await cancelCampaign(tenantOf(req), req.params.id),
  }));

  app.get<IdParams>('/api/campaigns/:id/report', { preHandler: requireAuth }, async (req) => campaignReport(tenantOf(req), req.params.id));

  // "186 contacts match" while the user builds an audience
  app.post('/api/audience/count', { preHandler: requireAuth }, async (req) => ({
    count: await countEmailAudience(db, tenantOf(req), parseBody(audienceSchema, req.body)),
  }));
}

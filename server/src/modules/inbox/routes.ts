import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseBody } from '../../lib/http.js';
import { requireAuth, requireRole, tenantOf, viewerOf } from '../auth/guard.js';
import { aiNotesBody, getAiNotes, setAiNotes, suggestBody, suggestReply } from '../ai/reply-draft.js';
import { askBuddy, buddyBody } from '../ai/buddy.js';
import { autopilotBody, getAutopilot, setAutopilot, setChatAutopilot } from '../ai/autopilot.js';
import { getThread, listChats, listQuery, markRead, reply, replyBody, setDone, unreadCount } from './service.js';

type Id = { Params: { id: string } };
const auth = { preHandler: requireAuth };

export async function inboxRoutes(app: FastifyInstance) {
  app.get('/api/inbox', auth, async (req) => listChats(viewerOf(req), listQuery.parse(req.query)));
  app.get('/api/inbox/unread', auth, async (req) => unreadCount(viewerOf(req)));
  app.get<Id>('/api/inbox/:id', auth, async (req) => getThread(viewerOf(req), req.params.id));
  app.post<Id>('/api/inbox/:id/reply', { ...auth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply_) =>
    reply_.code(201).send(await reply(viewerOf(req), req.params.id, parseBody(replyBody, req.body).text)),
  );
  // Drona AI: a suggested answer, for an employee to check and send
  app.post<Id>('/api/inbox/:id/suggest', { ...auth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) =>
    suggestReply(viewerOf(req), req.params.id, parseBody(suggestBody, req.body ?? {})),
  );
  // What Drona AI should know about the agency (owners and managers write it; everyone's replies use it)
  app.get('/api/ai/notes', auth, async (req) => getAiNotes(tenantOf(req)));
  app.put('/api/ai/notes', { preHandler: requireRole('ADMIN') }, async (req) => setAiNotes(tenantOf(req), parseBody(aiNotesBody, req.body)));
  // Dhru, the helper in the corner of every page
  app.post('/api/ai/buddy', { ...auth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => askBuddy(viewerOf(req), parseBody(buddyBody, req.body)));
  // Drona AI Autopilot on the employee's own WhatsApp number
  app.get('/api/ai/autopilot', auth, async (req) => getAutopilot(viewerOf(req)));
  app.put('/api/ai/autopilot', auth, async (req) => setAutopilot(viewerOf(req), parseBody(autopilotBody, req.body).on));
  app.put<Id>('/api/inbox/:id/autopilot', auth, async (req) => setChatAutopilot(viewerOf(req), req.params.id, parseBody(autopilotBody, req.body).on));
  app.post<Id>('/api/inbox/:id/read', auth, async (req) => {
    await markRead(viewerOf(req), req.params.id);
    return { ok: true };
  });
  app.post<Id>('/api/inbox/:id/done', auth, async (req) => {
    await setDone(viewerOf(req), req.params.id, parseBody(z.object({ done: z.boolean() }), req.body).done);
    return { ok: true };
  });
}

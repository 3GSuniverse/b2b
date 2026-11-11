import { and, count, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { auditLogs, tenants, waChatMessages, waChats, whatsappSessions } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import type { Viewer } from '../auth/guard.js';
import { sendAutopilotReply } from '../inbox/service.js';
import { notify } from '../notifications/service.js';
import { hasFeature, useAi } from '../plans/entitlements.js';
import { aiEnabled } from './quote-draft.js';
import { AUTOPILOT_SAFE, composeReply } from './reply-draft.js';

/**
 * Drona AI Autopilot: when an employee switches it on, customers who write to their WhatsApp get
 * an answer within seconds, day or night. It stays out of the way of people:
 *   - it waits a few seconds so a customer's 3 quick messages get one answer, not three;
 *   - if the employee has written in the chat in the last 30 minutes, the chat is theirs;
 *   - anything that needs a person (payments, bookings, changes, complaints, photos…) isn't sent:
 *     the draft waits in the chat and the employee gets a notification;
 *   - at most a few answers per chat per hour, so it can never get stuck talking to another bot.
 */

export const WAIT_MS = 12_000;
const HUMAN_TAKEOVER_MS = 30 * 60_000;
const MAX_PER_CHAT_HOUR = 6;

export type AutopilotJob = { chatId: string; at: number };

export type AutopilotResult = 'sent' | 'held' | 'skipped_off' | 'skipped_newer' | 'skipped_answered' | 'skipped_human' | 'skipped_limit' | 'skipped_plan' | 'skipped_nothing';

/** Whether this number has Autopilot on (checked when a message arrives, before queueing). */
export async function autopilotOn(sessionId: string) {
  const s = await db.query.whatsappSessions.findFirst({ where: eq(whatsappSessions.id, sessionId), columns: { autopilot: true } });
  return !!s?.autopilot && aiEnabled();
}

/** Answers the chat's latest message, if Autopilot should. Runs a few seconds after the message arrived. */
export async function runAutopilot(job: AutopilotJob): Promise<AutopilotResult> {
  const chat = await db.query.waChats.findFirst({ where: eq(waChats.id, job.chatId) });
  if (!chat) return 'skipped_nothing';
  const session = await db.query.whatsappSessions.findFirst({ where: eq(whatsappSessions.id, chat.sessionId) });
  if (!session?.autopilot || session.status !== 'CONNECTED') return 'skipped_off';
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, session.tenantId) });
  if (!tenant || !hasFeature(tenant, 'ai')) return 'skipped_plan';

  const recent = await db.select().from(waChatMessages).where(eq(waChatMessages.chatId, chat.id)).orderBy(desc(waChatMessages.at)).limit(30);
  const latest = recent[0];
  if (!latest) return 'skipped_nothing';
  // Someone (the employee, or an earlier run) already answered
  if (latest.direction !== 'IN') return 'skipped_answered';
  // The customer wrote again after this job was queued: that newer job answers everything together
  if (latest.at.getTime() > job.at) return 'skipped_newer';
  const humanRecently = recent.some((m) => m.direction === 'OUT' && (m.source === 'reply' || m.source === 'phone') && Date.now() - m.at.getTime() < HUMAN_TAKEOVER_MS);
  if (humanRecently) return 'skipped_human';
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(waChatMessages)
    .where(and(eq(waChatMessages.chatId, chat.id), eq(waChatMessages.source, 'autopilot'), gte(waChatMessages.at, new Date(Date.now() - 3_600_000))));
  if (n >= MAX_PER_CHAT_HOUR) return 'skipped_limit';

  try {
    await useAi(session.tenantId);
  } catch (err) {
    logger.info({ chatId: chat.id, err: (err as Error).message }, 'autopilot: no AI allowance left');
    return 'skipped_limit';
  }
  const r = await composeReply(session.tenantId, chat, { mode: 'autopilot' });
  if (!r) return 'skipped_nothing';
  await db.insert(auditLogs).values({ tenantId: session.tenantId, userId: session.userId, action: 'ai.reply', entity: 'wa_chat', entityId: chat.id, meta: { situation: r.situation, autopilot: true, needsHuman: r.needsHuman } });

  // A person may have answered while the AI was thinking
  const [newest] = await db.select({ direction: waChatMessages.direction, at: waChatMessages.at }).from(waChatMessages).where(eq(waChatMessages.chatId, chat.id)).orderBy(desc(waChatMessages.at)).limit(1);
  if (newest && (newest.direction !== 'IN' || newest.at.getTime() > job.at)) return 'skipped_answered';

  const sendable = !r.needsHuman && AUTOPILOT_SAFE.has(r.situation) && !latest.mediaKind;
  if (sendable) {
    await sendAutopilotReply(session.tenantId, chat, r.reply);
    return 'sent';
  }
  await db.update(waChats).set({ aiDraft: r.reply, aiDraftNote: r.note ?? 'Drona AI wants you to check this one before it goes.' }).where(eq(waChats.id, chat.id));
  await notify(session.tenantId, {
    userId: session.userId,
    type: 'ai.autopilot_held',
    level: 'WARNING',
    title: `A customer needs you: ${chat.phone}`,
    body: r.note ?? `Drona AI drafted a reply about ${r.situation.replace(/_/g, ' ')} and is waiting for you to check it.`,
    link: `/whatsapp/inbox?chat=${chat.id}`,
    dedupeKey: `autopilot:${chat.id}:${job.at}`,
  });
  return 'held';
}

// ---------------------------------------------------------------------
//  The switch, for the employee whose number it is
// ---------------------------------------------------------------------

export const autopilotBody = z.object({ on: z.boolean() });

export async function getAutopilot(v: Viewer) {
  const s = await db.query.whatsappSessions.findFirst({ where: and(eq(whatsappSessions.tenantId, v.tenantId), eq(whatsappSessions.userId, v.userId)) });
  const tenant = (await db.query.tenants.findFirst({ where: eq(tenants.id, v.tenantId) }))!;
  const since = new Date(Date.now() - 86_400_000);
  const [stats] = s
    ? await db
        .select({ sent: count() })
        .from(waChatMessages)
        .innerJoin(waChats, eq(waChats.id, waChatMessages.chatId))
        .where(and(eq(waChats.sessionId, s.id), eq(waChatMessages.source, 'autopilot'), gte(waChatMessages.at, since)))
    : [{ sent: 0 }];
  const [waiting] = s ? await db.select({ n: count() }).from(waChats).where(and(eq(waChats.sessionId, s.id), isNotNull(waChats.aiDraft))) : [{ n: 0 }];
  return {
    linked: !!s,
    connected: s?.status === 'CONNECTED',
    on: !!s?.autopilot,
    aiReady: aiEnabled(),
    allowed: hasFeature(tenant, 'ai'),
    today: { sent: stats?.sent ?? 0, waiting: waiting?.n ?? 0 },
  };
}

export async function setAutopilot(v: Viewer, on: boolean) {
  const s = await db.query.whatsappSessions.findFirst({ where: and(eq(whatsappSessions.tenantId, v.tenantId), eq(whatsappSessions.userId, v.userId)) });
  const tenant = (await db.query.tenants.findFirst({ where: eq(tenants.id, v.tenantId) }))!;
  if (!s) throw new AppError(400, 'no_whatsapp', 'Link your WhatsApp number first, then switch on Autopilot.');
  if (on && !aiEnabled()) throw new AppError(503, 'ai_not_configured', 'Drona AI isn’t set up on this server yet.');
  if (on && !hasFeature(tenant, 'ai')) throw new AppError(403, 'plan_upgrade', 'Autopilot comes with Drona AI. Choose a plan with Drona AI for your next billing cycle in Plan & billing.', { feature: 'ai' });
  await db.update(whatsappSessions).set({ autopilot: on }).where(eq(whatsappSessions.id, s.id));
  await db.insert(auditLogs).values({ tenantId: v.tenantId, userId: v.userId, action: on ? 'ai.autopilot_on' : 'ai.autopilot_off', entity: 'whatsapp_session', entityId: s.id });
  return getAutopilot(v);
}

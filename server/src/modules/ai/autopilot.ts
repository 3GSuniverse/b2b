import { and, count, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { auditLogs, contacts, tenants, waChatMessages, waChats, whatsappSessions } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import type { Viewer } from '../auth/guard.js';
import { ownedChat, sendAutopilotReply } from '../inbox/service.js';
import { notify } from '../notifications/service.js';
import { hasFeature, useAi } from '../plans/entitlements.js';
import { enqueueAutopilot } from '../../queues/index.js';
import { aiEnabled } from './quote-draft.js';
import { AUTOPILOT_SAFE, composeReply } from './reply-draft.js';

/**
 * Drona AI Autopilot: for every chat that's ticked in the inbox (or all chats, with the big switch),
 * Drona AI writes the answer and sends it by itself within seconds, day or night. No approval.
 *   - it waits a few seconds so a customer's 3 quick messages get one answer, not three;
 *   - if the employee wrote in the chat in the last 30 minutes, the chat is theirs;
 *   - when it can't handle something (payments, bookings, changes, complaints, photos…), it sends a
 *     short "let me check" and hands the chat to the employee: they get a notification, and the AI
 *     stays quiet in that chat until the employee replies;
 *   - at most a few answers per chat per hour, so it can never get stuck talking to another bot.
 * Many chats are answered at the same time (see the worker's concurrency).
 */

export const WAIT_MS = 8_000;
const HUMAN_TAKEOVER_MS = 30 * 60_000;
const MAX_PER_CHAT_HOUR = 10;

export type AutopilotJob = { chatId: string; at: number };

export type AutopilotResult = 'sent' | 'handed_off' | 'skipped_off' | 'skipped_newer' | 'skipped_answered' | 'skipped_human' | 'skipped_handoff' | 'skipped_limit' | 'skipped_plan' | 'skipped_nothing';

/** Whether Autopilot answers this chat (checked when a message arrives, before queueing). */
export async function autopilotOn(sessionId: string, chatId?: string) {
  if (!aiEnabled()) return false;
  const s = await db.query.whatsappSessions.findFirst({ where: eq(whatsappSessions.id, sessionId), columns: { autopilot: true } });
  if (s?.autopilot) return true;
  if (!chatId) return false;
  const c = await db.query.waChats.findFirst({ where: eq(waChats.id, chatId), columns: { autopilot: true } });
  return !!c?.autopilot;
}

/** Keeps a reply to the length a person types: at most 3 short lines. */
export function humanLength(text: string) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, 3).join('\n');
}

/** Answers the chat's latest message, if Autopilot should. Runs a few seconds after the message arrived. */
export async function runAutopilot(job: AutopilotJob): Promise<AutopilotResult> {
  const chat = await db.query.waChats.findFirst({ where: eq(waChats.id, job.chatId) });
  if (!chat) return 'skipped_nothing';
  const session = await db.query.whatsappSessions.findFirst({ where: eq(whatsappSessions.id, chat.sessionId) });
  if (!session || !(session.autopilot || chat.autopilot) || session.status !== 'CONNECTED') return 'skipped_off';
  if (chat.handoffAt) return 'skipped_handoff';
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
  const handOff = r.needsHuman || !AUTOPILOT_SAFE.has(r.situation) || !!latest.mediaKind;
  await db.insert(auditLogs).values({ tenantId: session.tenantId, userId: session.userId, action: 'ai.reply', entity: 'wa_chat', entityId: chat.id, meta: { situation: r.situation, autopilot: true, needsHuman: handOff } });

  // A person may have answered while the AI was thinking
  const [newest] = await db.select({ direction: waChatMessages.direction, at: waChatMessages.at }).from(waChatMessages).where(eq(waChatMessages.chatId, chat.id)).orderBy(desc(waChatMessages.at)).limit(1);
  if (newest && (newest.direction !== 'IN' || newest.at.getTime() > job.at)) return 'skipped_answered';

  await sendAutopilotReply(session.tenantId, chat, humanLength(r.reply));
  if (!handOff) return 'sent';

  const contact = await db.query.contacts.findFirst({ where: and(eq(contacts.tenantId, session.tenantId), eq(contacts.phone, chat.phone), eq(contacts.ownerId, session.userId)), columns: { firstName: true, lastName: true } });
  const who = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || chat.phone;
  const note = r.note ?? `They asked about ${r.situation.replace(/_/g, ' ')}. Drona AI told them you'll get back shortly.`;
  await db.update(waChats).set({ handoffAt: new Date(), handoffNote: note }).where(eq(waChats.id, chat.id));
  await notify(session.tenantId, {
    userId: session.userId,
    type: 'ai.autopilot_handoff',
    level: 'WARNING',
    title: `${who} needs you on WhatsApp`,
    body: note,
    link: `/whatsapp/inbox?chat=${chat.id}`,
    dedupeKey: `autopilot:${chat.id}:${job.at}`,
  });
  return 'handed_off';
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
  const [waiting] = s ? await db.select({ n: count() }).from(waChats).where(and(eq(waChats.sessionId, s.id), isNotNull(waChats.handoffAt))) : [{ n: 0 }];
  const [ticked] = s ? await db.select({ n: count() }).from(waChats).where(and(eq(waChats.sessionId, s.id), eq(waChats.autopilot, true))) : [{ n: 0 }];
  return {
    linked: !!s,
    connected: s?.status === 'CONNECTED',
    on: !!s?.autopilot,
    aiReady: aiEnabled(),
    allowed: hasFeature(tenant, 'ai'),
    chats: ticked?.n ?? 0,
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

/** The tick next to a chat in the inbox. Ticking it also hands a chat back to the AI after a person took over. */
export async function setChatAutopilot(v: Viewer, chatId: string, on: boolean) {
  const chat = await ownedChat(v, chatId);
  const tenant = (await db.query.tenants.findFirst({ where: eq(tenants.id, v.tenantId) }))!;
  if (on && !aiEnabled()) throw new AppError(503, 'ai_not_configured', 'Drona AI isn’t set up on this server yet.');
  if (on && !hasFeature(tenant, 'ai')) throw new AppError(403, 'plan_upgrade', 'Autopilot comes with Drona AI. Choose a plan with Drona AI for your next billing cycle in Plan & billing.', { feature: 'ai' });
  await db.update(waChats).set({ autopilot: on, handoffAt: null, handoffNote: null }).where(eq(waChats.id, chat.id));
  await db.insert(auditLogs).values({ tenantId: v.tenantId, userId: v.userId, action: on ? 'ai.autopilot_chat_on' : 'ai.autopilot_chat_off', entity: 'wa_chat', entityId: chat.id });
  // A customer already waiting gets an answer now, not at their next message
  if (on) {
    const [latest] = await db.select({ direction: waChatMessages.direction, at: waChatMessages.at }).from(waChatMessages).where(eq(waChatMessages.chatId, chat.id)).orderBy(desc(waChatMessages.at)).limit(1);
    if (latest?.direction === 'IN') await enqueueAutopilot(chat.id, latest.at, 1_000);
  }
  return { id: chat.id, autopilot: on };
}

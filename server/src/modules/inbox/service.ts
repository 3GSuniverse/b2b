import { and, desc, eq, gt, gte, ilike, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { campaigns, contacts, messages, users, waChatMessages, waChats, whatsappSessions, type Message } from '../../db/schema.js';
import { seesAll, type Viewer } from '../auth/guard.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { enqueueWhatsApp } from '../../queues/index.js';
import { buildMergeVars, renderString } from '../email/render.js';

/**
 * The WhatsApp inbox. What customers write to the agency's linked number, what the team answers
 * (from Dhrona or from the phone), and the broadcasts and reminders those replies are about,
 * kept as one conversation per customer.
 */

type Source = 'customer' | 'reply' | 'broadcast' | 'automatic' | 'phone';
export interface InboundMessage {
  phone: string;
  text: string | null;
  mediaKind?: string | null;
  mediaName?: string | null;
  waId: string | null;
  at: Date;
}

const BACKFILL_DAYS = 60;
const preview = (text: string | null, mediaKind?: string | null) =>
  (text?.trim() || (mediaKind ? MEDIA_LABEL[mediaKind] ?? 'Attachment' : '')).replace(/\s+/g, ' ').slice(0, 140);
export const MEDIA_LABEL: Record<string, string> = {
  image: '📷 Photo',
  video: '🎬 Video',
  document: '📄 Document',
  audio: '🎤 Voice message',
  sticker: 'Sticker',
  location: '📍 Location',
  contact: '👤 Contact',
};

function sourceOf(m: Pick<Message, 'campaignId' | 'automationId' | 'sentById' | 'service'>): Source {
  if (m.campaignId) return 'broadcast';
  if (m.automationId) return 'automatic';
  if (m.sentById && m.service) return 'reply';
  return 'automatic';
}

/** Chats on the employee's own number(s); owners and managers see every chat. */
function chatScope(v: Viewer) {
  return and(
    eq(waChats.tenantId, v.tenantId),
    seesAll(v) ? undefined : sql`${waChats.sessionId} in (select ${whatsappSessions.id} from ${whatsappSessions} where ${whatsappSessions.userId} = ${v.userId})`,
  );
}

/** The chat with this number on this employee's line, made on first contact; earlier messages we sent them are copied in. */
/** Matches the customers of the employee whose WhatsApp number the chat is on */
export const chatOwner = (sessionId: string) => sql`${contacts.ownerId} = (select user_id from whatsapp_sessions where id = ${sessionId})`;

async function ensureChat(tenantId: string, sessionId: string, phone: string) {
  const [made] = await db.insert(waChats).values({ tenantId, sessionId, phone }).onConflictDoNothing().returning({ id: waChats.id });
  if (!made) return (await db.query.waChats.findFirst({ where: and(eq(waChats.sessionId, sessionId), eq(waChats.phone, phone)), columns: { id: true } }))!.id;

  // What we sent this person recently (broadcasts, reminders), so their reply makes sense
  const since = new Date(Date.now() - BACKFILL_DAYS * 86_400_000);
  const earlier = await db.query.messages.findMany({
    where: and(eq(messages.whatsappSessionId, sessionId), eq(messages.channel, 'WHATSAPP'), eq(messages.toAddress, phone), gte(messages.sentAt, since)),
    with: { campaign: { columns: { text: true } }, contact: true, tenant: true },
    orderBy: [desc(messages.sentAt)],
    limit: 20,
  });
  if (earlier.length) {
    await db
      .insert(waChatMessages)
      .values(
        earlier.map((m) => ({
          tenantId,
          chatId: made.id,
          direction: 'OUT' as const,
          source: sourceOf(m),
          body: renderString((m.body ?? m.campaign?.text ?? '').toString(), buildMergeVars(m.contact, m.tenant), { html: false }) || null,
          mediaKind: (m.body ?? m.campaign?.text) ? null : 'document',
          waId: m.providerMessageId,
          messageId: m.id,
          sentById: m.sentById,
          at: m.sentAt!,
        })),
      )
      .onConflictDoNothing();
  }
  return made.id;
}

async function touch(chatId: string, direction: 'IN' | 'OUT', text: string | null, mediaKind: string | null | undefined, at: Date) {
  await db
    .update(waChats)
    .set({
      lastMessageAt: sql`greatest(${waChats.lastMessageAt}, ${at.toISOString()}::timestamptz)`,
      lastPreview: preview(text, mediaKind),
      lastDirection: direction,
      ...(direction === 'IN' ? { unread: sql`${waChats.unread} + 1`, doneAt: null } : {}),
    })
    .where(eq(waChats.id, chatId));
}

/** A customer wrote to the agency. */
export async function recordIncoming(tenantId: string, sessionId: string, m: InboundMessage) {
  const chatId = await ensureChat(tenantId, sessionId, m.phone);
  const [row] = await db
    .insert(waChatMessages)
    .values({ tenantId, chatId, direction: 'IN', source: 'customer', body: m.text, mediaKind: m.mediaKind ?? null, mediaName: m.mediaName ?? null, waId: m.waId, at: m.at })
    .onConflictDoNothing()
    .returning({ id: waChatMessages.id });
  if (row) await touch(chatId, 'IN', m.text, m.mediaKind, m.at);
  return chatId;
}

/**
 * Something the agency's own number sent: typed on the phone, or the echo of a message Dhrona sent.
 * Echoes of Dhrona's messages are matched up instead of recorded twice.
 */
export async function recordFromPhone(tenantId: string, sessionId: string, m: InboundMessage) {
  if (m.waId) {
    const seen = await db.query.waChatMessages.findFirst({ where: and(eq(waChatMessages.tenantId, tenantId), eq(waChatMessages.waId, m.waId)), columns: { id: true } });
    if (seen) return;
    const [sentByDhrona] = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.tenantId, tenantId), eq(messages.providerMessageId, m.waId))).limit(1);
    if (sentByDhrona) return; // recordSent handles it
  }
  const chat = await db.query.waChats.findFirst({ where: and(eq(waChats.sessionId, sessionId), eq(waChats.phone, m.phone)), columns: { id: true } });
  if (chat && m.text) {
    // A reply typed in Dhrona whose send is still finishing: same chat, same words, moments ago
    const pending = await db.query.waChatMessages.findFirst({
      where: and(
        eq(waChatMessages.chatId, chat.id),
        eq(waChatMessages.direction, 'OUT'),
        isNull(waChatMessages.waId),
        eq(waChatMessages.body, m.text),
        gt(waChatMessages.at, new Date(m.at.getTime() - 5 * 60_000)),
      ),
      columns: { id: true },
    });
    if (pending) {
      await db.update(waChatMessages).set({ waId: m.waId }).where(eq(waChatMessages.id, pending.id));
      return;
    }
  }
  const chatId = chat?.id ?? (await ensureChat(tenantId, sessionId, m.phone));
  const [row] = await db
    .insert(waChatMessages)
    .values({ tenantId, chatId, direction: 'OUT', source: 'phone', body: m.text, mediaKind: m.mediaKind ?? null, mediaName: m.mediaName ?? null, waId: m.waId, at: m.at })
    .onConflictDoNothing()
    .returning({ id: waChatMessages.id });
  // The employee answered from the phone: any Autopilot draft for this chat is no longer needed
  if (row) await db.update(waChats).set({ aiDraft: null, aiDraftNote: null, handoffAt: null, handoffNote: null, aiStatus: null, aiStatusNote: null }).where(eq(waChats.id, chatId));
  if (row) await touch(chatId, 'OUT', m.text, m.mediaKind, m.at);
}

/** Dhrona delivered a WhatsApp message: add it to the person's chat (starting one, unless it's a broadcast). */
export async function recordSent(
  msg: Pick<Message, 'id' | 'tenantId' | 'toAddress' | 'campaignId' | 'automationId' | 'sentById' | 'service' | 'whatsappSessionId'>,
  text: string,
  waId: string,
  at = new Date(),
) {
  const own = await db.query.waChatMessages.findFirst({ where: eq(waChatMessages.messageId, msg.id), columns: { id: true, chatId: true } });
  if (own) {
    await db.update(waChatMessages).set({ waId, at }).where(eq(waChatMessages.id, own.id));
    return;
  }
  if (!msg.whatsappSessionId) return;
  const found = await db.query.waChats.findFirst({ where: and(eq(waChats.sessionId, msg.whatsappSessionId), eq(waChats.phone, msg.toAddress)), columns: { id: true } });
  // A one-to-one message (sent from Dhrona, a reminder, a quote…) starts the chat, so it shows in the inbox.
  // Broadcasts don't: thousands of one-way chats would bury real conversations; theirs appear when the person replies.
  if (!found && msg.campaignId) return;
  const chat = found ?? { id: await ensureChat(msg.tenantId, msg.whatsappSessionId, msg.toAddress) };
  await db
    .insert(waChatMessages)
    .values({ tenantId: msg.tenantId, chatId: chat.id, direction: 'OUT', source: sourceOf(msg), body: text || null, waId, messageId: msg.id, sentById: msg.sentById, at })
    .onConflictDoUpdate({ target: [waChatMessages.tenantId, waChatMessages.waId], set: { messageId: msg.id, source: sourceOf(msg), sentById: msg.sentById } });
  await touch(chat.id, 'OUT', text, null, at);
}

// ------------------------------------------------------------------------- what the app shows

export const listQuery = z.object({
  filter: z.enum(['all', 'unread', 'open', 'done']).default('all'),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional(),
});

const nameSql = sql<string | null>`nullif(trim(coalesce(${contacts.firstName}, '') || ' ' || coalesce(${contacts.lastName}, '')), '')`;

export async function listChats(v: Viewer, q: z.infer<typeof listQuery>) {
  const term = q.search ? `%${q.search.replace(/[%_]/g, '')}%` : null;
  const rows = await db
    .select({
      id: waChats.id,
      phone: waChats.phone,
      lastMessageAt: waChats.lastMessageAt,
      lastPreview: waChats.lastPreview,
      lastDirection: waChats.lastDirection,
      unread: waChats.unread,
      autopilot: waChats.autopilot,
      needsYou: sql<boolean>`${waChats.handoffAt} is not null`,
      // "waiting"/"thinking" older than 3 minutes is stale (worker restarted): don't show it
      aiStatus: sql<string | null>`case when ${waChats.aiStatus} in ('waiting','thinking') and ${waChats.aiStatusAt} < now() - interval '3 minutes' then null else ${waChats.aiStatus} end`,
      aiStatusNote: waChats.aiStatusNote,
      done: sql<boolean>`${waChats.doneAt} is not null`,
      contactId: contacts.id,
      name: nameSql,
      // Whose number the chat is on (owners and managers see everyone's)
      employee: users.name,
    })
    .from(waChats)
    .leftJoin(whatsappSessions, eq(whatsappSessions.id, waChats.sessionId))
    // The customer is the one in the list of the employee whose number this chat is on
    .leftJoin(contacts, and(eq(contacts.tenantId, waChats.tenantId), eq(contacts.phone, waChats.phone), eq(contacts.ownerId, whatsappSessions.userId)))
    .leftJoin(users, eq(users.id, whatsappSessions.userId))
    .where(
      and(
        chatScope(v),
        q.filter === 'unread' ? gt(waChats.unread, 0) : undefined,
        q.filter === 'open' ? isNull(waChats.doneAt) : undefined,
        q.filter === 'done' ? sql`${waChats.doneAt} is not null` : undefined,
        q.before ? lt(waChats.lastMessageAt, new Date(q.before)) : undefined,
        term ? or(ilike(waChats.phone, term), ilike(contacts.firstName, term), ilike(contacts.lastName, term), ilike(waChats.lastPreview, term)) : undefined,
      ),
    )
    .orderBy(desc(waChats.lastMessageAt))
    .limit(q.limit);
  return { chats: rows };
}

export async function unreadCount(v: Viewer) {
  const [r] = await db
    .select({ chats: sql<number>`count(*) filter (where ${waChats.unread} > 0)::int`, messages: sql<number>`coalesce(sum(${waChats.unread}), 0)::int` })
    .from(waChats)
    .where(chatScope(v));
  return r ?? { chats: 0, messages: 0 };
}

export async function ownedChat(v: Viewer, chatId: string) {
  const [chat] = await db.select().from(waChats).where(and(eq(waChats.id, chatId), chatScope(v))).limit(1);
  if (!chat) throw new AppError(404, 'not_found', 'Conversation not found');
  return chat;
}

export async function getThread(v: Viewer, chatId: string) {
  const { tenantId } = v;
  const chat = await ownedChat(v, chatId);
  const [contact, rows] = await Promise.all([
    db.query.contacts.findFirst({ where: and(eq(contacts.tenantId, tenantId), eq(contacts.phone, chat.phone), chatOwner(chat.sessionId)), columns: { id: true, firstName: true, lastName: true, email: true, whatsappStatus: true } }),
    db
      .select({
        id: waChatMessages.id,
        direction: waChatMessages.direction,
        source: waChatMessages.source,
        body: waChatMessages.body,
        mediaKind: waChatMessages.mediaKind,
        mediaName: waChatMessages.mediaName,
        at: waChatMessages.at,
        sentBy: users.name,
        status: messages.status,
        delivered: sql<boolean>`${messages.deliveredAt} is not null`,
        read: sql<boolean>`${messages.firstOpenedAt} is not null`,
        error: messages.error,
        campaignName: campaigns.name,
      })
      .from(waChatMessages)
      .leftJoin(users, eq(users.id, waChatMessages.sentById))
      .leftJoin(messages, eq(messages.id, waChatMessages.messageId))
      .leftJoin(campaigns, eq(campaigns.id, messages.campaignId))
      .where(eq(waChatMessages.chatId, chat.id))
      .orderBy(desc(waChatMessages.at))
      .limit(300),
  ]);
  return {
    chat: { id: chat.id, phone: chat.phone, done: !!chat.doneAt, unread: chat.unread, aiDraft: chat.aiDraft ? { text: chat.aiDraft, note: chat.aiDraftNote } : null, autopilot: chat.autopilot, ai: chat.aiStatus && !(['waiting', 'thinking'].includes(chat.aiStatus) && Date.now() - (chat.aiStatusAt?.getTime() ?? 0) > 180_000) ? { status: chat.aiStatus, note: chat.aiStatusNote } : null, handoff: chat.handoffAt ? { at: chat.handoffAt, note: chat.handoffNote } : null },
    contact: contact ? { id: contact.id, name: [contact.firstName, contact.lastName].filter(Boolean).join(' ') || null, email: contact.email, whatsappStatus: contact.whatsappStatus } : null,
    messages: rows.reverse(),
  };
}

export const replyBody = z.object({ text: z.string().trim().min(1, 'Write a reply first').max(4000, 'Keep it under 4,000 characters') });

/** An employee answers from Dhrona. It goes ahead of any broadcast still sending. */
export async function reply(v: Viewer, chatId: string, text: string, enqueue = (ids: string[]) => enqueueWhatsApp(ids, { urgent: true })) {
  const { tenantId, userId } = v;
  const chat = await ownedChat(v, chatId);
  const contact = await db.query.contacts.findFirst({ where: and(eq(contacts.tenantId, tenantId), eq(contacts.phone, chat.phone), chatOwner(chat.sessionId)), columns: { id: true } });
  const now = new Date();
  // A reply to someone who wrote to you: it goes unless they replied STOP
  const [m] = await db
    .insert(messages)
    .values({ tenantId, channel: 'WHATSAPP', toAddress: chat.phone, contactId: contact?.id ?? null, body: text, service: true, sentById: userId, whatsappSessionId: chat.sessionId })
    .returning();
  const [row] = await db
    .insert(waChatMessages)
    .values({ tenantId, chatId, direction: 'OUT', source: 'reply', body: text, messageId: m!.id, sentById: userId, at: now })
    .returning({ id: waChatMessages.id });
  await db.update(waChats).set({ unread: 0, aiDraft: null, aiDraftNote: null, handoffAt: null, handoffNote: null, aiStatus: null, aiStatusNote: null }).where(eq(waChats.id, chatId));
  await touch(chatId, 'OUT', text, null, now);
  await enqueue([m!.id]);
  return { id: row!.id, messageId: m!.id };
}

/** Drona AI Autopilot answers on the employee's number. It goes ahead of any broadcast still sending. */
export async function sendAutopilotReply(tenantId: string, chat: typeof waChats.$inferSelect, text: string, enqueue = (ids: string[]) => enqueueWhatsApp(ids, { urgent: true })) {
  const contact = await db.query.contacts.findFirst({ where: and(eq(contacts.tenantId, tenantId), eq(contacts.phone, chat.phone), chatOwner(chat.sessionId)), columns: { id: true } });
  const now = new Date();
  const [m] = await db
    .insert(messages)
    .values({ tenantId, channel: 'WHATSAPP', toAddress: chat.phone, contactId: contact?.id ?? null, body: text, service: true, whatsappSessionId: chat.sessionId })
    .returning();
  await db.insert(waChatMessages).values({ tenantId, chatId: chat.id, direction: 'OUT', source: 'autopilot', body: text, messageId: m!.id, at: now });
  await db.update(waChats).set({ aiDraft: null, aiDraftNote: null }).where(eq(waChats.id, chat.id));
  await touch(chat.id, 'OUT', text, null, now);
  await enqueue([m!.id]);
  return m!.id;
}

export async function markRead(v: Viewer, chatId: string) {
  await ownedChat(v, chatId);
  await db.update(waChats).set({ unread: 0 }).where(eq(waChats.id, chatId));
}

export async function setDone(v: Viewer, chatId: string, done: boolean) {
  await ownedChat(v, chatId);
  await db.update(waChats).set({ doneAt: done ? new Date() : null, ...(done ? { unread: 0 } : {}) }).where(eq(waChats.id, chatId));
}


import { and, count, desc, eq, gte, inArray, isNotNull, isNull, max, min, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { campaigns, contacts, messages, suppressions, tenants, whatsappSessions, whatsappTrialNumbers } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { buildMergeVars, renderString } from '../email/render.js';
import { notify } from '../notifications/service.js';
import { bumpCounter } from '../sending/counters.js';
import { DeferSend, finalizeMessage, maybeCompleteCampaign, type SendOutcome } from '../sending/send-message.js';
import { getQr } from './bus.js';
import { trialEnded, trialWhatsAppPerDay, whatsappWebAllowed } from '../plans/entitlements.js';
import { getWhatsAppGateway, WhatsAppError, type WhatsAppGateway } from './gateway.js';
import { loadFiles, whatsappKind, type AttachmentFile } from '../attachments/service.js';

/** WhatsApp's limit for the caption under a photo, video or document. */
const CAPTION_MAX = 1024;

/**
 * Sends the text and the files as WhatsApp shows them best:
 * one photo, video or document with a short message goes as that file with the message as its caption;
 * otherwise the message first, then each file.
 *
 * Returns the first message's id (for ✓✓ receipts). Once anything has reached the customer,
 * a later failure is reported in `partial` instead of thrown: retrying would send the first part twice.
 */
export async function deliverWhatsApp(gateway: WhatsAppGateway, tenantId: string, to: string, text: string, files: AttachmentFile[]) {
  const media = (f: AttachmentFile, caption?: string) =>
    gateway.sendMedia(tenantId, to, { kind: whatsappKind(f.type), data: f.data, mimeType: f.type, fileName: f.name, caption });
  const only = files.length === 1 ? files[0]! : null;
  if (only && whatsappKind(only.type) !== 'audio' && text.length <= CAPTION_MAX) {
    return { id: (await media(only, text || undefined)).id, partial: null as string | null };
  }
  const parts: (() => Promise<{ id: string }>)[] = [
    ...(text.trim() ? [() => gateway.sendText(tenantId, to, text)] : []),
    ...files.map((f) => () => media(f)),
  ];
  let first: string | null = null;
  for (const [i, send] of parts.entries()) {
    try {
      const { id } = await send();
      first ??= id;
    } catch (err) {
      if (!first) throw err;
      return { id: first, partial: `${parts.length - i} of ${parts.length} parts not sent: ${(err as Error).message}`.slice(0, 300) };
    }
  }
  return { id: first!, partial: null as string | null };
}

/** WhatsApp's own limit for one text message. */
export const WHATSAPP_MAX_LENGTH = 4096;
export const DAILY_LIMIT_RANGE = { min: 20, max: 500 } as const;

// ---------------------------------------------------------------- session state

export async function getSession(tenantId: string) {
  const s = await db.query.whatsappSessions.findFirst({ where: eq(whatsappSessions.tenantId, tenantId) });
  if (s) return s;
  const [created] = await db.insert(whatsappSessions).values({ tenantId }).onConflictDoNothing().returning();
  return created ?? (await db.query.whatsappSessions.findFirst({ where: eq(whatsappSessions.tenantId, tenantId) }))!;
}

export async function assertEnabled(tenantId: string) {
  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!t || !whatsappWebAllowed(t)) {
    throw new AppError(404, 'feature_not_enabled', t && trialEnded(t) ? 'Your free trial has ended' : 'WhatsApp sending isn’t available on this account');
  }
}

/** Sent in the last 24 hours from this company's number (rolling, like the Gmail limit). */
export async function whatsappUsageLast24h(tenantId: string, now = new Date()) {
  const since = new Date(now.getTime() - 86_400_000);
  const [row] = await db
    .select({ sent: count(), oldest: min(messages.sentAt), last: max(messages.sentAt) })
    .from(messages)
    .where(and(eq(messages.tenantId, tenantId), eq(messages.channel, 'WHATSAPP'), isNotNull(messages.sentAt), gte(messages.sentAt, since)));
  return { sent: row?.sent ?? 0, oldest: row?.oldest ?? null, last: row?.last ?? null };
}

export async function whatsappStatusDto(tenantId: string) {
  const s = await getSession(tenantId);
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  const trialPerDay = tenant ? trialWhatsAppPerDay(tenant) : null;
  const usage = await whatsappUsageLast24h(tenantId);
  const qr = s.status === 'CONNECTING' ? await getQr(tenantId) : null;
  return {
    status: s.status,
    phone: s.phone,
    displayName: s.displayName,
    dailyLimit: Math.min(s.dailyLimit, trialPerDay ?? Infinity),
    trialPerDay,
    intervalSeconds: s.intervalSeconds,
    sentLast24h: usage.sent,
    lastError: s.lastError,
    connectedAt: s.connectedAt,
    qr: qr ? await QRCode.toDataURL(qr, { margin: 1, width: 280, color: { dark: '#111816', light: '#ffffff' } }) : null,
  };
}

// ---------------------------------------------------------------- events from the connection (worker)

export async function onQr(tenantId: string) {
  await db.update(whatsappSessions).set({ status: 'CONNECTING', lastError: null }).where(eq(whatsappSessions.tenantId, tenantId));
}

/**
 * Called when a phone finishes linking. Returns false if the number isn't allowed here:
 * each WhatsApp number gets one free trial, so signing up again doesn't buy more messages.
 */
export async function onConnected(tenantId: string, phone: string, displayName: string | null): Promise<boolean> {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (tenant?.plan === 'TRIAL' && !tenant.whatsappWebEnabled && phone) {
    const [claimed] = await db.insert(whatsappTrialNumbers).values({ phone, tenantId }).onConflictDoNothing().returning();
    const owner = claimed ?? (await db.query.whatsappTrialNumbers.findFirst({ where: eq(whatsappTrialNumbers.phone, phone) }));
    if (owner && owner.tenantId !== tenantId) {
      await db
        .update(whatsappSessions)
        .set({ status: 'DISCONNECTED', phone: null, lastError: `${phone} has already been used for a free trial. Link a different number, or upgrade.` })
        .where(eq(whatsappSessions.tenantId, tenantId));
      return false;
    }
  }
  const before = await getSession(tenantId);
  await db
    .update(whatsappSessions)
    .set({ status: 'CONNECTED', phone, displayName, lastError: null, connectedAt: before.status === 'CONNECTED' ? before.connectedAt : new Date() })
    .where(eq(whatsappSessions.tenantId, tenantId));
  if (before.status !== 'CONNECTED') {
    await notify(tenantId, {
      type: 'whatsapp.connected',
      level: 'SUCCESS',
      title: `WhatsApp ${phone} is linked`,
      body: 'You can send WhatsApp campaigns from it now.',
      link: '/whatsapp',
      dedupeKey: `whatsapp.connected:${phone}:${new Date().toISOString().slice(0, 10)}`,
    });
  }
  return true;
}

/** Linking couldn't reach WhatsApp at all (network, or WhatsApp refusing the connection). */
export async function onLinkFailed(tenantId: string) {
  await db
    .update(whatsappSessions)
    .set({ status: 'DISCONNECTED', lastError: 'Couldn’t reach WhatsApp to show a QR code. Check the server’s internet connection and try again.' })
    .where(and(eq(whatsappSessions.tenantId, tenantId), eq(whatsappSessions.status, 'CONNECTING')));
}

/** The phone unlinked us, or WhatsApp refused the number. Either way, sending stops until it's relinked. */
export async function onEnded(tenantId: string, reason: 'LOGGED_OUT' | 'BLOCKED', detail?: string) {
  const s = await getSession(tenantId);
  await db
    .update(whatsappSessions)
    .set({
      status: reason,
      lastError:
        reason === 'BLOCKED'
          ? 'WhatsApp blocked this number from using WhatsApp Web. Check the phone for a message from WhatsApp.'
          : 'The number was unlinked from the phone (Linked devices → Log out). Link it again to keep sending.',
    })
    .where(eq(whatsappSessions.tenantId, tenantId));
  await notify(tenantId, {
    type: `whatsapp.${reason.toLowerCase()}`,
    level: 'ERROR',
    title: reason === 'BLOCKED' ? `WhatsApp blocked ${s.phone ?? 'your number'}` : `WhatsApp ${s.phone ?? ''} was unlinked`,
    body: reason === 'BLOCKED' ? 'WhatsApp campaigns are paused. This usually follows complaints or sending too fast.' : 'WhatsApp campaigns are paused until you link the number again.',
    link: '/whatsapp',
    dedupeKey: `whatsapp.${reason}:${Date.now()}`,
  });
  return detail;
}

/** Delivery receipts: ✓✓ (delivered) and blue ✓✓ (read). */
export async function onReceipt(providerMessageId: string, status: number) {
  const DELIVERY_ACK = 3;
  const READ = 4;
  if (status < DELIVERY_ACK) return;
  const msg = await db.query.messages.findFirst({
    where: and(eq(messages.providerMessageId, providerMessageId), eq(messages.channel, 'WHATSAPP')),
    columns: { id: true, campaignId: true, automationId: true },
  });
  if (!msg) return;
  await db.transaction(async (tx) => {
    const delivered = await tx
      .update(messages)
      .set({ deliveredAt: new Date(), status: 'DELIVERED' })
      .where(and(eq(messages.id, msg.id), isNull(messages.deliveredAt)))
      .returning({ id: messages.id });
    if (delivered.length) await bumpCounter(tx, msg, 'delivered');
    if (status >= READ) {
      const read = await tx
        .update(messages)
        .set({ firstOpenedAt: new Date() })
        .where(and(eq(messages.id, msg.id), isNull(messages.firstOpenedAt)))
        .returning({ id: messages.id });
      if (read.length) await bumpCounter(tx, msg, 'opened');
    }
  });
}

const STOP_WORDS = /^\s*(stop|unsubscribe|stop all|stop messages)\s*[.!]?\s*$/i;

/**
 * Someone wrote to the company's number. "STOP" unsubscribes them from WhatsApp for good.
 * Returns the confirmation to send back, or null.
 */
export async function onIncoming(tenantId: string, fromPhone: string, text: string): Promise<string | null> {
  if (!STOP_WORDS.test(text)) return null;
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId), columns: { name: true } });
  await db.transaction(async (tx) => {
    await tx
      .update(contacts)
      .set({ whatsappStatus: 'UNSUBSCRIBED' })
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.phone, fromPhone)));
    const added = await tx
      .insert(suppressions)
      .values({ tenantId, channel: 'WHATSAPP', address: fromPhone, reason: 'UNSUBSCRIBE', note: 'replied STOP' })
      .onConflictDoNothing()
      .returning({ id: suppressions.id });
    if (added.length) {
      // Count it against the campaign that reached them most recently
      const [last] = await tx
        .select({ campaignId: messages.campaignId, automationId: messages.automationId })
        .from(messages)
        .where(and(eq(messages.tenantId, tenantId), eq(messages.channel, 'WHATSAPP'), eq(messages.toAddress, fromPhone), isNotNull(messages.sentAt)))
        .orderBy(desc(messages.sentAt))
        .limit(1);
      if (last) await bumpCounter(tx, last, 'unsubscribed');
    }
  });
  return `You won’t get any more WhatsApp messages from ${tenant?.name ?? 'us'}.`;
}

// ---------------------------------------------------------------- sending one message (worker)

/**
 * Sends one queued WhatsApp message. Same contract as email: idempotent,
 * re-checks consent at send time, throws only for things worth retrying.
 */
export async function processWhatsAppJob(messageId: string, gateway: WhatsAppGateway = getWhatsAppGateway(), now = new Date()): Promise<SendOutcome> {
  const msg = await db.query.messages.findFirst({
    where: eq(messages.id, messageId),
    with: { tenant: true, contact: true, campaign: true },
  });
  if (!msg) return 'missing';
  if (msg.status !== 'QUEUED') return 'already_processed';

  if (msg.tenant.status !== 'ACTIVE') {
    await finalizeMessage(msg, 'FAILED', `tenant_${msg.tenant.status.toLowerCase()}`);
    return 'failed';
  }
  if (!whatsappWebAllowed(msg.tenant, now)) {
    await finalizeMessage(msg, 'FAILED', trialEnded(msg.tenant, now) ? 'trial_ended' : 'whatsapp_not_enabled');
    return 'failed';
  }

  // Consent, checked again at the moment of sending
  const [suppressed] = await db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(and(eq(suppressions.tenantId, msg.tenantId), eq(suppressions.channel, 'WHATSAPP'), eq(suppressions.address, msg.toAddress)))
    .limit(1);
  // Booking messages (payment reminders) go to the customer unless they replied STOP; offers need their opt-in
  const own = !msg.campaignId && !msg.automationId && msg.body !== null;
  const service = own && msg.service;
  if (suppressed || (!service && msg.contact && msg.contact.whatsappStatus !== 'SUBSCRIBED')) {
    await finalizeMessage(msg, 'SUPPRESSED', suppressed ? 'on_suppression_list' : `contact_whatsapp_${msg.contact!.whatsappStatus.toLowerCase()}`);
    return 'suppressed';
  }

  const body = (own ? msg.body : msg.campaign?.text) ?? '';
  const refs = (own ? msg.attachments : msg.campaign?.attachments) ?? [];
  if (!body.trim() && !refs.length) {
    await finalizeMessage(msg, 'FAILED', 'no_content');
    return 'failed';
  }

  // The linked number must be up. If it isn't, wait — the company may relink it.
  const session = await getSession(msg.tenantId);
  if (session.status !== 'CONNECTED') {
    throw new DeferSend(new Date(now.getTime() + 15 * 60_000), `WhatsApp isn’t linked (${session.status.toLowerCase()})`);
  }

  // Pacing: one message every N seconds per number, and a daily cap
  const usage = await whatsappUsageLast24h(msg.tenantId, now);
  const dailyLimit = Math.min(session.dailyLimit, trialWhatsAppPerDay(msg.tenant) ?? Infinity);
  if (usage.sent >= dailyLimit) {
    const until = new Date((usage.oldest?.getTime() ?? now.getTime()) + 86_400_000 + 60_000);
    throw new DeferSend(until, `Daily WhatsApp limit of ${dailyLimit} reached`);
  }
  if (usage.last && now.getTime() - usage.last.getTime() < session.intervalSeconds * 1000) {
    throw new DeferSend(new Date(usage.last.getTime() + session.intervalSeconds * 1000), 'pacing');
  }

  let exists: boolean;
  try {
    exists = await gateway.exists(msg.tenantId, msg.toAddress);
  } catch (err) {
    if (err instanceof WhatsAppError && err.permanent) {
      await finalizeMessage(msg, 'FAILED', err.code);
      return 'failed';
    }
    throw err;
  }
  if (!exists) {
    await finalizeMessage(msg, 'FAILED', 'not_on_whatsapp');
    return 'failed';
  }

  const text = renderString(body, buildMergeVars(msg.contact, msg.tenant), { html: false }).slice(0, WHATSAPP_MAX_LENGTH);
  let files: AttachmentFile[];
  try {
    files = await loadFiles(msg.tenantId, refs);
  } catch {
    await finalizeMessage(msg, 'FAILED', 'attachment_missing');
    return 'failed';
  }
  let id: string;
  let partial: string | null;
  try {
    ({ id, partial } = await deliverWhatsApp(gateway, msg.tenantId, msg.toAddress, text, files));
  } catch (err) {
    if (err instanceof WhatsAppError && err.permanent) {
      await finalizeMessage(msg, 'FAILED', err.code);
      return 'failed';
    }
    throw err;
  }

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(messages)
      .set({ status: 'SENT', providerMessageId: id, sentAt: new Date(), attempts: sql`${messages.attempts} + 1`, error: partial })
      .where(and(eq(messages.id, msg.id), eq(messages.status, 'QUEUED')))
      .returning({ id: messages.id });
    if (updated.length) await bumpCounter(tx, msg, 'sent');
  });
  if (msg.campaignId) await maybeCompleteCampaign(msg.campaignId);
  return 'sent';
}

/** Rendered text for one contact, for previews. */
export function renderWhatsApp(body: string, contact: Parameters<typeof buildMergeVars>[0], tenant: { name: string }) {
  return renderString(body, buildMergeVars(contact, tenant), { html: false });
}

/** Campaigns still waiting to send from this number — shown when the number is unlinked or blocked. */
export async function activeWhatsAppCampaigns(tenantId: string) {
  return db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.channel, 'WHATSAPP'), inArray(campaigns.status, ['SENDING', 'SCHEDULED'])));
}

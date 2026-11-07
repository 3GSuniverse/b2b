import makeWASocket, { Browsers, DisconnectReason, makeCacheableSignalKeyStore, type WASocket } from 'baileys';
import { and, eq } from 'drizzle-orm';
import { tenants, whatsappSessions } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { clearAuthState, useDbAuthState } from './auth-store.js';
import { setQr, subscribeCommands, type WhatsAppCommand } from './bus.js';
import { fromJid, toJid, WhatsAppError, type WhatsAppGateway, type WhatsAppMedia } from './gateway.js';
import type { AnyMessageContent } from 'baileys';
import { onConnected, onEnded, onIncoming, onLinkFailed, onQr, onReceipt } from './service.js';
import { extractContent, messageTime } from '../inbox/extract.js';
import { recordFromPhone, recordIncoming } from '../inbox/service.js';

const log = logger.child({ module: 'whatsapp' });

/**
 * Holds one WhatsApp Web connection per company, inside the worker process.
 * Unofficial: it links like WhatsApp Web does (Linked devices → Link a device).
 */
export class WhatsAppManager implements WhatsAppGateway {
  private sockets = new Map<string, WASocket>();
  private starting = new Set<string>();
  private stopping = new Set<string>(); // closed on purpose: don't reconnect
  private failures = new Map<string, number>(); // consecutive failed connection attempts
  private unsubscribe?: () => Promise<unknown>;

  /** Reconnect every company that was linked before the worker restarted, and listen for commands. */
  async start() {
    this.unsubscribe = await subscribeCommands((cmd) => void this.handle(cmd));
    const linked = await db
      .select({ tenantId: whatsappSessions.tenantId })
      .from(whatsappSessions)
      .innerJoin(tenants, eq(tenants.id, whatsappSessions.tenantId))
      .where(and(eq(whatsappSessions.status, 'CONNECTED'), eq(tenants.whatsappWebEnabled, true)));
    for (const { tenantId } of linked) await this.connect(tenantId);
    log.info({ sessions: linked.length }, 'whatsapp manager started');
  }

  async stop() {
    await this.unsubscribe?.();
    for (const [tenantId, sock] of this.sockets) {
      this.stopping.add(tenantId);
      sock.end(undefined);
    }
    this.sockets.clear();
  }

  private async handle(cmd: WhatsAppCommand) {
    try {
      if (cmd.action === 'connect') await this.connect(cmd.tenantId, { fresh: true });
      else await this.disconnect(cmd.tenantId);
    } catch (err) {
      log.error({ err, cmd }, 'whatsapp command failed');
    }
  }

  private async connect(tenantId: string, opts: { fresh?: boolean } = {}) {
    if (this.starting.has(tenantId)) return;
    const existing = this.sockets.get(tenantId);
    if (existing && !opts.fresh) return;
    if (existing) {
      this.stopping.add(tenantId);
      existing.end(undefined);
      this.sockets.delete(tenantId);
    }
    this.starting.add(tenantId);
    this.stopping.delete(tenantId);
    try {
      const { state, saveCreds } = await useDbAuthState(tenantId);
      const sock = makeWASocket({
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys) },
        browser: Browsers.ubuntu('Chrome'),
        logger: logger.child({ module: 'baileys' }, { level: 'warn' }) as never, // the library is chatty at info level
        markOnlineOnConnect: false, // don't mark the owner "online" on their phone all day
        syncFullHistory: false, // only the recent sync WhatsApp needs to map contacts; no old chats
      });
      this.sockets.set(tenantId, sock);
      sock.ev.on('creds.update', () => void saveCreds());

      sock.ev.on('connection.update', async (u) => {
        try {
          if (u.qr) {
            await setQr(tenantId, u.qr);
            await onQr(tenantId);
          }
          if (u.connection === 'open') {
            this.failures.delete(tenantId);
            await setQr(tenantId, null);
            const me = sock.user;
            const allowed = await onConnected(tenantId, me ? fromJid(me.id) : '', me?.name ?? me?.verifiedName ?? null);
            if (!allowed) {
              log.warn({ tenantId }, 'number already used for a trial, unlinking');
              await this.disconnect(tenantId);
              return;
            }
            log.info({ tenantId }, 'whatsapp connected');
          }
          if (u.connection === 'close') {
            this.sockets.delete(tenantId);
            const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
            if (this.stopping.has(tenantId)) return;
            if (code === DisconnectReason.loggedOut) {
              await clearAuthState(tenantId);
              await onEnded(tenantId, 'LOGGED_OUT');
            } else if (code === DisconnectReason.forbidden) {
              await clearAuthState(tenantId);
              await onEnded(tenantId, 'BLOCKED');
            } else if (code === DisconnectReason.restartRequired) {
              setTimeout(() => void this.connect(tenantId), 500); // normal right after scanning the QR
            } else {
              // Network trouble. A linked number keeps retrying, slower each time (max 5 min).
              // While linking, give up after a few tries so the page can say so.
              const n = (this.failures.get(tenantId) ?? 0) + 1;
              this.failures.set(tenantId, n);
              const paired = !!state.creds.registered || !!state.creds.me;
              if (!paired && n >= 4) {
                this.failures.delete(tenantId);
                await setQr(tenantId, null);
                await onLinkFailed(tenantId);
                log.warn({ tenantId, code }, 'whatsapp linking gave up');
                return;
              }
              const delay = Math.min(300_000, 5_000 * 2 ** (n - 1));
              log.warn({ tenantId, code, attempt: n, delay }, 'whatsapp connection closed, reconnecting');
              setTimeout(() => void this.connect(tenantId), delay);
            }
          }
        } catch (err) {
          log.error({ err, tenantId }, 'whatsapp connection update failed');
        }
      });

      // ✓✓ delivered / read
      sock.ev.on('messages.update', (updates) => {
        for (const u of updates) {
          if (u.key.fromMe && u.key.id && typeof u.update.status === 'number') void onReceipt(u.key.id, u.update.status);
        }
      });

      // Replies: "STOP" unsubscribes
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        for (const m of messages) {
          // One-to-one chats only: no groups, status updates or channels
          const jid = [m.key.remoteJid, m.key.remoteJidAlt].find((j) => j?.endsWith('@s.whatsapp.net'));
          if (!jid) continue;
          const content = extractContent(m.message);
          if (!content) continue;
          const at = messageTime(m.messageTimestamp);
          const fresh = type === 'notify' || Date.now() - at.getTime() < 10 * 60_000; // not old history
          if (!fresh) continue;
          const item = { phone: fromJid(jid), waId: m.key.id ?? null, at, ...content };
          try {
            if (m.key.fromMe) {
              await recordFromPhone(tenantId, item);
              continue;
            }
            if (type !== 'notify') continue;
            await recordIncoming(tenantId, item);
            if (content.text) {
              const reply = await onIncoming(tenantId, item.phone, content.text);
              if (reply) await sock.sendMessage(jid, { text: reply });
            }
          } catch (err) {
            log.error({ err, tenantId }, 'handling a WhatsApp message failed');
          }
        }
      });
    } finally {
      this.starting.delete(tenantId);
    }
  }

  private async disconnect(tenantId: string) {
    this.stopping.add(tenantId);
    const sock = this.sockets.get(tenantId);
    this.sockets.delete(tenantId);
    try {
      await sock?.logout();
    } catch {
      sock?.end(undefined);
    }
    await clearAuthState(tenantId);
    await setQr(tenantId, null);
  }

  private socketFor(tenantId: string) {
    const s = this.sockets.get(tenantId);
    if (!s?.user) throw new WhatsAppError('WhatsApp isn’t connected right now', false, 'not_connected');
    return s;
  }

  async exists(tenantId: string, phone: string) {
    const r = await this.socketFor(tenantId).onWhatsApp(toJid(phone));
    return !!r?.[0]?.exists;
  }

  async sendText(tenantId: string, phone: string, text: string) {
    const sent = await this.socketFor(tenantId).sendMessage(toJid(phone), { text });
    if (!sent?.key.id) throw new WhatsAppError('WhatsApp didn’t accept the message', false, 'send_failed');
    return { id: sent.key.id };
  }

  async sendMedia(tenantId: string, phone: string, m: WhatsAppMedia) {
    const content: AnyMessageContent =
      m.kind === 'image'
        ? { image: m.data, mimetype: m.mimeType, caption: m.caption }
        : m.kind === 'video'
          ? { video: m.data, mimetype: m.mimeType, caption: m.caption }
          : m.kind === 'audio'
            ? { audio: m.data, mimetype: m.mimeType }
            : { document: m.data, mimetype: m.mimeType, fileName: m.fileName, caption: m.caption };
    const sent = await this.socketFor(tenantId).sendMessage(toJid(phone), content);
    if (!sent?.key.id) throw new WhatsAppError('WhatsApp didn’t accept the file', false, 'send_failed');
    return { id: sent.key.id };
  }
}

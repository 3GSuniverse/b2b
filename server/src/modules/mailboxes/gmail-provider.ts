import { eq } from 'drizzle-orm';
import { mailboxConnections, type MailboxConnection } from '../../db/schema.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { db } from '../../lib/db.js';
import { SendError, type EmailProvider } from '../email/types.js';
import { GoogleAccessRevoked, gmailSendRaw, refreshAccessToken } from './google.js';
import { notify, today } from '../notifications/service.js';
import { buildMime } from './mime.js';

const RATE_REASONS = new Set(['dailyLimitExceeded', 'userRateLimitExceeded', 'rateLimitExceeded', 'quotaExceeded']);

async function markRevoked(connectionId: string, why: string) {
  const [c] = await db
    .update(mailboxConnections)
    .set({ status: 'REVOKED', lastError: why, accessTokenEnc: null, accessTokenExpiresAt: null })
    .where(eq(mailboxConnections.id, connectionId))
    .returning();
  if (c) {
    await notify(c.tenantId, {
      userId: c.connectedById,
      type: 'mailbox.disconnected',
      level: 'WARNING',
      title: `${c.email} was disconnected`,
      body: `${why} Emails from this address are on hold until you reconnect.`,
      link: '/settings/senders',
      dedupeKey: `mailbox.disconnected:${c.id}:${today()}`,
    });
  }
}

/** A valid access token — reuses the stored one, refreshes it when it has expired. */
async function accessToken(conn: MailboxConnection, forceRefresh = false): Promise<string> {
  if (!forceRefresh && conn.accessTokenEnc && conn.accessTokenExpiresAt && conn.accessTokenExpiresAt > new Date()) {
    return decryptSecret(conn.accessTokenEnc);
  }
  try {
    const t = await refreshAccessToken(decryptSecret(conn.refreshTokenEnc));
    await db
      .update(mailboxConnections)
      .set({
        accessTokenEnc: encryptSecret(t.accessToken),
        accessTokenExpiresAt: t.expiresAt,
        // Google may rotate the refresh token
        ...(t.refreshToken ? { refreshTokenEnc: encryptSecret(t.refreshToken) } : {}),
        lastError: null,
      })
      .where(eq(mailboxConnections.id, conn.id));
    conn.accessTokenEnc = encryptSecret(t.accessToken);
    conn.accessTokenExpiresAt = t.expiresAt;
    return t.accessToken;
  } catch (err) {
    if (err instanceof GoogleAccessRevoked) {
      await markRevoked(conn.id, 'Access was removed in the Google account. Reconnect Gmail to keep sending.');
      throw new SendError('Gmail access was removed — reconnect the mailbox', true, 'mailbox_disconnected');
    }
    throw new SendError(`Could not refresh Gmail access: ${(err as Error).message}`, false, 'gmail_token_error');
  }
}

/** Sends through the company's own Gmail mailbox, using the Gmail API. */
export function createGmailProvider(conn: MailboxConnection): EmailProvider {
  return {
    name: 'gmail',
    async send(email) {
      const raw = buildMime(email);
      let token = await accessToken(conn);
      let res = await gmailSendRaw(token, raw);

      // Access token can expire between our check and Google's — refresh once and retry
      if (res.status === 401) {
        token = await accessToken(conn, true);
        res = await gmailSendRaw(token, raw);
      }

      if (res.ok && res.id) return { providerMessageId: `gmail:${res.id}` };

      const detail = `${res.status}${res.reason ? ` ${res.reason}` : ''}: ${res.message ?? 'Gmail send failed'}`;
      if (res.status === 429 || res.status >= 500 || (res.status === 403 && RATE_REASONS.has(res.reason ?? ''))) {
        throw new SendError(detail, false, 'gmail_rate_limited');
      }
      if (res.status === 401 || res.status === 403) {
        await markRevoked(conn.id, `Gmail refused to send (${detail}). Reconnect the mailbox.`);
        throw new SendError(detail, true, 'mailbox_disconnected');
      }
      throw new SendError(detail, true, 'gmail_rejected');
    },
  };
}

export type MailboxProviderFactory = (conn: MailboxConnection) => EmailProvider;

let factory: MailboxProviderFactory = (conn) => {
  if (conn.provider === 'GOOGLE') return createGmailProvider(conn);
  throw new SendError('Outlook sending is not available yet', true, 'provider_unavailable');
};
export function getMailboxProviderFactory(): MailboxProviderFactory {
  return factory;
}
export function setMailboxProviderFactory(f: MailboxProviderFactory) {
  factory = f;
}

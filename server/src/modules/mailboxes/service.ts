import { and, asc, count, eq, gt, inArray, min } from 'drizzle-orm';
import { campaigns, mailboxConnections, messages, senders, tenants } from '../../db/schema.js';
import { decryptSecret, encryptSecret, signToken, verifyToken } from '../../lib/crypto.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { seesAll, type Viewer } from '../auth/guard.js';
import { exchangeCode, GMAIL_SEND_SCOPE, revokeToken } from './google.js';

const STATE_PURPOSE = 'gmail-oauth';
const STATE_TTL_MS = 10 * 60_000;

interface OAuthState {
  t: string; // tenant
  u: string; // user
  n: string; // nonce, must match the PKCE cookie
  e: number; // expiry
}

export function createOAuthState(tenantId: string, userId: string, nonce: string) {
  return signToken({ t: tenantId, u: userId, n: nonce, e: Date.now() + STATE_TTL_MS } satisfies OAuthState, STATE_PURPOSE);
}

export function readOAuthState(state: string): OAuthState | null {
  const s = verifyToken<OAuthState>(state, STATE_PURPOSE);
  if (!s || s.e < Date.now()) return null;
  return s;
}

const FREE_GMAIL = new Set(['gmail.com', 'googlemail.com']);

/** Personal Gmail ≈ 500/day, Workspace ≈ 2000/day. We keep a safety margin under both. */
export function dailyLimitFor(email: string) {
  return FREE_GMAIL.has(email.split('@')[1] ?? '') ? 400 : 1500;
}

/**
 * Finishes "Connect Gmail": swaps the code for tokens, checks the user really granted
 * send permission, stores the tokens encrypted and creates (or revives) the sender.
 */
export async function completeGoogleConnect(input: { tenantId: string; userId: string; code: string; verifier: string }) {
  const tokens = await exchangeCode(input.code, input.verifier);

  if (!tokens.scopes.includes(GMAIL_SEND_SCOPE)) {
    // Google lets users untick permissions on the consent screen
    throw new AppError(400, 'send_permission_missing', 'Gmail was connected without permission to send. Please try again and allow sending.');
  }
  if (!tokens.email || tokens.emailVerified === false) {
    throw new AppError(400, 'email_unverified', 'Google didn’t confirm this account’s email address.');
  }
  if (!tokens.refreshToken) {
    throw new AppError(400, 'no_refresh_token', 'Google didn’t grant lasting access. Please try connecting again.');
  }

  const email = tokens.email.toLowerCase();
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, input.tenantId) });
  if (!tenant) throw new AppError(404, 'tenant_not_found', 'Account not found');

  return db.transaction(async (tx) => {
    const values = {
      refreshTokenEnc: encryptSecret(tokens.refreshToken!),
      accessTokenEnc: encryptSecret(tokens.accessToken),
      accessTokenExpiresAt: tokens.expiresAt,
      scopes: tokens.scopes.join(' '),
      displayName: tokens.name ?? null,
      status: 'ACTIVE' as const,
      lastError: null,
      connectedById: input.userId,
    };
    const [conn] = await tx
      .insert(mailboxConnections)
      .values({ tenantId: input.tenantId, provider: 'GOOGLE', email, dailyLimit: dailyLimitFor(email), ...values })
      .onConflictDoUpdate({
        target: [mailboxConnections.tenantId, mailboxConnections.provider, mailboxConnections.email],
        set: values,
      })
      .returning();

    const existing = await tx.query.senders.findFirst({
      where: and(eq(senders.tenantId, input.tenantId), eq(senders.fromEmail, email)),
    });
    if (existing && existing.kind === 'DOMAIN') {
      throw new AppError(409, 'sender_exists', `${email} is already set up as a domain sender.`);
    }
    if (!existing) {
      const hasAny = await tx.query.senders.findFirst({ where: eq(senders.tenantId, input.tenantId), columns: { id: true } });
      await tx.insert(senders).values({
        tenantId: input.tenantId,
        kind: 'GMAIL',
        connectionId: conn!.id,
        fromName: tokens.name ?? tenant.name,
        fromEmail: email,
        isDefault: !hasAny,
      });
    } else if (existing.connectionId !== conn!.id) {
      await tx.update(senders).set({ connectionId: conn!.id }).where(eq(senders.id, existing.id));
    }
    return { connectionId: conn!.id, email };
  });
}

export function connectionDto(c: typeof mailboxConnections.$inferSelect, sentLast24h: number) {
  return {
    id: c.id,
    provider: c.provider,
    email: c.email,
    displayName: c.displayName,
    status: c.status,
    lastError: c.lastError,
    dailyLimit: c.dailyLimit,
    sentLast24h,
    createdAt: c.createdAt,
  };
}

/** Emails a sender has sent in the last 24 hours, and when the oldest of them leaves the window. */
export async function senderUsageLast24h(senderId: string, now = new Date()) {
  const since = new Date(now.getTime() - 86_400_000);
  const [row] = await db
    .select({ n: count(), oldest: min(messages.sentAt) })
    .from(messages)
    .where(and(eq(messages.senderId, senderId), gt(messages.sentAt, since)));
  return { sent: row?.n ?? 0, oldest: row?.oldest ?? null };
}

export async function listMailboxes(v: Viewer) {
  const rows = await db.query.mailboxConnections.findMany({
    where: and(eq(mailboxConnections.tenantId, v.tenantId), seesAll(v) ? undefined : eq(mailboxConnections.connectedById, v.userId)),
    with: { senders: { columns: { id: true } }, connectedBy: { columns: { name: true } } },
    orderBy: [asc(mailboxConnections.createdAt)],
  });
  return Promise.all(
    rows.map(async (c) => {
      const used = c.senders[0] ? (await senderUsageLast24h(c.senders[0].id)).sent : 0;
      return { ...connectionDto(c, used), connectedById: c.connectedById, connectedBy: c.connectedBy?.name ?? null };
    }),
  );
}

export async function disconnectMailbox(v: Viewer, id: string) {
  const c = await db.query.mailboxConnections.findFirst({
    where: and(eq(mailboxConnections.id, id), eq(mailboxConnections.tenantId, v.tenantId)),
    with: { senders: { columns: { id: true } } },
  });
  if (!c || (!seesAll(v) && c.connectedById !== v.userId)) throw new AppError(404, 'mailbox_not_found', 'Mailbox not found');

  const senderIds = c.senders.map((s) => s.id);
  if (senderIds.length) {
    const busy = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(inArray(campaigns.senderId, senderIds), inArray(campaigns.status, ['SCHEDULED', 'SENDING'])))
      .limit(1);
    if (busy.length) throw new AppError(409, 'mailbox_in_use', 'A scheduled or sending campaign uses this mailbox. Cancel it first.');
  }

  // Tell Google to drop our access too, not just forget it ourselves
  try {
    await revokeToken(decryptSecret(c.refreshTokenEnc));
  } catch {
    /* already invalid — fine */
  }
  await db.delete(mailboxConnections).where(eq(mailboxConnections.id, c.id)); // cascades to its sender
}

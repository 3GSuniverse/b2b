import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';

// Unsubscribe links carry the message id plus an HMAC, so nobody can
// unsubscribe someone else by guessing ids. No database lookup needed to verify.

function sign(messageId: string): string {
  return createHmac('sha256', env.APP_SECRET).update(`unsub:${messageId}`).digest('base64url').slice(0, 22);
}

export function createUnsubscribeToken(messageId: string): string {
  return `${messageId}.${sign(messageId)}`;
}

/** Returns the message id, or null if the token was tampered with. */
export function verifyUnsubscribeToken(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const messageId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(messageId));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return messageId;
}

export function unsubscribeUrl(messageId: string): string {
  return `${env.PUBLIC_URL.replace(/\/$/, '')}/u/${createUnsubscribeToken(messageId)}`;
}

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

// Secrets we must store (mailbox refresh tokens) are encrypted with AES-256-GCM.
// GCM also detects tampering: a modified ciphertext fails to decrypt instead of decrypting to garbage.

let key: Buffer | undefined;
function encryptionKey(): Buffer {
  if (!key) {
    if (env.TOKEN_ENCRYPTION_KEY) {
      key = Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64');
      if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
    } else {
      key = Buffer.from(hkdfSync('sha256', env.APP_SECRET, 'sandesh', 'token-encryption-v1', 32));
    }
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, ct] = stored.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognised encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

/** Short-lived signed tokens (OAuth state). payload is JSON, never secret — only tamper-proof. */
export function signToken(payload: object, purpose: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', env.APP_SECRET).update(`${purpose}.${body}`).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken<T>(token: string, purpose: string): T | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', env.APP_SECRET).update(`${purpose}.${body}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

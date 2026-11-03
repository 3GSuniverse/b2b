import { createVerify } from 'node:crypto';

// Amazon SNS signs every message. Anyone can POST to our webhook URL,
// so nothing is trusted until its signature checks out against AWS's certificate.

export interface SnsMessage {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation';
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: '1' | '2';
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
}

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

/** Only AWS SNS hosts, only https — stops an attacker pointing us at their own certificate. */
export function isAwsSnsUrl(raw: string | undefined, kind: 'cert' | 'subscribe'): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || !SNS_HOST.test(u.hostname)) return false;
    return kind === 'cert' ? u.pathname.endsWith('.pem') : true;
  } catch {
    return false;
  }
}

export function stringToSign(m: SnsMessage): string {
  const keys =
    m.Type === 'Notification'
      ? (['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'] as const)
      : (['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'] as const);
  let out = '';
  for (const k of keys) {
    const v = m[k];
    if (v === undefined) continue; // Subject is optional
    out += `${k}\n${v}\n`;
  }
  return out;
}

export type CertFetcher = (url: string) => Promise<string>;

const certCache = new Map<string, string>();

export const fetchCert: CertFetcher = async (url) => {
  const cached = certCache.get(url);
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download SNS certificate (${res.status})`);
  const pem = await res.text();
  certCache.set(url, pem);
  return pem;
};

export function isSnsMessage(body: unknown): body is SnsMessage {
  const b = body as Partial<SnsMessage> | null;
  return !!b && typeof b.Type === 'string' && typeof b.Signature === 'string' && typeof b.MessageId === 'string';
}

export async function verifySnsMessage(
  m: SnsMessage,
  opts: { fetch?: CertFetcher; topicArn?: string } = {},
): Promise<boolean> {
  if (opts.topicArn && m.TopicArn !== opts.topicArn) return false;
  if (!isAwsSnsUrl(m.SigningCertURL, 'cert')) return false;
  const algorithm = m.SignatureVersion === '2' ? 'RSA-SHA256' : m.SignatureVersion === '1' ? 'RSA-SHA1' : null;
  if (!algorithm) return false;
  const cert = await (opts.fetch ?? fetchCert)(m.SigningCertURL);
  const verifier = createVerify(algorithm);
  verifier.update(stringToSign(m), 'utf8');
  try {
    return verifier.verify(cert, m.Signature, 'base64');
  } catch {
    return false;
  }
}

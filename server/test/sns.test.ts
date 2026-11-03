import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isAwsSnsUrl, stringToSign, verifySnsMessage, type SnsMessage } from '../src/modules/webhooks/sns.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const CERT_URL = 'https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-abc.pem';

function signed(m: Omit<SnsMessage, 'Signature'>, algo = 'RSA-SHA256'): SnsMessage {
  const s = createSign(algo);
  s.update(stringToSign({ ...m, Signature: '' } as SnsMessage));
  return { ...m, Signature: s.sign(privateKey, 'base64') } as SnsMessage;
}

const base = {
  Type: 'Notification' as const,
  MessageId: 'sns-1',
  TopicArn: 'arn:aws:sns:ap-south-1:123:ses-events',
  Message: '{"eventType":"Delivery"}',
  Timestamp: '2026-11-03T10:00:00.000Z',
  SignatureVersion: '2' as const,
  SigningCertURL: CERT_URL,
};

const fetchCert = async () => publicPem;

describe('SNS signature verification', () => {
  it('accepts a correctly signed message (v2 and v1)', async () => {
    expect(await verifySnsMessage(signed(base), { fetch: fetchCert })).toBe(true);
    expect(await verifySnsMessage(signed({ ...base, SignatureVersion: '1' }, 'RSA-SHA1'), { fetch: fetchCert })).toBe(true);
  });

  it('rejects a modified message', async () => {
    const m = signed(base);
    expect(await verifySnsMessage({ ...m, Message: '{"eventType":"Bounce"}' }, { fetch: fetchCert })).toBe(false);
  });

  it('rejects certificates not hosted by AWS', async () => {
    const m = signed({ ...base, SigningCertURL: 'https://evil.example.com/cert.pem' });
    expect(await verifySnsMessage(m, { fetch: fetchCert })).toBe(false);
    expect(isAwsSnsUrl('http://sns.ap-south-1.amazonaws.com/x.pem', 'cert')).toBe(false);
    expect(isAwsSnsUrl('https://sns.ap-south-1.amazonaws.com.evil.com/x.pem', 'cert')).toBe(false);
  });

  it('rejects other topics when a topic is pinned', async () => {
    expect(await verifySnsMessage(signed(base), { fetch: fetchCert, topicArn: 'arn:aws:sns:ap-south-1:123:other' })).toBe(false);
  });
});

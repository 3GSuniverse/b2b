import { randomBytes } from 'node:crypto';
import { formatAddress } from '../email/ses-provider.js';
import type { OutgoingEmail } from '../email/types.js';

// Builds a standards-compliant email (RFC 5322 + MIME) for APIs that take raw messages, like Gmail's.

const CRLF = '\r\n';

function clean(v: string) {
  return v.replace(/[\r\n]+/g, ' ').trim(); // header injection guard
}

/** RFC 2047 encoded-word for non-ASCII header text (Telugu, Hindi, emoji…). */
export function encodeHeader(v: string): string {
  const s = clean(v);
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  // Split on character boundaries so no multi-byte character is cut in half
  const words: string[] = [];
  let chunk = '';
  for (const ch of s) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join(`${CRLF} `);
}

function base64Body(text: string) {
  return (Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/g) ?? ['']).join(CRLF);
}

export function buildMime(email: OutgoingEmail, now = new Date()): string {
  const fromDomain = email.from.email.split('@')[1] ?? 'localhost';
  const boundary = `b_${randomBytes(12).toString('hex')}`;
  const headers: [string, string][] = [
    ['From', formatAddress(clean(email.from.name), clean(email.from.email))],
    ['To', clean(email.to)],
    ...(email.replyTo ? ([['Reply-To', clean(email.replyTo)]] as [string, string][]) : []),
    ['Subject', encodeHeader(email.subject)],
    ['Date', now.toUTCString().replace('GMT', '+0000')],
    ['Message-ID', `<${randomBytes(16).toString('hex')}@${fromDomain}>`],
    ['MIME-Version', '1.0'],
  ];
  for (const [name, value] of Object.entries(email.headers)) {
    if (/^[A-Za-z0-9-]+$/.test(name)) headers.push([name, clean(value)]);
  }
  headers.push(['Content-Type', `multipart/alternative; boundary="${boundary}"`]);

  return [
    ...headers.map(([k, v]) => `${k}: ${v}`),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(email.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(email.html),
    `--${boundary}--`,
    '',
  ].join(CRLF);
}

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { SendError, type EmailProvider, type OutgoingEmail } from './types.js';

const TRANSIENT_CODES = new Set([
  'ThrottlingException',
  'TooManyRequestsException',
  'LimitExceededException',
  'InternalFailure',
  'InternalServerError',
  'ServiceUnavailable',
  'ServiceUnavailableException',
  'RequestTimeout',
  'TimeoutError',
]);

/** RFC 2047-encode display names that are not plain ASCII (e.g. Telugu or Hindi names). */
export function formatAddress(name: string, email: string): string {
  const clean = name.replace(/["\\\r\n]/g, '').trim();
  if (!clean) return email;
  if (/^[\x20-\x7e]*$/.test(clean)) return `"${clean}" <${email}>`;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?= <${email}>`;
}

/** SES tag values allow only letters, digits, _ - . @ */
function tagValue(v: string): string {
  return v.replace(/[^A-Za-z0-9_\-.@]/g, '_').slice(0, 256) || '_';
}

export function classifySesError(err: unknown): SendError {
  if (err instanceof SendError) return err;
  const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const code = e?.name ?? 'UnknownError';
  const status = e?.$metadata?.httpStatusCode;
  // No HTTP status at all = network problem → retry
  const transient = TRANSIENT_CODES.has(code) || status === undefined || status >= 500;
  return new SendError(e?.message ?? String(err), !transient, code);
}

export function createSesProvider(opts: {
  region: string;
  configurationSet?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}): EmailProvider {
  const client = new SESv2Client({ region: opts.region, credentials: opts.credentials });

  return {
    name: 'ses',
    async send(email: OutgoingEmail) {
      try {
        const out = await client.send(
          new SendEmailCommand({
            FromEmailAddress: formatAddress(email.from.name, email.from.email),
            Destination: { ToAddresses: [email.to] },
            ReplyToAddresses: email.replyTo ? [email.replyTo] : undefined,
            ConfigurationSetName: opts.configurationSet,
            EmailTags: Object.entries(email.tags).map(([Name, Value]) => ({
              Name,
              Value: tagValue(Value),
            })),
            Content: {
              Simple: {
                Subject: { Data: email.subject, Charset: 'UTF-8' },
                Body: {
                  Html: { Data: email.html, Charset: 'UTF-8' },
                  Text: { Data: email.text, Charset: 'UTF-8' },
                },
                Headers: Object.entries(email.headers).map(([Name, Value]) => ({ Name, Value })),
              },
            },
          }),
        );
        if (!out.MessageId) throw new SendError('SES returned no MessageId', false, 'NoMessageId');
        return { providerMessageId: out.MessageId };
      } catch (err) {
        throw classifySesError(err);
      }
    },
  };
}

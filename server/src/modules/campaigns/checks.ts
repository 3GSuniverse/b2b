import { and, count, eq, sql, type SQL } from 'drizzle-orm';
import { contacts, customFields, type Audience } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { emailAudienceWhere } from '../audience/resolve.js';
import { isDomainReady } from '../domains/service.js';
import { CORE_KEYS, findUnknownTags } from '../email/render.js';
import { senderUsageLast24h } from '../mailboxes/service.js';
import { monthlyUsage } from '../sending/start-campaign.js';

export type CheckLevel = 'ok' | 'warning' | 'error';
export interface Check {
  id: string;
  level: CheckLevel;
  title: string;
  note?: string;
}

interface CheckInput {
  tenantId: string;
  tenant: { monthlyQuota: number; status: string; pausedReason: string | null; timezone: string };
  subject: string | null;
  html: string | null;
  previewText: string | null;
  audience: Audience | null;
  sender:
    | {
        id: string;
        kind: 'DOMAIN' | 'GMAIL' | 'OUTLOOK';
        fromEmail: string;
        domain: { domain: string; ownershipStatus: string; identityStatus: string; dkimStatus: string } | null;
        connection: { status: string; dailyLimit: number } | null;
      }
    | null;
}

// Merge tags used without a fallback, mapped to "how do we know it's empty"
const TAG = /\{\s*([a-zA-Z_]\w*)\s*(\|[^{}]*)?\}/g;
function tagsWithoutFallback(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(TAG)) if (!m[2] && m[1] !== 'unsubscribe_url') out.add(m[1]!);
  return [...out];
}

function emptyExpr(key: string): SQL | null {
  if (key === 'first_name') return sql`coalesce(${contacts.firstName}, '') = ''`;
  if (key === 'last_name') return sql`coalesce(${contacts.lastName}, '') = ''`;
  if (key === 'full_name') return sql`coalesce(${contacts.firstName}, '') = '' and coalesce(${contacts.lastName}, '') = ''`;
  if (key === 'phone') return sql`${contacts.phone} is null`;
  if (['email', 'company_name'].includes(key)) return null; // always filled
  return sql`coalesce(${contacts.attributes} ->> ${key}, '') = ''`;
}

// Starter designs mark what to replace with [CAPS IN BRACKETS]; sending one by mistake is embarrassing
export const PLACEHOLDER = /\[[A-Z][A-Z0-9 ]{2,}[^\]\n<>]{0,150}\]/g;

/**
 * The "Ready-to-send checks" panel. Errors block sending; warnings are advice.
 */
export async function campaignChecks(input: CheckInput): Promise<{ checks: Check[]; canSend: boolean; recipients: number }> {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  // Account
  if (input.tenant.status !== 'ACTIVE') {
    add({ id: 'account', level: 'error', title: 'Sending is paused for your account.', note: input.tenant.pausedReason ?? undefined });
  }

  // Sender
  const s = input.sender;
  if (!s) add({ id: 'sender', level: 'error', title: 'Choose who the email is from.' });
  else if (s.kind === 'DOMAIN' && !(s.domain && isDomainReady(s.domain as Parameters<typeof isDomainReady>[0]))) {
    add({ id: 'sender', level: 'error', title: `${s.domain?.domain ?? 'The domain'} isn’t verified yet.`, note: 'Finish the DNS setup in Settings → Domains.' });
  } else if (s.kind !== 'DOMAIN' && s.connection?.status !== 'ACTIVE') {
    add({ id: 'sender', level: 'error', title: `${s.fromEmail} is disconnected.`, note: 'Reconnect it in Settings → Senders.' });
  } else add({ id: 'sender', level: 'ok', title: `Sending from ${s.fromEmail}.` });

  // Content
  const subject = input.subject?.trim() ?? '';
  const html = input.html?.trim() ?? '';
  if (!subject) add({ id: 'subject', level: 'error', title: 'Add a subject line.' });
  else if (subject.length > 78) add({ id: 'subject', level: 'warning', title: 'The subject line is long.', note: `${subject.length} characters — phones show about 40–60.` });
  else add({ id: 'subject', level: 'ok', title: 'Subject length is good.', note: `${subject.length} characters fits most phone screens.` });
  if (!html) add({ id: 'content', level: 'error', title: 'The email has no content yet.' });

  add({ id: 'unsubscribe', level: 'ok', title: 'Unsubscribe link added.', note: 'Required by Gmail and Yahoo — added to every email automatically.' });

  const all = `${subject}\n${input.previewText ?? ''}\n${html}`;
  const placeholders = [...new Set(all.match(PLACEHOLDER) ?? [])];
  if (placeholders.length) {
    add({
      id: 'placeholders',
      level: 'error',
      title: `${placeholders.length} placeholder${placeholders.length > 1 ? 's' : ''} still in the email.`,
      note: `Replace ${placeholders.map((p) => (p.length > 40 ? p.slice(0, 38) + '…]' : p)).join(', ')} before sending.`,
    });
  }

  const fields = await db.select({ key: customFields.key }).from(customFields).where(eq(customFields.tenantId, input.tenantId));
  const known = [...CORE_KEYS, ...fields.map((f) => f.key)];
  const unknown = findUnknownTags(all, known);
  if (unknown.length) {
    add({
      id: 'unknown_tags',
      level: 'error',
      title: `${unknown.map((u) => `{${u}}`).join(', ')} ${unknown.length > 1 ? 'aren’t fields' : 'isn’t a field'} you have.`,
      note: 'Fix the spelling, or add a fallback like {city|your city}.',
    });
  }

  // Audience
  const where = emailAudienceWhere(input.tenantId, input.audience);
  const [{ n: recipients } = { n: 0 }] = await db.select({ n: count() }).from(contacts).where(where);
  if (!recipients) add({ id: 'audience', level: 'error', title: 'Nobody matches this audience.', note: 'Choose a list or loosen the filters.' });
  else add({ id: 'audience', level: 'ok', title: `${recipients.toLocaleString('en-IN')} recipient${recipients > 1 ? 's' : ''}.`, note: 'Unsubscribed and bounced contacts are left out automatically.' });

  // Missing personalisation
  if (recipients) {
    for (const key of tagsWithoutFallback(all).slice(0, 5)) {
      if (!known.includes(key)) continue;
      const empty = emptyExpr(key);
      if (!empty) continue;
      const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(contacts).where(and(where, empty));
      if (n > 0) {
        add({
          id: `fallback_${key}`,
          level: 'warning',
          title: `${n.toLocaleString('en-IN')} contact${n > 1 ? 's have' : ' has'} no ${key.replace(/_/g, ' ')}.`,
          note: `They’ll see a blank. Add a fallback, like {${key}|there}.`,
        });
      } else {
        add({ id: `fallback_${key}`, level: 'ok', title: `Everyone has a ${key.replace(/_/g, ' ')}.` });
      }
    }
  }

  // Limits
  if (recipients) {
    const used = await monthlyUsage(input.tenantId, new Date(), input.tenant.timezone);
    const left = Math.max(0, input.tenant.monthlyQuota - used);
    if (recipients > left) {
      add({ id: 'quota', level: 'error', title: 'Not enough emails left this month.', note: `This needs ${recipients.toLocaleString('en-IN')}; ${left.toLocaleString('en-IN')} are left.` });
    }
    if (s && s.kind !== 'DOMAIN' && s.connection) {
      const usage = await senderUsageLast24h(s.id);
      const today = Math.max(0, s.connection.dailyLimit - usage.sent);
      if (recipients > today) {
        const days = Math.ceil((recipients - today) / s.connection.dailyLimit) + 1;
        add({
          id: 'mailbox_limit',
          level: 'warning',
          title: `This will take about ${days} days to send.`,
          note: `${s.fromEmail} can send ${s.connection.dailyLimit} a day. Use your own domain to send everything at once.`,
        });
      }
    }
  }

  return { checks, canSend: !checks.some((c) => c.level === 'error'), recipients };
}

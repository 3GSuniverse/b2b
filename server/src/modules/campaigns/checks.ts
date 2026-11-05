import { and, count, eq, sql, type SQL } from 'drizzle-orm';
import { contacts, customFields, type Audience, type AttachmentRef } from '../../db/schema.js';
import { LIMITS, totalSize } from '../attachments/service.js';
import { db } from '../../lib/db.js';
import { emailAudienceWhere } from '../audience/resolve.js';
import { isDomainReady } from '../domains/service.js';
import { CORE_KEYS, findUnknownTags } from '../email/render.js';
import { senderUsageLast24h } from '../mailboxes/service.js';
import { monthlyUsage } from '../sending/start-campaign.js';
import { trialEnded, whatsappTrialCapacity, whatsappWebAllowed } from '../plans/entitlements.js';

export type CheckLevel = 'ok' | 'warning' | 'error';
export interface Check {
  id: string;
  level: CheckLevel;
  title: string;
  note?: string;
}

interface CheckInput {
  tenantId: string;
  tenant: { monthlyQuota: number; status: string; pausedReason: string | null; timezone: string; postalAddress?: string | null; plan?: 'TRIAL' | 'PAID'; trialEndsAt?: Date | null; whatsappWebEnabled?: boolean };
  subject: string | null;
  html: string | null;
  previewText: string | null;
  audience: Audience | null;
  attachments?: AttachmentRef[];
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
  if (input.tenant.plan && trialEnded({ plan: input.tenant.plan, trialEndsAt: input.tenant.trialEndsAt ?? null, whatsappWebEnabled: false })) {
    add({ id: 'trial', level: 'error', title: 'Your free trial has ended.', note: 'Upgrade to keep sending. Your contacts and designs are safe.' });
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
  if (!input.tenant.postalAddress?.trim()) {
    add({ id: 'address', level: 'warning', title: 'Add your office address.', note: 'It goes in the footer of every email. Anti-spam rules expect it. Settings → Company.' });
  }

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

  attachmentCheck(input.attachments ?? [], 'EMAIL', add);

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

/** "Before you send" for WhatsApp campaigns. */
export async function whatsappChecks(input: {
  tenantId: string;
  tenant: { id: string; status: string; pausedReason: string | null; whatsappWebEnabled: boolean; plan: 'TRIAL' | 'PAID'; trialEndsAt: Date | null };
  text: string | null;
  audience: Audience | null;
  attachments?: AttachmentRef[];
}): Promise<{ checks: Check[]; canSend: boolean; recipients: number }> {
  const { countWhatsAppAudience } = await import('../audience/resolve.js');
  const { getSession, whatsappUsageLast24h, WHATSAPP_MAX_LENGTH } = await import('../whatsapp/service.js');
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  if (input.tenant.status !== 'ACTIVE') add({ id: 'account', level: 'error', title: 'Sending is paused for your account.', note: input.tenant.pausedReason ?? undefined });
  if (trialEnded(input.tenant)) add({ id: 'trial', level: 'error', title: 'Your free trial has ended.', note: 'Upgrade to keep sending. Your contacts and messages are safe.' });
  else if (!whatsappWebAllowed(input.tenant)) add({ id: 'feature', level: 'error', title: 'WhatsApp sending isn’t available on this account.' });
  const cap = await whatsappTrialCapacity(input.tenant);

  const session = await getSession(input.tenantId);
  if (session.status === 'CONNECTED') add({ id: 'sender', level: 'ok', title: `Sending from ${session.phone ?? 'your WhatsApp'}.` });
  else add({ id: 'sender', level: 'error', title: 'Link your WhatsApp number first.', note: 'Settings → WhatsApp, then scan the QR code with your phone.' });

  const text = input.text?.trim() ?? '';
  const files = input.attachments ?? [];
  if (!text && !files.length) add({ id: 'content', level: 'error', title: 'Write the message, or attach a file.' });
  else if (text.length > WHATSAPP_MAX_LENGTH) add({ id: 'content', level: 'error', title: 'The message is too long for WhatsApp.', note: `${text.length} of ${WHATSAPP_MAX_LENGTH} characters.` });

  const placeholders = [...new Set(text.match(PLACEHOLDER) ?? [])];
  if (placeholders.length) add({ id: 'placeholders', level: 'error', title: `${placeholders.length} placeholder${placeholders.length > 1 ? 's' : ''} still in the message.`, note: `Replace ${placeholders.join(', ')} before sending.` });

  const fields = await db.select({ key: customFields.key }).from(customFields).where(eq(customFields.tenantId, input.tenantId));
  const unknown = findUnknownTags(text, [...CORE_KEYS, ...fields.map((f) => f.key)]);
  if (unknown.length) add({ id: 'unknown_tags', level: 'error', title: `${unknown.map((u) => `{${u}}`).join(', ')} ${unknown.length > 1 ? 'aren’t fields' : 'isn’t a field'} you have.`, note: 'Fix the spelling, or add a fallback like {first_name|there}.' });
  attachmentCheck(files, 'WHATSAPP', add);
  add({ id: 'stop', level: 'ok', title: 'People can reply STOP to stop messages.', note: 'They’re unsubscribed from WhatsApp automatically.' });

  const recipients = await countWhatsAppAudience(db, input.tenantId, input.audience);
  if (!recipients) add({ id: 'audience', level: 'error', title: 'Nobody in this audience agreed to WhatsApp messages.', note: 'Only contacts marked “Agreed to WhatsApp” with a phone number get WhatsApp campaigns.' });
  else {
    add({ id: 'audience', level: 'ok', title: `${recipients.toLocaleString('en-IN')} recipient${recipients > 1 ? 's' : ''}.`, note: 'Only contacts who agreed to WhatsApp messages.' });
    if (cap !== null) {
      if (recipients > cap.beforeTrialEnds) {
        add({ id: 'trial_limit', level: 'error', title: `Too many for the rest of your trial.`, note: `The trial sends up to ${cap.perDay} WhatsApp messages a day, so ${cap.beforeTrialEnds} more fit before it ends. This campaign needs ${recipients.toLocaleString('en-IN')}. Choose a smaller list, or upgrade.` });
      } else {
        add({ id: 'trial_limit', level: 'ok', title: `Trial: up to ${cap.perDay} WhatsApp messages a day.`, note: recipients > cap.leftToday ? `${cap.leftToday} go out today; the rest continue tomorrow.` : `${cap.leftToday} left today.` });
      }
    }
    const usage = await whatsappUsageLast24h(input.tenantId);
    const dailyLimit = Math.min(session.dailyLimit, cap?.perDay ?? Infinity);
    const today = Math.max(0, dailyLimit - usage.sent);
    const minutes = Math.ceil((Math.min(recipients, today) * session.intervalSeconds) / 60);
    if (recipients > today) {
      const days = Math.ceil((recipients - today) / dailyLimit) + 1;
      add({ id: 'daily_limit', level: 'warning', title: `This will take about ${days} days to send.`, note: `Your number sends up to ${dailyLimit} a day, one every ${session.intervalSeconds} seconds, to lower the risk of a ban.` });
    } else {
      add({ id: 'pace', level: 'ok', title: `Takes about ${minutes < 60 ? `${Math.max(1, minutes)} min` : `${Math.round(minutes / 6) / 10} hours`} to send.`, note: `One message every ${session.intervalSeconds} seconds.` });
    }
  }
  add({ id: 'risk', level: 'warning', title: 'Unofficial WhatsApp sending.', note: 'WhatsApp can block numbers that send in bulk this way. Send only to people who expect your messages.' });

  return { checks, canSend: !checks.some((c) => c.level === 'error'), recipients };
}

const mb = (bytes: number) => `${Math.max(0.1, Math.round((bytes / 1048576) * 10) / 10)} MB`;

/** Attached files: within what the channel can carry? */
export function attachmentCheck(files: AttachmentRef[], channel: 'EMAIL' | 'WHATSAPP', add: (c: Check) => void) {
  if (!files.length) return;
  const total = totalSize(files);
  const what = `${files.length} file${files.length > 1 ? 's' : ''} attached`;
  if (channel === 'EMAIL' && total > LIMITS.emailTotalBytes) {
    add({ id: 'attachments', level: 'error', title: `The attachments are too large for email (${mb(total)}).`, note: `Most inboxes refuse emails over ${mb(LIMITS.emailTotalBytes)} of files. Remove some, or share a link instead.` });
  } else if (channel === 'WHATSAPP') {
    add({ id: 'attachments', level: 'ok', title: `${what} (${mb(total)}).`, note: files.length === 1 ? 'Sent with your message as its caption.' : 'Your message goes first, then each file.' });
  } else {
    add({ id: 'attachments', level: total > 8 * 1048576 ? 'warning' : 'ok', title: `${what} (${mb(total)}).`, note: total > 8 * 1048576 ? 'Large emails send more slowly and some phones won’t download them on mobile data.' : undefined });
  }
}

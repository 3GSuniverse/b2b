import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { campaigns, contacts, lists, messageEvents, messages, senders, templates, trackedLinks, type Audience } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { senderFor } from '../senders/service.js';
import { AppError } from '../../lib/http.js';
import type { EnqueueFn } from '../../queues/index.js';
import { tenants } from '../../db/schema.js';
import { emailAudienceWhere, whatsappAudienceWhere } from '../audience/resolve.js';
import { normalizePhone } from '../contacts/normalize.js';
import { pickSession, renderWhatsApp } from '../whatsapp/service.js';
import { enqueueWhatsAppTest } from '../../queues/index.js';
import { getEmailProvider, SendError } from '../email/index.js';
import { buildMergeVars, renderEmail } from '../email/render.js';
import { getMailboxProviderFactory } from '../mailboxes/gmail-provider.js';
import { CampaignError, startCampaign } from '../sending/start-campaign.js';
import { campaignChecks, whatsappChecks } from './checks.js';
import { trialEnded, whatsappWebAllowed } from '../plans/entitlements.js';
import { attachmentIds, loadFiles, resolveRefs } from '../attachments/service.js';

// ---------------------------------------------------------------------
//  Validation
// ---------------------------------------------------------------------

const filterSchema = z.object({
  field: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/, 'Unknown field'),
  op: z.enum(['eq', 'neq', 'contains', 'exists']),
  value: z.string().max(200).optional(),
});

export const audienceSchema = z.object({
  mode: z.enum(['everyone', 'lists', 'people', 'temporary']).optional(),
  addresses: z.array(z.string().max(320)).max(5000, 'A temporary list can have up to 5,000 people. Split it into two broadcasts.').optional(),
  consent: z.boolean().optional(),
  addressCount: z.number().int().nonnegative().optional(),
  listIds: z.array(z.string()).max(50).optional(),
  contactIds: z.array(z.string()).max(10_000).optional(),
  filters: z.array(filterSchema).max(10).optional(),
});

export const campaignBody = z.object({
  name: z.string().trim().min(1, 'Give the campaign a name').max(120),
  channel: z.enum(['EMAIL', 'WHATSAPP']).optional(), // set when creating; ignored on edits
  senderId: z.string().nullable().optional(),
  templateId: z.string().nullable().optional(),
  subject: z.string().trim().max(200).nullable().optional(),
  previewText: z.string().trim().max(200).nullable().optional(),
  html: z.string().max(500_000, 'The email is too large').nullable().optional(),
  text: z.string().max(200_000).nullable().optional(),
  audience: audienceSchema.nullable().optional(),
  attachments: attachmentIds.optional(), // ids of uploaded files, in order
});

const EDITABLE = ['DRAFT', 'SCHEDULED'] as const;

// ---------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

type CampaignRow = typeof campaigns.$inferSelect & {
  sender: (typeof senders.$inferSelect) | null;
};

export function campaignDto(c: CampaignRow) {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    channel: c.channel,
    sender: c.sender ? { id: c.sender.id, fromName: c.sender.fromName, fromEmail: c.sender.fromEmail, kind: c.sender.kind } : null,
    templateId: c.templateId,
    subject: c.subject,
    previewText: c.previewText,
    html: c.html,
    text: c.text,
    audience: c.audience,
    attachments: c.attachments ?? [],
    scheduledAt: c.scheduledAt,
    startedAt: c.startedAt,
    completedAt: c.completedAt,
    lastError: c.lastError,
    stats: {
      recipients: c.recipients,
      sent: c.sent,
      delivered: c.delivered,
      bounced: c.bounced,
      complained: c.complained,
      opened: c.opened,
      clicked: c.clicked,
      unsubscribed: c.unsubscribed,
      suppressed: c.suppressed,
      failed: c.failed,
    },
    rates: {
      delivery: pct(c.delivered, c.sent),
      open: pct(c.opened, c.delivered || c.sent),
      click: pct(c.clicked, c.delivered || c.sent),
      bounce: pct(c.bounced, c.sent),
      unsubscribe: pct(c.unsubscribed, c.delivered || c.sent),
    },
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

async function getOwned(tenantId: string, id: string) {
  const c = await db.query.campaigns.findFirst({
    where: and(eq(campaigns.id, id), eq(campaigns.tenantId, tenantId)),
    with: { sender: true },
  });
  if (!c) throw new AppError(404, 'campaign_not_found', 'Campaign not found');
  return c;
}

async function assertRefs(tenantId: string, input: { senderId?: string | null; templateId?: string | null; audience?: Audience | null }) {
  if (input.senderId) {
    const s = await db.query.senders.findFirst({ where: and(eq(senders.id, input.senderId), eq(senders.tenantId, tenantId)), columns: { id: true } });
    if (!s) throw new AppError(404, 'sender_not_found', 'Sender not found');
  }
  if (input.templateId) {
    const t = await db.query.templates.findFirst({ where: and(eq(templates.id, input.templateId), eq(templates.tenantId, tenantId)), columns: { id: true } });
    if (!t) throw new AppError(404, 'template_not_found', 'Template not found');
  }
  const listIds = input.audience?.listIds ?? [];
  if (listIds.length) {
    const found = await db.select({ id: lists.id }).from(lists).where(and(eq(lists.tenantId, tenantId), inArray(lists.id, listIds)));
    if (found.length !== new Set(listIds).size) throw new AppError(404, 'list_not_found', 'One of the lists was not found');
  }
}

// ---------------------------------------------------------------------
//  CRUD
// ---------------------------------------------------------------------

export const listCampaignsQuery = z.object({
  status: z.enum(['DRAFT', 'SCHEDULED', 'SENDING', 'PAUSED', 'SENT', 'CANCELLED', 'FAILED']).optional(),
  channel: z.enum(['EMAIL', 'WHATSAPP']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function listCampaigns(tenantId: string, q: z.infer<typeof listCampaignsQuery>) {
  const where = and(eq(campaigns.tenantId, tenantId), q.status ? eq(campaigns.status, q.status) : undefined, q.channel ? eq(campaigns.channel, q.channel) : undefined);
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db.query.campaigns.findMany({
      where,
      with: { sender: true },
      orderBy: [desc(campaigns.updatedAt)],
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
      columns: { html: false }, // lists stay light
    }),
    db.select({ total: count() }).from(campaigns).where(where),
  ]);
  return {
    campaigns: rows.map((r) => campaignDto({ ...r, html: null, text: r.text ? r.text.slice(0, 200) : null } as CampaignRow)), // the first words of a WhatsApp message
    page: q.page,
    total,
    pages: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

export async function getCampaign(tenantId: string, id: string) {
  return campaignDto(await getOwned(tenantId, id));
}

export async function createCampaign(tenantId: string, userId: string, input: z.infer<typeof campaignBody>) {
  await assertRefs(tenantId, input);
  if (input.channel === 'WHATSAPP') {
    const t = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
    if (!t || !whatsappWebAllowed(t)) throw new AppError(403, 'feature_not_enabled', 'WhatsApp sending isn’t available on this account');
    const [row] = await db
      .insert(campaigns)
      .values({ tenantId, channel: 'WHATSAPP', name: input.name, text: input.text ?? null, audience: input.audience ?? null, attachments: await resolveRefs(tenantId, input.attachments), createdById: userId })
      .returning();
    return getCampaign(tenantId, row!.id);
  }
  let content = { subject: input.subject ?? null, previewText: input.previewText ?? null, html: input.html ?? null, text: input.text ?? null };
  let files = await resolveRefs(tenantId, input.attachments);
  if (input.templateId && !content.html) {
    const t = (await db.query.templates.findFirst({ where: eq(templates.id, input.templateId) }))!;
    content = { subject: content.subject ?? t.subject, previewText: content.previewText ?? t.previewText, html: t.html, text: t.text };
    if (!input.attachments) files = t.attachments;
  }
  // New email broadcasts go from the employee's own Gmail if they connected one, else the agency's default
  const senderId = input.senderId ?? (await senderFor(tenantId, [userId]))?.id ?? null;
  const [row] = await db
    .insert(campaigns)
    .values({ tenantId, name: input.name, senderId, templateId: input.templateId ?? null, audience: input.audience ?? null, attachments: files, createdById: userId, ...content })
    .returning();
  return getCampaign(tenantId, row!.id);
}

export async function updateCampaign(tenantId: string, id: string, input: Partial<z.infer<typeof campaignBody>>) {
  const c = await getOwned(tenantId, id);
  if (!EDITABLE.includes(c.status as (typeof EDITABLE)[number])) {
    throw new AppError(409, 'not_editable', `A ${c.status.toLowerCase()} campaign can’t be edited. Duplicate it instead.`);
  }
  await assertRefs(tenantId, input);
  const { channel: _ignored, attachments: ids, ...rest } = input;
  const patch: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  if (ids !== undefined) patch.attachments = await resolveRefs(tenantId, ids);
  else if (input.templateId && input.templateId !== c.templateId && !c.attachments.length) {
    // Choosing a template with files brings its files along, unless files were already attached
    const t = await db.query.templates.findFirst({ where: eq(templates.id, input.templateId), columns: { attachments: true } });
    if (t?.attachments.length) patch.attachments = t.attachments;
  }
  if (Object.keys(patch).length) await db.update(campaigns).set(patch).where(eq(campaigns.id, id));
  return getCampaign(tenantId, id);
}

export async function deleteCampaign(tenantId: string, id: string) {
  const c = await getOwned(tenantId, id);
  if (c.status === 'SENDING' || c.status === 'SENT' || c.startedAt) {
    throw new AppError(409, 'not_deletable', 'Sent campaigns are kept for your reports. You can’t delete them.');
  }
  await db.delete(campaigns).where(eq(campaigns.id, id));
}

export async function duplicateCampaign(tenantId: string, userId: string, id: string) {
  const c = await getOwned(tenantId, id);
  const [row] = await db
    .insert(campaigns)
    .values({
      tenantId,
      name: `Copy of ${c.name}`.slice(0, 120),
      senderId: c.senderId,
      templateId: c.templateId,
      subject: c.subject,
      previewText: c.previewText,
      html: c.html,
      text: c.text,
      audience: c.audience,
      attachments: c.attachments,
      createdById: userId,
    })
    .returning();
  return getCampaign(tenantId, row!.id);
}

// ---------------------------------------------------------------------
//  Preview, checks, test send
// ---------------------------------------------------------------------

async function checkInputFor(tenantId: string, id: string) {
  const c = await db.query.campaigns.findFirst({
    where: and(eq(campaigns.id, id), eq(campaigns.tenantId, tenantId)),
    with: { tenant: true, sender: { with: { domain: true, connection: true } } },
  });
  if (!c) throw new AppError(404, 'campaign_not_found', 'Campaign not found');
  return {
    c,
    input: {
      tenantId,
      tenant: c.tenant,
      subject: c.subject,
      html: c.html,
      previewText: c.previewText,
      audience: c.audience,
      sender: c.sender,
      channel: c.channel,
      text: c.text,
      attachments: c.attachments,
      // A broadcast goes from the WhatsApp number of the employee who made it
      createdById: c.createdById,
    },
  };
}

/** Checks for either channel. */
async function checksFor(input: Awaited<ReturnType<typeof checkInputFor>>['input']) {
  return input.channel === 'WHATSAPP' ? whatsappChecks({ ...input, tenant: input.tenant }) : campaignChecks(input);
}

/** Renders the email as one real recipient would see it, plus the ready-to-send checks. */
export async function previewCampaign(tenantId: string, id: string, contactId?: string) {
  const { c, input } = await checkInputFor(tenantId, id);
  if (c.channel === 'WHATSAPP') {
    const [contact] = contactId
      ? await db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId))).limit(1)
      : await db.select().from(contacts).where(whatsappAudienceWhere(tenantId, c.audience)).orderBy(contacts.createdAt).limit(1);
    return {
      previewAs: contact ? { id: contact.id, email: contact.email, firstName: contact.firstName, phone: contact.phone } : null,
      rendered: c.text ? { subject: '', html: '', text: renderWhatsApp(c.text, contact ?? null, c.tenant) } : null,
      ...(await checksFor(input)),
    };
  }
  // Plain select (not db.query): the audience filter has subqueries on other tables
  const [contact] = contactId
    ? await db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId))).limit(1)
    : await db.select().from(contacts).where(emailAudienceWhere(tenantId, c.audience)).orderBy(contacts.createdAt).limit(1);

  const vars = buildMergeVars(contact ?? null, c.tenant, { unsubscribe_url: '#unsubscribe-preview' });
  const rendered =
    c.html
      ? renderEmail({ subject: c.subject ?? '', html: c.html, text: c.text, previewText: c.previewText }, vars, c.tenant)
      : null;
  const checks = await checksFor(input);
  return {
    previewAs: contact ? { id: contact.id, email: contact.email, firstName: contact.firstName } : null,
    rendered,
    ...checks,
  };
}

/** WhatsApp test: queued for the worker, which holds the connection. Personalised like the first recipient. */
export async function sendTestWhatsApp(tenantId: string, id: string, phones: string[]) {
  const { c } = await checkInputFor(tenantId, id);
  if (c.channel !== 'WHATSAPP') throw new AppError(400, 'wrong_channel', 'This is an email campaign');
  if (!whatsappWebAllowed(c.tenant)) throw new AppError(403, 'trial_ended', 'Your free trial has ended');
  if (!c.text?.trim() && !c.attachments.length) throw new AppError(400, 'no_content', 'Write the message first');
  const session = await pickSession(tenantId, [c.createdById]);
  if (session?.status !== 'CONNECTED') throw new AppError(400, 'whatsapp_not_connected', 'Link your WhatsApp number first, in WhatsApp → Linked number');
  const normalized = phones.map((p) => normalizePhone(p));
  if (normalized.some((p) => !p)) throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: { phones: 'Enter valid phone numbers' } });
  const [sample] = await db.select().from(contacts).where(whatsappAudienceWhere(tenantId, c.audience)).orderBy(contacts.createdAt).limit(1);
  const text = `[Test] ${renderWhatsApp(c.text ?? '', sample ?? null, c.tenant)}`;
  for (const p of normalized) await enqueueWhatsAppTest(tenantId, session.id, p!, text, c.attachments);
  return { queued: normalized as string[], previewAs: sample?.phone ?? null };
}

export async function sendTestEmail(tenantId: string, id: string, to: string[]) {
  const { c } = await checkInputFor(tenantId, id);
  if (trialEnded(c.tenant)) throw new AppError(403, 'trial_ended', 'Your free trial has ended');
  const sender = c.sender;
  if (!sender) throw new AppError(400, 'no_sender', 'Choose who the email is from first');
  if (!c.subject || !c.html) throw new AppError(400, 'no_content', 'Add a subject and content first');

  const [sample] = await db.select().from(contacts).where(emailAudienceWhere(tenantId, c.audience)).orderBy(contacts.createdAt).limit(1);
  const vars = buildMergeVars(sample ?? null, c.tenant, { unsubscribe_url: `#test-email-unsubscribe` });
  const r = renderEmail({ subject: c.subject, html: c.html, text: c.text, previewText: c.previewText }, vars, c.tenant);

  const files = await loadFiles(tenantId, c.attachments);
  let provider;
  if (sender.kind === 'DOMAIN') provider = getEmailProvider();
  else if (sender.connection?.status === 'ACTIVE') provider = getMailboxProviderFactory()(sender.connection);
  else throw new AppError(400, 'sender_not_verified', `${sender.fromEmail} is disconnected`);

  const results: { to: string; ok: boolean; error?: string }[] = [];
  for (const address of to) {
    try {
      await provider.send({
        from: { name: sender.fromName, email: sender.fromEmail },
        replyTo: sender.replyTo,
        to: address,
        subject: `[Test] ${r.subject}`,
        html: r.html,
        text: r.text,
        headers: {},
        tags: { tenant_id: tenantId, campaign_id: c.id, test: 'true' },
        attachments: files,
      });
      results.push({ to: address, ok: true });
    } catch (err) {
      const msg = err instanceof SendError ? err.message : 'Sending failed';
      results.push({
        to: address,
        ok: false,
        error: /not verified/i.test(msg)
          ? 'While your account is in the SES sandbox, test emails can only go to verified addresses.'
          : msg.slice(0, 200),
      });
    }
  }
  return { results, previewAs: sample?.email ?? null };
}

// ---------------------------------------------------------------------
//  Scheduling and sending
// ---------------------------------------------------------------------

async function assertSendable(tenantId: string, id: string) {
  const { input } = await checkInputFor(tenantId, id);
  const r = await checksFor(input);
  if (!r.canSend) {
    const first = r.checks.find((c) => c.level === 'error')!;
    throw new AppError(422, 'checks_failed', first.title, { checks: r.checks });
  }
  return r;
}

export async function scheduleCampaign(tenantId: string, id: string, scheduledAt: Date, now = new Date()) {
  const c = await getOwned(tenantId, id);
  if (!EDITABLE.includes(c.status as (typeof EDITABLE)[number])) {
    throw new AppError(409, 'not_schedulable', `A ${c.status.toLowerCase()} campaign can’t be scheduled`);
  }
  if (scheduledAt.getTime() < now.getTime() + 60_000) throw new AppError(400, 'time_in_past', 'Pick a time at least a minute from now');
  if (scheduledAt.getTime() > now.getTime() + 365 * 86_400_000) throw new AppError(400, 'time_too_far', 'Schedule within the next 12 months');
  await assertSendable(tenantId, id);
  await db.update(campaigns).set({ status: 'SCHEDULED', scheduledAt, lastError: null }).where(eq(campaigns.id, id));
  return getCampaign(tenantId, id);
}

export async function unscheduleCampaign(tenantId: string, id: string) {
  const c = await getOwned(tenantId, id);
  if (c.status !== 'SCHEDULED') throw new AppError(409, 'not_scheduled', 'This campaign isn’t scheduled');
  await db.update(campaigns).set({ status: 'DRAFT', scheduledAt: null }).where(and(eq(campaigns.id, id), eq(campaigns.status, 'SCHEDULED')));
  return getCampaign(tenantId, id);
}

export async function sendCampaignNow(tenantId: string, id: string, enqueue?: EnqueueFn) {
  const c = await getOwned(tenantId, id);
  if (!EDITABLE.includes(c.status as (typeof EDITABLE)[number])) {
    throw new AppError(409, 'not_sendable', `This campaign is already ${c.status.toLowerCase()}`);
  }
  await assertSendable(tenantId, id);
  try {
    await startCampaign(id, { enqueue });
  } catch (err) {
    if (err instanceof CampaignError) throw new AppError(409, err.code, err.message);
    throw err;
  }
  return getCampaign(tenantId, id);
}

/** Stops a scheduled or sending campaign. Emails already sent stay sent; the rest are not sent. */
export async function cancelCampaign(tenantId: string, id: string) {
  const c = await getOwned(tenantId, id);
  if (c.status !== 'SENDING' && c.status !== 'SCHEDULED') {
    throw new AppError(409, 'not_cancellable', 'Only scheduled or sending campaigns can be cancelled');
  }
  await db.transaction(async (tx) => {
    await tx.update(campaigns).set({ status: 'CANCELLED', completedAt: new Date() }).where(eq(campaigns.id, id));
    await tx
      .update(messages)
      .set({ status: 'FAILED', error: 'campaign_cancelled' })
      .where(and(eq(messages.campaignId, id), eq(messages.status, 'QUEUED')));
  });
  return getCampaign(tenantId, id);
}

// ---------------------------------------------------------------------
//  Report
// ---------------------------------------------------------------------

export async function campaignReport(tenantId: string, id: string) {
  const c = await getOwned(tenantId, id);
  const [statusRows, links, bounces] = await Promise.all([
    db
      .select({ status: messages.status, error: messages.error, n: count() })
      .from(messages)
      .where(eq(messages.campaignId, id))
      .groupBy(messages.status, messages.error),
    db.select({ url: trackedLinks.url, clicks: trackedLinks.clicks }).from(trackedLinks).where(eq(trackedLinks.campaignId, id)).orderBy(desc(trackedLinks.clicks)).limit(10),
    db
      .select({
        email: messages.toAddress,
        at: messageEvents.occurredAt,
        detail: messageEvents.detail,
      })
      .from(messageEvents)
      .innerJoin(messages, eq(messages.id, messageEvents.messageId))
      .where(and(eq(messages.campaignId, id), inArray(messageEvents.type, ['BOUNCE', 'COMPLAINT']), sql`${messages.status} in ('BOUNCED','COMPLAINED')`))
      .orderBy(desc(messageEvents.occurredAt))
      .limit(50),
  ]);
  const pending = statusRows.filter((r) => r.status === 'QUEUED').reduce((a, r) => a + r.n, 0);
  const cancelled = statusRows.filter((r) => r.error === 'campaign_cancelled').reduce((a, r) => a + r.n, 0);
  return {
    campaign: campaignDto(c),
    pending,
    cancelled,
    topLinks: links,
    problems: bounces.map((b) => ({ email: b.email, at: b.at, detail: b.detail })),
  };
}

/**
 * Temporary lists are for one send: 30 days after a broadcast finishes (or is cancelled), its pasted
 * numbers / emails are wiped from the broadcast. Only how many there were is kept.
 */
export async function wipeTemporaryLists(now = new Date()) {
  const rows = await db.execute<{ id: string }>(sql`
    update campaigns
    set audience = (audience - 'addresses') || jsonb_build_object('addresses', '[]'::jsonb, 'addressCount', jsonb_array_length(audience -> 'addresses'))
    where audience ->> 'mode' = 'temporary'
      and jsonb_typeof(audience -> 'addresses') = 'array'
      and jsonb_array_length(audience -> 'addresses') > 0
      and status in ('SENT', 'CANCELLED', 'FAILED')
      and coalesce(completed_at, updated_at) < ${new Date(now.getTime() - 30 * 86_400_000).toISOString()}::timestamptz
    returning id`);
  return rows.rows.length;
}

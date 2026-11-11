import { hasFeature, trialEnded, whatsappWebAllowed } from '../plans/entitlements.js';
import { and, count, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { automations, automationSends, contacts, customFields, messages, tenants } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { enqueueEmails, enqueueWhatsApp, type EnqueueFn } from '../../queues/index.js';
import { creatorScoped, emailAudienceWhere, whatsappAudienceWhere } from '../audience/resolve.js';
import { notify, today } from '../notifications/service.js';
import { monthStartSql } from '../sending/start-campaign.js';

/**
 * If the server was down when a send was due, it still goes out within this window.
 * Older than this and it's skipped — a "3 days before your trip" email sent after the trip is worse than none.
 */
export const CATCH_UP_HOURS = 24;

type AutomationRow = typeof automations.$inferSelect & {
  dateField: typeof customFields.$inferSelect;
  tenant: typeof tenants.$inferSelect;
};

/**
 * SQL for the contact's occurrence date(s) of the automation's date field.
 *  - ONCE:   the date itself (trip on 2026-11-20)
 *  - YEARLY: that day/month in last, this and next year (birthdays), 29 Feb → 28 Feb in normal years
 * Values that aren't a valid YYYY-MM-DD are ignored, never crash the query.
 */
function occurrencesSql(key: string, repeat: 'ONCE' | 'YEARLY', nowLocalYear: SQL): SQL {
  const raw = sql`(${contacts.attributes} ->> ${key})`;
  const base = sql`(case when ${raw} ~ '^\\d{4}-\\d{2}-\\d{2}$' then ${raw}::date end)`;
  if (repeat === 'ONCE') return sql`(select ${base} as occ)`;
  return sql`(
    select make_date(yr, extract(month from ${base})::int,
      least(extract(day from ${base})::int,
            extract(day from (make_date(yr, extract(month from ${base})::int, 1) + interval '1 month - 1 day'))::int)) as occ
    from generate_series(${nowLocalYear} - 1, ${nowLocalYear} + 1) as yr
    where ${base} is not null
  )`;
}

/** Contacts (with occurrence and due time) for an automation within a time window. */
export function dueContactsQuery(a: AutomationRow, from: Date, to: Date) {
  const tz = a.tenant.timezone;
  const nowLocalYear = sql`extract(year from ${to.toISOString()}::timestamptz at time zone ${tz})::int`;
  const occ = occurrencesSql(a.dateField.key, a.repeat, nowLocalYear);
  const due = sql`(((o.occ + ${a.offsetDays}::int)::timestamp + ${a.sendTime}::time) at time zone ${tz})`;
  return sql`
    select ${contacts.id} as contact_id, ${a.channel === 'WHATSAPP' ? contacts.phone : contacts.email} as email, ${contacts.firstName} as first_name,
           to_char(o.occ, 'YYYY-MM-DD') as occurrence_date, ${due} as due_at
    from ${contacts}
    cross join lateral ${occ} o
    where ${a.channel === 'WHATSAPP' ? whatsappAudienceWhere(a.tenantId, a.audience) : emailAudienceWhere(a.tenantId, a.audience)}
      and o.occ is not null
      and ${due} > ${from.toISOString()}::timestamptz
      and ${due} <= ${to.toISOString()}::timestamptz
      and not exists (
        select 1 from automation_sends s
        where s.automation_id = ${a.id} and s.contact_id = "contacts"."id" and s.occurrence_date = o.occ
      )
    order by due_at`;
}

export interface AutomationTickResult {
  automations: number;
  queued: number;
  skipped: number;
}

/**
 * Runs every minute. For each active automation, finds contacts whose moment has arrived,
 * records one send per contact per occurrence (unique — never twice), and queues the email.
 */
export async function runAutomationsTick(opts: { now?: Date; enqueue?: EnqueueFn; enqueueWhatsApp?: EnqueueFn } = {}): Promise<AutomationTickResult> {
  const now = opts.now ?? new Date();
  const enqueueEmail = opts.enqueue ?? enqueueEmails;
  const enqueueWa = opts.enqueueWhatsApp ?? enqueueWhatsApp;
  const result: AutomationTickResult = { automations: 0, queued: 0, skipped: 0 };

  const active = await db.query.automations.findMany({
    where: eq(automations.status, 'ACTIVE'),
    with: { dateField: true, tenant: true },
  });

  for (const a of active as AutomationRow[]) {
    const wa = a.channel === 'WHATSAPP';
    if (a.tenant.status !== 'ACTIVE' || trialEnded(a.tenant) || !hasFeature(a.tenant, 'automations') || a.dateField.type !== 'DATE') continue;
    if (wa ? !a.text?.trim() || !whatsappWebAllowed(a.tenant, now) : !a.templateId || !a.senderId) continue;
    const enqueue = wa ? enqueueWa : enqueueEmail;
    result.automations++;
    try {
      // Never back-fill: nothing due before the automation was switched on
      const from = new Date(Math.max(now.getTime() - CATCH_UP_HOURS * 3_600_000, (a.activatedAt ?? now).getTime()));
      const due = await db.execute<{ contact_id: string; email: string; occurrence_date: string; due_at: Date }>(dueContactsQuery({ ...a, audience: (await creatorScoped(db, a.audience, a.createdById)) ?? null }, from, now));
      if (!due.rows.length) continue;

      // Monthly email quota (WhatsApp has its own daily pacing in the worker)
      const [{ used } = { used: 0 }] = wa
        ? [{ used: 0 }]
        : await db
            .select({ used: count() })
            .from(messages)
            .where(and(eq(messages.tenantId, a.tenantId), eq(messages.channel, 'EMAIL'), gte(messages.queuedAt, monthStartSql(now, a.tenant.timezone))));
      const room = wa ? due.rows.length : Math.max(0, a.tenant.monthlyQuota - used);
      const allowed = due.rows.slice(0, room);
      const over = due.rows.slice(room);

      if (over.length) {
        await db
          .insert(automationSends)
          .values(over.map((r) => ({ automationId: a.id, contactId: r.contact_id, occurrenceDate: r.occurrence_date, dueAt: new Date(r.due_at), status: 'SKIPPED' as const, skipReason: 'monthly_quota_reached' })))
          .onConflictDoNothing();
        result.skipped += over.length;
        await notify(a.tenantId, {
          userId: a.createdById,
          type: 'automation.quota',
          level: 'WARNING',
          title: `“${a.name}” skipped ${over.length} email${over.length > 1 ? 's' : ''} — monthly limit reached`,
          body: 'Upgrade your plan or wait for next month. Skipped emails are not sent later.',
          link: `/automations/${a.id}`,
          dedupeKey: `automation.quota:${a.id}:${today()}`,
        });
      }

      const queuedIds: string[] = [];
      for (const r of allowed) {
        // Claim the occurrence first; if another tick got there, skip
        const [send] = await db
          .insert(automationSends)
          .values({ automationId: a.id, contactId: r.contact_id, occurrenceDate: r.occurrence_date, dueAt: new Date(r.due_at) })
          .onConflictDoNothing()
          .returning({ id: automationSends.id });
        if (!send) continue;
        const [msg] = await db
          .insert(messages)
          .values(
            wa
              ? { tenantId: a.tenantId, automationId: a.id, contactId: r.contact_id, channel: 'WHATSAPP' as const, toAddress: r.email, body: a.text, attachments: a.attachments, sentById: a.createdById }
              : { tenantId: a.tenantId, automationId: a.id, contactId: r.contact_id, senderId: a.senderId, channel: 'EMAIL' as const, toAddress: r.email.toLowerCase(), sentById: a.createdById },
          )
          .returning({ id: messages.id });
        await db.update(automationSends).set({ messageId: msg!.id }).where(eq(automationSends.id, send.id));
        queuedIds.push(msg!.id);
      }
      await enqueue(queuedIds);
      result.queued += queuedIds.length;
    } catch (err) {
      logger.error({ err, automationId: a.id }, 'automation tick failed');
    }
  }
  return result;
}

/** Keeps automation_sends in step with what happened to its message. */
export async function syncAutomationSend(messageId: string, status: 'SENT' | 'SKIPPED' | 'FAILED', reason?: string) {
  await db
    .update(automationSends)
    .set({ status, sentAt: status === 'SENT' ? new Date() : null, skipReason: reason ?? null })
    .where(and(eq(automationSends.messageId, messageId), inArray(automationSends.status, ['PENDING'])));
}

import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { auditLogs, messages, senders, suppressions, tenants, tripDues, tripReminders, trips, type Tenant } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { enqueueEmails, enqueueWhatsApp } from '../../queues/index.js';
import { escapeHtml, renderString } from '../email/render.js';
import { notify } from '../notifications/service.js';
import { trialEnded, whatsappWebAllowed } from '../plans/entitlements.js';
import { addDays, formatInr, localDate, tripMoney, type DueInput } from '../trips/money.js';
import { getSession } from '../whatsapp/service.js';
import { resolvedSettings } from './settings.js';

/** Reminders go out from this hour, company time — never at midnight. */
export const REMINDER_HOUR = 10;
/** An instalment missed longer ago than this doesn't get a first "overdue" message (e.g. old data imported later). */
const OVERDUE_WINDOW_DAYS = 7;

export function payPageUrl(token: string) {
  return `${env.PUBLIC_URL.replace(/\/$/, '')}/p/${token}`;
}
export function receiptUrl(token: string) {
  return `${env.PUBLIC_URL.replace(/\/$/, '')}/r/${token}`;
}

function localHour(timezone: string, now: Date) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(now));
}

function humanDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** A short, plain email for a service message: the text, a button to the pay page, the company's details. */
export function serviceEmailHtml(input: { text: string; tenant: Pick<Tenant, 'name' | 'postalAddress'>; buttonUrl?: string; buttonLabel?: string; unsubscribeUrl?: string }) {
  const paragraphs = input.text
    .split(/\n{2,}/)
    .map((p) =>
      escapeHtml(p)
        .replace(/\n/g, '<br>')
        // Links in the text become real links
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0b7a62">$1</a>'),
    )
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#111816">${p}</p>`)
    .join('');
  const button = input.buttonUrl
    ? `<p style="margin:8px 0 24px"><a href="${escapeHtml(input.buttonUrl)}" style="display:inline-block;background:#111816;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:10px">${escapeHtml(input.buttonLabel ?? 'Open')}</a></p>`
    : '';
  const footer =
    [input.tenant.name, input.tenant.postalAddress].filter(Boolean).map((l) => escapeHtml(l!)).join('<br>') +
    (input.unsubscribeUrl ? `<br><br><a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#59625e">Unsubscribe</a> from messages like this` : '');
  return `<!doctype html><html><body style="margin:0;background:#f5f6f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e3e6e3;border-radius:16px">
<tr><td style="padding:28px 28px 8px">${paragraphs}${button}</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #eef0ee;font-size:12px;line-height:1.5;color:#59625e">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

export interface ReminderResult {
  sent: number;
  skipped: number;
}

type Candidate = {
  tripId: string;
  tenantId: string;
};

/**
 * Runs every minute. For booked trips, sends one reminder a few days before each instalment
 * and (optionally) one the day after a missed instalment. Each instalment gets each kind once,
 * enforced by a unique row in trip_reminders, so reruns and restarts never double-send.
 */
export async function runPaymentReminders(
  opts: { now?: Date; enqueueEmail?: (ids: string[]) => Promise<void>; enqueueWhatsApp?: (ids: string[]) => Promise<void> } = {},
): Promise<ReminderResult> {
  const now = opts.now ?? new Date();
  const result: ReminderResult = { sent: 0, skipped: 0 };
  const sendEmail = opts.enqueueEmail ?? enqueueEmails;
  const sendWhatsApp = opts.enqueueWhatsApp ?? enqueueWhatsApp;

  // Trips with an instalment in the window that could still need a reminder (cheap pre-filter, UTC dates ± a day)
  const utcToday = now.toISOString().slice(0, 10);
  const candidates: Candidate[] = await db
    .selectDistinct({ tripId: trips.id, tenantId: trips.tenantId })
    .from(tripDues)
    .innerJoin(trips, eq(trips.id, tripDues.tripId))
    .where(
      and(
        eq(trips.status, 'BOOKED'),
        gte(tripDues.dueDate, addDays(utcToday, -(OVERDUE_WINDOW_DAYS + 1))),
        lte(tripDues.dueDate, addDays(utcToday, 16)),
        sql`(select count(*) from trip_reminders r where r.due_id = ${tripDues.id}) < 2`,
      ),
    );
  if (!candidates.length) return result;

  const byTenant = new Map<string, string[]>();
  for (const c of candidates) byTenant.set(c.tenantId, [...(byTenant.get(c.tenantId) ?? []), c.tripId]);

  for (const [tenantId, tripIds] of byTenant) {
    try {
      const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
      if (!tenant || tenant.status !== 'ACTIVE' || trialEnded(tenant, now)) continue;
      const settings = resolvedSettings(tenant);
      if (!settings.remindersEnabled) continue;
      if (localHour(tenant.timezone, now) < REMINDER_HOUR) continue;
      const today = localDate(tenant.timezone, now);

      // What can we send with, right now?
      const whatsappUp = whatsappWebAllowed(tenant, now) && (await getSession(tenantId)).status === 'CONNECTED';
      const sender =
        (await db.query.senders.findFirst({ where: and(eq(senders.tenantId, tenantId), eq(senders.isDefault, true)) })) ??
        (await db.query.senders.findFirst({ where: eq(senders.tenantId, tenantId), orderBy: [asc(senders.createdAt)] }));

      const rows = await db.query.trips.findMany({
        where: and(eq(trips.tenantId, tenantId), inArray(trips.id, tripIds), eq(trips.status, 'BOOKED')),
        with: { dues: true, payments: true, contact: true },
      });
      for (const trip of rows) {
        const money = tripMoney({ price: trip.price, dues: trip.dues as DueInput[], payments: trip.payments }, today);
        const done = await db.select({ dueId: tripReminders.dueId, kind: tripReminders.kind }).from(tripReminders).where(eq(tripReminders.tripId, trip.id));
        const has = (dueId: string, kind: string) => done.some((d) => d.dueId === dueId && d.kind === kind);

        for (const due of money.dues) {
          if (due.remaining <= 0) continue;
          let kind: 'BEFORE' | 'OVERDUE' | null = null;
          if (due.dueDate > today && due.dueDate <= addDays(today, settings.daysBefore) && !has(due.id, 'BEFORE')) kind = 'BEFORE';
          else if (settings.overdueReminder && due.dueDate < today && due.dueDate >= addDays(today, -OVERDUE_WINDOW_DAYS) && !has(due.id, 'OVERDUE')) kind = 'OVERDUE';
          if (!kind) continue;

          const c = trip.contact;
          // Service messages: people who opted out of offers still get these, but never those who
          // replied STOP, bounced, or reported spam.
          const blocked = c
            ? await db
                .select({ channel: suppressions.channel, reason: suppressions.reason })
                .from(suppressions)
                .where(and(eq(suppressions.tenantId, tenantId), inArray(suppressions.address, [c.phone ?? '', c.email ?? ''].filter(Boolean))))
            : [];
          const canWhatsApp = !!(whatsappUp && c?.phone && !blocked.some((b) => b.channel === 'WHATSAPP'));
          const canEmail = !!(sender && c?.email && c.emailStatus !== 'BOUNCED' && c.emailStatus !== 'COMPLAINED' && !blocked.some((b) => b.channel === 'EMAIL' && b.reason !== 'UNSUBSCRIBE'));
          const channel =
            settings.channel === 'WHATSAPP' ? (canWhatsApp ? 'WHATSAPP' : null) : settings.channel === 'EMAIL' ? (canEmail ? 'EMAIL' : null) : canWhatsApp ? 'WHATSAPP' : canEmail ? 'EMAIL' : null;

          const vars = {
            first_name: c?.firstName ?? trip.customerName.split(' ')[0] ?? '',
            full_name: [c?.firstName, c?.lastName].filter(Boolean).join(' ') || trip.customerName,
            amount: formatInr(due.remaining),
            due_label: due.label.toLowerCase(),
            due_date: humanDate(due.dueDate),
            trip: trip.title,
            trip_number: `#${trip.number}`,
            balance: formatInr(Math.max(0, money.balance)),
            pay_link: payPageUrl(trip.publicToken),
            company_name: tenant.name,
          };
          const text = renderString(kind === 'BEFORE' ? settings.beforeText : settings.overdueText, vars, { html: false });

          // Claim this reminder first: if another tick got here, stop
          const [claim] = await db
            .insert(tripReminders)
            .values({
              tenantId,
              tripId: trip.id,
              dueId: due.id,
              kind,
              channel,
              skipReason: channel ? null : !c ? 'contact_removed' : !c.phone && !c.email ? 'no_phone_or_email' : 'no_channel',
            })
            .onConflictDoNothing()
            .returning({ id: tripReminders.id });
          if (!claim) continue;

          if (!channel) {
            result.skipped++;
            await notify(tenantId, {
              type: 'payments.reminder_skipped',
              level: 'WARNING',
              title: `Couldn’t remind ${trip.customerName} about ${formatInr(due.remaining)}`,
              body: c?.phone && !whatsappUp ? 'WhatsApp isn’t linked and there’s no email to use. Remind them yourself, or link WhatsApp.' : 'There’s no way to reach them: add a phone number or email to the contact.',
              link: `/trips/${trip.id}`,
              dedupeKey: `reminder.skipped:${due.id}:${kind}`,
            });
            continue;
          }

          const [msg] = await db
            .insert(messages)
            .values({
              tenantId,
              tripId: trip.id,
              contactId: c!.id,
              senderId: channel === 'EMAIL' ? sender!.id : null,
              channel,
              toAddress: channel === 'EMAIL' ? c!.email!.toLowerCase() : c!.phone!,
              subject: channel === 'EMAIL' ? `${kind === 'BEFORE' ? 'Payment reminder' : 'Payment overdue'}: ${trip.title}` : null,
              body: text,
              service: true,
            })
            .returning({ id: messages.id });
          await db.update(tripReminders).set({ messageId: msg!.id }).where(eq(tripReminders.id, claim.id));
          await db.update(tripDues).set({ remindedAt: now }).where(eq(tripDues.id, due.id));
          await db.insert(auditLogs).values({ tenantId, userId: null, action: 'trip.reminder', entity: 'trip', entityId: trip.id, meta: { label: due.label, channel, kind, amount: formatInr(due.remaining) } });
          if (channel === 'EMAIL') await sendEmail([msg!.id]);
          else await sendWhatsApp([msg!.id]);
          result.sent++;
        }
      }
    } catch (err) {
      logger.error({ err, tenantId }, 'payment reminders failed');
    }
  }
  return result;
}

/** The reminders sent for one trip, newest first (shown on the trip page). */
export async function remindersFor(tripId: string) {
  return db
    .select({ id: tripReminders.id, dueId: tripReminders.dueId, kind: tripReminders.kind, channel: tripReminders.channel, skipReason: tripReminders.skipReason, createdAt: tripReminders.createdAt, status: messages.status })
    .from(tripReminders)
    .leftJoin(messages, eq(messages.id, tripReminders.messageId))
    .where(eq(tripReminders.tripId, tripId))
    .orderBy(desc(tripReminders.createdAt));
}


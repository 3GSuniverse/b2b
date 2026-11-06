import { and, count, eq, gte, sql } from 'drizzle-orm';
import { auditLogs } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { tripStats } from '../trips/service.js';

/**
 * The Overview's picture of all customer communication, not just campaigns.
 * Every message is put in one of five groups by what sent it:
 *   automation        an automation the agency set up (birthdays, anniversaries…)
 *   payment_reminder  a reminder before or after a payment's due date
 *   trip_message      pre-trip details, a review request, "where next?", a quote follow-up
 *   broadcast         a campaign sent to a list
 *   direct            sent by someone by hand (a quote, a group message)
 * The first three happen without anyone lifting a finger: they count as automatic.
 */

export const SOURCES = ['automation', 'payment_reminder', 'trip_message', 'broadcast', 'direct'] as const;
export type MessageSource = (typeof SOURCES)[number];
export const AUTOMATIC = sql`('automation', 'payment_reminder', 'trip_message')`;

/** messages, each with its source, plus the names the activity feed needs */
export const classified = (tenantId: string) => sql`
  select m.*,
         case
           when m.automation_id is not null then 'automation'
           when r.id is not null then 'payment_reminder'
           when f.id is not null then 'trip_message'
           when m.campaign_id is not null then 'broadcast'
           else 'direct'
         end as source,
         r.kind as reminder_kind,
         f.kind as followup_kind
  from messages m
  left join trip_reminders r on r.message_id = m.id
  left join trip_followups f on f.message_id = m.id
  where m.tenant_id = ${tenantId}`;

const FOLLOWUP_TITLE: Record<string, string> = {
  PRE_TRIP: 'Pre-trip details',
  REVIEW: 'Review request after the trip',
  WHERE_NEXT: '“Where next?” message',
  QUOTE_FOLLOWUP: 'Quote follow-up',
};

export type FeedRow = {
  id: string;
  source: MessageSource;
  channel: 'EMAIL' | 'WHATSAPP';
  status: string;
  at: string;
  opened: boolean;
  reminder_kind: string | null;
  followup_kind: string | null;
  automation_name: string | null;
  campaign_name: string | null;
  subject: string | null;
  first_name: string | null;
  last_name: string | null;
  to_address: string;
  trip_id: string | null;
  trip_title: string | null;
};

export function feedTitle(r: FeedRow) {
  switch (r.source) {
    case 'automation':
      return r.automation_name ?? 'Automatic message';
    case 'payment_reminder':
      return r.reminder_kind === 'OVERDUE' ? 'Overdue payment reminder' : 'Payment reminder';
    case 'trip_message':
      return FOLLOWUP_TITLE[r.followup_kind ?? ''] ?? 'Trip message';
    case 'broadcast':
      return r.campaign_name ?? 'Broadcast';
    default:
      return r.subject ?? 'Message';
  }
}

export async function getCommunication(tenantId: string, monthStart: ReturnType<typeof sql>, timezone: string, now = new Date()) {
  const lastMonthStart = sql`(${monthStart} - interval '1 month')`;
  const since30 = new Date(now.getTime() - 31 * 86_400_000).toISOString();

  const [month, prev, daily, feed, stats, aiDrafts] = await Promise.all([
    db
      .execute<{ sent: number; email: number; whatsapp: number; automatic: number; delivered: number; opened: number }>(sql`
        select count(*) filter (where sent_at is not null)::int as sent,
               count(*) filter (where sent_at is not null and channel = 'EMAIL')::int as email,
               count(*) filter (where sent_at is not null and channel = 'WHATSAPP')::int as whatsapp,
               count(*) filter (where sent_at is not null and source in ${AUTOMATIC})::int as automatic,
               count(*) filter (where delivered_at is not null)::int as delivered,
               count(*) filter (where first_opened_at is not null)::int as opened
        from (${classified(tenantId)}) c
        where queued_at >= ${monthStart}`)
      .then((r) => r.rows[0]!),
    db
      .execute<{ sent: number; automatic: number }>(sql`
        select count(*) filter (where sent_at is not null)::int as sent,
               count(*) filter (where sent_at is not null and source in ${AUTOMATIC})::int as automatic
        from (${classified(tenantId)}) c
        where queued_at >= ${lastMonthStart} and queued_at < ${monthStart}`)
      .then((r) => r.rows[0]!),
    // Last 30 days by day, split into automatic, broadcasts and the rest
    db.execute<{ day: string; automatic: number; broadcast: number; direct: number }>(sql`
      select to_char(d.day, 'YYYY-MM-DD') as day,
             coalesce(s.automatic, 0)::int as automatic,
             coalesce(s.broadcast, 0)::int as broadcast,
             coalesce(s.direct, 0)::int as direct
      from generate_series(
             date_trunc('day', ${now.toISOString()}::timestamptz at time zone ${timezone}) - interval '29 days',
             date_trunc('day', ${now.toISOString()}::timestamptz at time zone ${timezone}),
             interval '1 day') as d(day)
      left join (
        select date_trunc('day', sent_at at time zone ${timezone}) as day,
               count(*) filter (where source in ${AUTOMATIC}) as automatic,
               count(*) filter (where source = 'broadcast') as broadcast,
               count(*) filter (where source = 'direct') as direct
        from (${classified(tenantId)}) c
        where sent_at >= ${since30}::timestamptz
        group by 1
      ) s on s.day = d.day
      order by d.day`),
    // The latest messages that went out, newest first, for the activity feed
    db.execute<FeedRow>(sql`
      select c.id, c.source, c.channel, c.status, coalesce(c.sent_at, c.queued_at) as at, (c.first_opened_at is not null) as opened,
             c.reminder_kind, c.followup_kind, c.subject, c.to_address,
             a.name as automation_name, cp.name as campaign_name,
             ct.first_name, ct.last_name, t.id as trip_id, t.title as trip_title
      from (${classified(tenantId)}) c
      left join automations a on a.id = c.automation_id
      left join campaigns cp on cp.id = c.campaign_id
      left join contacts ct on ct.id = c.contact_id
      left join trips t on t.id = c.trip_id
      where c.status not in ('QUEUED', 'SUPPRESSED')
      order by coalesce(c.sent_at, c.queued_at) desc
      limit 8`),
    tripStats(tenantId),
    db
      .select({ n: count() })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, 'ai.draft'), gte(auditLogs.createdAt, monthStart)))
      .then((r) => r[0]?.n ?? 0),
  ]);

  return {
    thisMonth: {
      sent: month.sent,
      sentChange: prev.sent ? Math.round(((month.sent - prev.sent) / prev.sent) * 100) : null,
      email: month.email,
      whatsapp: month.whatsapp,
      automatic: month.automatic,
      automaticShare: month.sent ? Math.round((month.automatic / month.sent) * 100) : 0,
      delivered: month.delivered,
      deliveryRate: month.sent ? Math.round((month.delivered / month.sent) * 1000) / 10 : 0,
      opened: month.opened,
      openRate: month.delivered ? Math.round((month.opened / month.delivered) * 1000) / 10 : 0,
      aiDrafts,
    },
    last30Days: daily.rows,
    activity: feed.rows.map((r) => ({
      id: r.id,
      source: r.source,
      title: feedTitle(r),
      to: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.to_address,
      channel: r.channel,
      status: r.status,
      opened: r.opened,
      at: new Date(r.at).toISOString(),
      trip: r.trip_id ? { id: r.trip_id, title: r.trip_title } : null,
    })),
    comingUp: {
      departingThisWeek: stats.departingThisWeek,
      dueThisWeek: stats.dueThisWeek,
      overdue: stats.overdue,
      overdueTrips: stats.overdueTrips,
      newEnquiries: stats.counts.ENQUIRY,
    },
  };
}

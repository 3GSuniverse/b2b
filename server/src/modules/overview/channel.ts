import { and, asc, count, eq, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { automations, campaigns, contacts, senders, tenants } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { requireAuth, seesAll, viewerOf } from '../auth/guard.js';
import { isDomainReady } from '../domains/service.js';
import { monthStartSql } from '../sending/start-campaign.js';
import { AUTOMATIC, classified, feedTitle, type FeedRow } from './communication.js';

/**
 * The front page of a channel's master tab (Email or WhatsApp): this month's numbers,
 * the last 14 days, what's coming up, and whether the channel is ready to send.
 */
export type Channel = 'EMAIL' | 'WHATSAPP';

export async function getChannelHub(tenantId: string, channel: Channel, now = new Date(), onlyUserId?: string) {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant) throw new AppError(404, 'tenant_not_found', 'Account not found');
  const tz = tenant.timezone;
  const month = monthStartSql(now, tz);
  const lastMonth = sql`(${month} - interval '1 month')`;
  const since = new Date(now.getTime() - 15 * 86_400_000).toISOString();
  const inChannel = sql`(${classified(tenantId, onlyUserId)}) c where c.channel = ${channel}`;

  const [cur, prev, daily, drafts, scheduled, next, autos, reach, mySenders] = await Promise.all([
    db
      .execute<{ sent: number; delivered: number; opened: number; clicked: number; failed: number; broadcast: number; automatic: number; direct: number; queued: number }>(sql`
        select count(*) filter (where sent_at is not null)::int as sent,
               count(*) filter (where delivered_at is not null)::int as delivered,
               count(*) filter (where first_opened_at is not null)::int as opened,
               count(*) filter (where first_clicked_at is not null)::int as clicked,
               count(*) filter (where status in ('BOUNCED', 'FAILED', 'COMPLAINED'))::int as failed,
               count(*) filter (where sent_at is not null and source = 'broadcast')::int as broadcast,
               count(*) filter (where sent_at is not null and source in ${AUTOMATIC})::int as automatic,
               count(*) filter (where sent_at is not null and source = 'direct')::int as direct,
               count(*)::int as queued
        from ${inChannel} and c.queued_at >= ${month}`)
      .then((r) => r.rows[0]!),
    db.execute<{ sent: number }>(sql`select count(*) filter (where sent_at is not null)::int as sent from ${inChannel} and c.queued_at >= ${lastMonth} and c.queued_at < ${month}`).then((r) => r.rows[0]!.sent),
    db.execute<{ day: string; broadcast: number; automatic: number; direct: number }>(sql`
      select to_char(d.day, 'YYYY-MM-DD') as day,
             coalesce(s.broadcast, 0)::int as broadcast,
             coalesce(s.automatic, 0)::int as automatic,
             coalesce(s.direct, 0)::int as direct
      from generate_series(
             date_trunc('day', ${now.toISOString()}::timestamptz at time zone ${tz}) - interval '13 days',
             date_trunc('day', ${now.toISOString()}::timestamptz at time zone ${tz}),
             interval '1 day') as d(day)
      left join (
        select date_trunc('day', sent_at at time zone ${tz}) as day,
               count(*) filter (where source = 'broadcast') as broadcast,
               count(*) filter (where source in ${AUTOMATIC}) as automatic,
               count(*) filter (where source = 'direct') as direct
        from ${inChannel} and c.sent_at >= ${since}::timestamptz
        group by 1
      ) s on s.day = d.day
      order by d.day`),
    db.select({ n: count() }).from(campaigns).where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.channel, channel), eq(campaigns.status, 'DRAFT'))).then((r) => r[0]?.n ?? 0),
    db.select({ n: count() }).from(campaigns).where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.channel, channel), eq(campaigns.status, 'SCHEDULED'))).then((r) => r[0]?.n ?? 0),
    db.query.campaigns.findFirst({
      where: and(eq(campaigns.tenantId, tenantId), eq(campaigns.channel, channel), eq(campaigns.status, 'SCHEDULED'), isNotNull(campaigns.scheduledAt)),
      orderBy: [asc(campaigns.scheduledAt)],
      columns: { id: true, name: true, scheduledAt: true },
    }),
    db
      .select({ status: automations.status, n: count() })
      .from(automations)
      .where(and(eq(automations.tenantId, tenantId), eq(automations.channel, channel)))
      .groupBy(automations.status),
    channel === 'EMAIL'
      ? db.select({ n: count() }).from(contacts).where(and(eq(contacts.tenantId, tenantId), onlyUserId ? eq(contacts.ownerId, onlyUserId) : undefined, eq(contacts.emailStatus, 'SUBSCRIBED'), isNotNull(contacts.email))).then((r) => r[0]?.n ?? 0)
      : db.select({ n: count() }).from(contacts).where(and(eq(contacts.tenantId, tenantId), onlyUserId ? eq(contacts.ownerId, onlyUserId) : undefined, eq(contacts.whatsappStatus, 'SUBSCRIBED'), isNotNull(contacts.phone))).then((r) => r[0]?.n ?? 0),
    channel === 'EMAIL' ? db.query.senders.findMany({ where: eq(senders.tenantId, tenantId), with: { domain: true, connection: true } }) : Promise.resolve([]),
  ]);

  // The latest messages in this channel, for the activity list
  const activity = await db.execute<FeedRow>(sql`
    select c.id, c.source, c.channel, c.status, coalesce(c.sent_at, c.queued_at) as at, (c.first_opened_at is not null) as opened,
           c.reminder_kind, c.followup_kind, c.subject, c.to_address,
           a.name as automation_name, cp.name as campaign_name,
           ct.first_name, ct.last_name, t.id as trip_id, t.title as trip_title
    from (${classified(tenantId, onlyUserId)}) c
    left join automations a on a.id = c.automation_id
    left join campaigns cp on cp.id = c.campaign_id
    left join contacts ct on ct.id = c.contact_id
    left join trips t on t.id = c.trip_id
    where c.channel = ${channel} and c.status not in ('QUEUED', 'SUPPRESSED')
    order by coalesce(c.sent_at, c.queued_at) desc
    limit 6`);

  const ready = mySenders.filter((s) => (s.kind === 'DOMAIN' ? !!s.domain && isDomainReady(s.domain) : s.connection?.status === 'ACTIVE'));
  const autoBy = Object.fromEntries(autos.map((r) => [r.status, r.n]));
  const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

  return {
    channel,
    thisMonth: {
      sent: cur.sent,
      sentChange: prev ? Math.round(((cur.sent - prev) / prev) * 100) : null,
      delivered: cur.delivered,
      deliveryRate: rate(cur.delivered, cur.sent),
      opened: cur.opened,
      openRate: rate(cur.opened, cur.delivered || cur.sent),
      clicked: cur.clicked,
      clickRate: rate(cur.clicked, cur.delivered || cur.sent),
      failed: cur.failed,
      bySource: { broadcast: cur.broadcast, automatic: cur.automatic, direct: cur.direct },
    },
    last14Days: daily.rows,
    broadcasts: { drafts, scheduled, next: next ? { id: next.id, name: next.name, scheduledAt: next.scheduledAt } : null },
    automations: { on: autoBy.ACTIVE ?? 0, off: (autoBy.PAUSED ?? 0) + (autoBy.DRAFT ?? 0) },
    reachable: reach,
    email:
      channel === 'EMAIL'
        ? {
            quota: { used: cur.queued, limit: tenant.monthlyQuota },
            sendersReady: ready.length,
            defaultSender: (ready.find((s) => s.isDefault) ?? ready[0])?.fromEmail ?? null,
          }
        : null,
    activity: activity.rows.map((r) => ({
      id: r.id,
      source: r.source,
      channel,
      title: feedTitle(r),
      to: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.to_address,
      status: r.status,
      opened: r.opened,
      at: new Date(r.at).toISOString(),
      trip: r.trip_id ? { id: r.trip_id, title: r.trip_title } : null,
    })),
  };
}

export async function channelRoutes(app: FastifyInstance) {
  app.get<{ Params: { channel: string } }>('/api/channels/:channel', { preHandler: requireAuth }, async (req) => {
    const c = req.params.channel.toUpperCase();
    if (c !== 'EMAIL' && c !== 'WHATSAPP') throw new AppError(404, 'not_found', 'Unknown channel');
    const v = viewerOf(req);
    return getChannelHub(v.tenantId, c, new Date(), seesAll(v) ? undefined : v.userId);
  });
}


import { and, asc, count, desc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { campaigns, contacts, messages, senders, sendingDomains, tenants, users } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { countEmailAudience } from '../audience/resolve.js';
import { requireAuth, tenantOf } from '../auth/guard.js';
import { campaignDto } from '../campaigns/service.js';
import { isDomainReady } from '../domains/service.js';
import { unreadCount } from '../notifications/service.js';
import { monthStartSql } from '../sending/start-campaign.js';
import { HEALTH, tenantHealth } from '../webhooks/tenant-health.js';

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

function greeting(now: Date, timezone: string) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: timezone }).format(now));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** Everything the Overview screen shows, in one request. */
export async function getOverview(tenantId: string, userId: string, now = new Date()) {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant) throw new AppError(404, 'tenant_not_found', 'Account not found');
  const tz = tenant.timezone;
  const thisMonth = monthStartSql(now, tz);
  const lastMonth = sql`(${thisMonth} - interval '1 month')`;

  const monthStats = (from: ReturnType<typeof sql>, to?: ReturnType<typeof sql>) =>
    db
      .select({
        sent: sql<number>`count(*) filter (where ${messages.sentAt} is not null)::int`,
        delivered: sql<number>`count(*) filter (where ${messages.deliveredAt} is not null)::int`,
        clicked: sql<number>`count(*) filter (where ${messages.firstClickedAt} is not null)::int`,
        opened: sql<number>`count(*) filter (where ${messages.firstOpenedAt} is not null)::int`,
        queued: sql<number>`count(*)::int`,
      })
      .from(messages)
      .where(and(eq(messages.tenantId, tenantId), gte(messages.queuedAt, from), to ? lt(messages.queuedAt, to) : undefined))
      .then((r) => r[0]!);

  const [user, cur, prev, unsubs, daily, health, recent, upcoming, audienceRows, domains, readySenders, unread] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, userId), columns: { name: true } }),
    monthStats(thisMonth),
    monthStats(lastMonth, thisMonth),
    db
      .select({ n: sql<number>`coalesce(sum(${campaigns.unsubscribed}), 0)::int` })
      .from(campaigns)
      .where(and(eq(campaigns.tenantId, tenantId), gte(campaigns.startedAt, thisMonth)))
      .then((r) => r[0]!.n),
    // Last 30 days, by day in the company's timezone
    db.execute<{ day: string; delivered: number; clicked: number; sent: number }>(sql`
      select to_char(d.day, 'YYYY-MM-DD') as day,
             coalesce(s.sent, 0)::int as sent,
             coalesce(s.delivered, 0)::int as delivered,
             coalesce(s.clicked, 0)::int as clicked
      from generate_series(
             date_trunc('day', ${now.toISOString()}::timestamptz at time zone ${tz}) - interval '29 days',
             date_trunc('day', ${now.toISOString()}::timestamptz at time zone ${tz}),
             interval '1 day') as d(day)
      left join (
        select date_trunc('day', ${messages.sentAt} at time zone ${tz}) as day,
               count(*) as sent,
               count(*) filter (where ${messages.deliveredAt} is not null) as delivered,
               count(*) filter (where ${messages.firstClickedAt} is not null) as clicked
        from ${messages}
        where ${messages.tenantId} = ${tenantId}
          and ${messages.sentAt} >= ${new Date(now.getTime() - 31 * 86_400_000).toISOString()}::timestamptz
        group by 1
      ) s on s.day = d.day
      order by d.day`),
    tenantHealth(tenantId, now),
    db.query.campaigns.findMany({
      where: and(eq(campaigns.tenantId, tenantId)),
      with: { sender: true },
      columns: { html: false, text: false },
      orderBy: [desc(campaigns.updatedAt)],
      limit: 5,
    }),
    db.query.campaigns.findFirst({
      where: and(eq(campaigns.tenantId, tenantId), eq(campaigns.status, 'SCHEDULED'), isNotNull(campaigns.scheduledAt)),
      orderBy: [asc(campaigns.scheduledAt)],
      columns: { id: true, name: true, scheduledAt: true, audience: true },
    }),
    db.select({ status: contacts.emailStatus, n: count() }).from(contacts).where(eq(contacts.tenantId, tenantId)).groupBy(contacts.emailStatus),
    db.select().from(sendingDomains).where(eq(sendingDomains.tenantId, tenantId)),
    db.query.senders.findMany({ where: eq(senders.tenantId, tenantId), with: { domain: true, connection: true } }),
    unreadCount(tenantId),
  ]);

  const byStatus = Object.fromEntries(audienceRows.map((r) => [r.status, r.n]));
  const totalContacts = audienceRows.reduce((a, r) => a + r.n, 0);
  const subscribed = byStatus.SUBSCRIBED ?? 0;
  const resetsOn = await db
    .execute<{ d: string }>(sql`select to_char((${thisMonth} + interval '1 month') at time zone ${tz}, 'YYYY-MM-DD') as d`)
    .then((r) => r.rows[0]!.d);

  const sendersReady = readySenders.filter((s) =>
    s.kind === 'DOMAIN' ? !!s.domain && isDomainReady(s.domain) : s.connection?.status === 'ACTIVE',
  ).length;

  return {
    greeting: `${greeting(now, tz)}${user?.name ? `, ${user.name.split(' ')[0]}` : ''}`,
    account: { name: tenant.name, status: tenant.status, pausedReason: tenant.pausedReason, timezone: tz },
    quota: { used: cur.queued, limit: tenant.monthlyQuota, resetsOn },
    thisMonth: {
      sent: cur.sent,
      sentChange: prev.sent ? Math.round(((cur.sent - prev.sent) / prev.sent) * 100) : null, // % vs last month
      delivered: cur.delivered,
      deliveryRate: pct(cur.delivered, cur.sent),
      clicked: cur.clicked,
      clickRate: pct(cur.clicked, cur.delivered || cur.sent),
      clickRateChange: prev.sent ? Math.round((pct(cur.clicked, cur.delivered || cur.sent) - pct(prev.clicked, prev.delivered || prev.sent)) * 10) / 10 : null,
      opened: cur.opened,
      unsubscribed: unsubs,
      unsubscribeRate: pct(unsubs, cur.delivered || cur.sent),
    },
    last30Days: daily.rows.map((r) => ({ day: r.day, sent: r.sent, delivered: r.delivered, clicked: r.clicked })),
    health: {
      sample: health.sample,
      bounceRate: Math.round(health.bounceRate * 1000) / 10,
      complaintRate: Math.round(health.complaintRate * 10000) / 100,
      bounceLimit: HEALTH.maxBounceRate * 100,
      complaintLimit: HEALTH.maxComplaintRate * 100,
      status: health.bounceRate >= HEALTH.maxBounceRate * 0.6 || health.complaintRate >= HEALTH.maxComplaintRate * 0.6 ? 'at_risk' : 'good',
    },
    sending: {
      domains: domains.map((d) => ({ id: d.id, domain: d.domain, readyToSend: isDomainReady(d) })),
      sendersReady,
      defaultSender: readySenders.find((s) => s.isDefault)?.fromEmail ?? null,
    },
    recentCampaigns: recent.map((c) => {
      const d = campaignDto({ ...c, html: null, text: null } as Parameters<typeof campaignDto>[0]);
      return { id: d.id, name: d.name, status: d.status, scheduledAt: d.scheduledAt, startedAt: d.startedAt, updatedAt: d.updatedAt, stats: d.stats, rates: d.rates };
    }),
    upcoming: upcoming
      ? { id: upcoming.id, name: upcoming.name, scheduledAt: upcoming.scheduledAt, recipients: await countEmailAudience(db, tenantId, upcoming.audience) }
      : null,
    audience: {
      total: totalContacts,
      subscribed,
      suppressed: (byStatus.UNSUBSCRIBED ?? 0) + (byStatus.BOUNCED ?? 0) + (byStatus.COMPLAINED ?? 0),
    },
    unreadNotifications: unread,
  };
}

export async function overviewRoutes(app: FastifyInstance) {
  app.get('/api/overview', { preHandler: requireAuth }, async (req) => getOverview(tenantOf(req), req.auth!.userId));
}


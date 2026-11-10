/**
 * Everything customer care needs to know about an agency to help it, on one screen:
 * who they are, their plan and money, who works there, how sending is going, what broke lately.
 * Read-only: customer care sees, it never changes an agency's data from here.
 */
import { and, count, desc, eq, gte, gt, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import {
  auditLogs,
  billingPayments,
  campaigns,
  contacts,
  mailboxConnections,
  messages,
  notifications,
  senders,
  sendingDomains,
  sessions,
  supportTickets,
  tenants,
  trips,
  users,
  whatsappSessions,
} from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { BILLING_PLANS, isPlanId } from '../billing/plans.js';
import { effectiveWhatsAppLimit, emailDailyCap, entitlements, planDto, whatsappDailyCap } from '../plans/entitlements.js';
import { emailUsageLast24h } from '../sending/daily-cap.js';
import { whatsappUsageLast24h } from '../whatsapp/service.js';

/** A short, plain name for the browser behind a session, e.g. "Chrome on Windows". */
export function deviceName(ua: string | null | undefined) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'an unknown system';
  return `${browser} on ${os}`;
}

export async function agencyProfile(tenantId: string) {
  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!t) throw new AppError(404, 'agency_not_found', 'That agency could not be found');
  const now = new Date();
  const week = new Date(now.getTime() - 7 * 86_400_000);

  const [
    people,
    liveSessions,
    plan,
    monthEmails,
    email24,
    wa24,
    wa,
    domains,
    senderRows,
    mailboxes,
    contactRows,
    tripRows,
    recentCampaigns,
    health,
    topErrors,
    payments,
    activity,
    alerts,
    tickets,
  ] = await Promise.all([
    db.select().from(users).where(eq(users.tenantId, tenantId)).orderBy(sql`${users.role} = 'OWNER' desc`, desc(users.lastLoginAt)),
    db
      .select({ userId: sessions.userId, lastSeenAt: sessions.lastSeenAt, userAgent: sessions.userAgent, ip: sessions.ip, createdAt: sessions.createdAt })
      .from(sessions)
      .where(and(eq(sessions.tenantId, tenantId), gt(sessions.expiresAt, now)))
      .orderBy(desc(sessions.lastSeenAt)),
    planDto(t),
    db
      .execute<{ n: number }>(
        sql`select count(*)::int as n from ${messages} where ${messages.tenantId} = ${tenantId} and ${messages.channel} = 'EMAIL'
            and ${messages.queuedAt} >= date_trunc('month', now() at time zone ${t.timezone}) at time zone ${t.timezone}`,
      )
      .then((r) => r.rows[0]?.n ?? 0),
    emailUsageLast24h(tenantId, now),
    whatsappUsageLast24h(tenantId, now),
    db.query.whatsappSessions.findFirst({ where: eq(whatsappSessions.tenantId, tenantId) }),
    db.select().from(sendingDomains).where(eq(sendingDomains.tenantId, tenantId)),
    db.select().from(senders).where(eq(senders.tenantId, tenantId)),
    db
      .select({ id: mailboxConnections.id, provider: mailboxConnections.provider, email: mailboxConnections.email, status: mailboxConnections.status, lastError: mailboxConnections.lastError, dailyLimit: mailboxConnections.dailyLimit, createdAt: mailboxConnections.createdAt })
      .from(mailboxConnections)
      .where(eq(mailboxConnections.tenantId, tenantId)),
    db
      .select({
        total: count(),
        emailOk: sql<number>`count(*) filter (where ${contacts.emailStatus} = 'SUBSCRIBED' and ${contacts.email} is not null)::int`,
        whatsappOk: sql<number>`count(*) filter (where ${contacts.whatsappStatus} = 'SUBSCRIBED' and ${contacts.phone} is not null)::int`,
        bounced: sql<number>`count(*) filter (where ${contacts.emailStatus} in ('BOUNCED', 'COMPLAINED'))::int`,
      })
      .from(contacts)
      .where(eq(contacts.tenantId, tenantId))
      .then((r) => r[0]!),
    db
      .select({
        total: count(),
        booked: sql<number>`count(*) filter (where ${trips.status} not in ('ENQUIRY', 'LOST'))::int`,
        thisMonth: sql<number>`count(*) filter (where ${trips.createdAt} >= date_trunc('month', now()))::int`,
      })
      .from(trips)
      .where(eq(trips.tenantId, tenantId))
      .then((r) => r[0]!),
    db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        channel: campaigns.channel,
        status: campaigns.status,
        recipients: campaigns.recipients,
        sent: campaigns.sent,
        delivered: campaigns.delivered,
        bounced: campaigns.bounced,
        failed: campaigns.failed,
        opened: campaigns.opened,
        lastError: campaigns.lastError,
        createdAt: campaigns.createdAt,
        startedAt: campaigns.startedAt,
      })
      .from(campaigns)
      .where(and(eq(campaigns.tenantId, tenantId), ne(campaigns.status, 'DRAFT')))
      .orderBy(desc(campaigns.createdAt))
      .limit(8),
    db
      .select({ channel: messages.channel, status: messages.status, n: count() })
      .from(messages)
      .where(and(eq(messages.tenantId, tenantId), gte(messages.queuedAt, week)))
      .groupBy(messages.channel, messages.status),
    db
      .select({ channel: messages.channel, error: messages.error, n: count(), last: sql<string>`max(${messages.queuedAt})` })
      .from(messages)
      .where(and(eq(messages.tenantId, tenantId), gte(messages.queuedAt, week), isNotNull(messages.error), inArray(messages.status, ['FAILED', 'BOUNCED', 'COMPLAINED'])))
      .groupBy(messages.channel, messages.error)
      .orderBy(desc(count()))
      .limit(6),
    db
      .select({
        id: billingPayments.id,
        planId: billingPayments.planId,
        seats: billingPayments.seats,
        period: billingPayments.period,
        kind: billingPayments.kind,
        amount: billingPayments.amount,
        status: billingPayments.status,
        createdAt: billingPayments.createdAt,
        paidAt: billingPayments.paidAt,
        periodStart: billingPayments.periodStart,
        periodEnd: billingPayments.periodEnd,
        razorpayPaymentId: billingPayments.razorpayPaymentId,
      })
      .from(billingPayments)
      .where(eq(billingPayments.tenantId, tenantId))
      .orderBy(desc(billingPayments.createdAt))
      .limit(12),
    db
      .select({ id: auditLogs.id, action: auditLogs.action, entity: auditLogs.entity, meta: auditLogs.meta, createdAt: auditLogs.createdAt, userName: users.name })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.userId))
      .where(eq(auditLogs.tenantId, tenantId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(30),
    db
      .select({ id: notifications.id, level: notifications.level, title: notifications.title, body: notifications.body, createdAt: notifications.createdAt })
      .from(notifications)
      .where(and(eq(notifications.tenantId, tenantId), or(eq(notifications.level, 'ERROR'), eq(notifications.level, 'WARNING'))))
      .orderBy(desc(notifications.createdAt))
      .limit(10),
    db
      .select({ id: supportTickets.id, number: supportTickets.number, subject: supportTickets.subject, status: supportTickets.status, category: supportTickets.category, createdAt: supportTickets.createdAt, rating: supportTickets.rating })
      .from(supportTickets)
      .where(eq(supportTickets.tenantId, tenantId))
      .orderBy(desc(supportTickets.createdAt))
      .limit(12),
  ]);

  const ent = entitlements(t);
  const owner = people.find((u) => u.role === 'OWNER');
  const planName = isPlanId(t.planId) ? BILLING_PLANS[t.planId].name : null;
  const waCap = whatsappDailyCap(t);
  const sum = (ch: 'EMAIL' | 'WHATSAPP', st: string[]) => health.filter((h) => h.channel === ch && st.includes(h.status)).reduce((a, h) => a + h.n, 0);
  const week7 = (ch: 'EMAIL' | 'WHATSAPP') => ({
    total: sum(ch, ['QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'SUPPRESSED']),
    delivered: sum(ch, ['DELIVERED']),
    sent: sum(ch, ['SENT', 'DELIVERED']),
    failed: sum(ch, ['FAILED']),
    bounced: sum(ch, ['BOUNCED', 'COMPLAINED']),
    queued: sum(ch, ['QUEUED']),
  });

  return {
    agency: {
      id: t.id,
      name: t.name,
      loginCode: t.loginCode,
      status: t.status,
      pausedReason: t.pausedReason,
      timezone: t.timezone,
      postalAddress: t.postalAddress,
      createdAt: t.createdAt,
      owner: owner ? { name: owner.name, email: owner.email, lastLoginAt: owner.lastLoginAt } : null,
    },
    plan: {
      ...plan,
      name: plan.plan === 'TRIAL' ? 'Free trial' : (planName ?? 'Set by hand'),
      seats: ent.seats,
      source: ent.source,
      monthlyQuota: t.monthlyQuota,
      features: { automations: ent.automations, groups: ent.groups, ai: ent.ai, leadApi: ent.leadApi, prioritySupport: ent.prioritySupport },
      domains: ent.domains,
    },
    people: people.map((u) => {
      const mine = liveSessions.filter((s) => s.userId === u.id);
      return {
        id: u.id,
        name: u.name,
        role: u.role,
        email: u.email,
        username: u.username,
        disabled: !!u.disabledAt,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
        lastSeenAt: mine[0]?.lastSeenAt ?? null,
        devices: mine.slice(0, 4).map((s) => ({ device: deviceName(s.userAgent), ip: s.ip, lastSeenAt: s.lastSeenAt, since: s.createdAt })),
        signedInOn: mine.length,
      };
    }),
    usage: {
      emailsThisMonth: monthEmails,
      emailsLast24h: email24.sent,
      emailsPerDay: emailDailyCap(t),
      whatsappLast24h: wa24.sent,
      whatsappPerDay: wa ? effectiveWhatsAppLimit(wa.dailyLimit, waCap) : waCap,
      contacts: contactRows,
      trips: tripRows,
      week: { email: week7('EMAIL'), whatsapp: week7('WHATSAPP') },
      topErrors: topErrors.map((e) => ({ ...e, error: (e.error ?? '').slice(0, 240) })),
    },
    channels: {
      whatsapp: wa ? { status: wa.status, phone: wa.phone, displayName: wa.displayName, lastError: wa.lastError, connectedAt: wa.connectedAt, ownDailyLimit: wa.dailyLimit } : null,
      domains: domains.map((d) => ({
        id: d.id,
        domain: d.domain,
        ownership: d.ownershipStatus,
        identity: d.identityStatus,
        dkim: d.dkimStatus,
        mailFrom: d.mailFromStatus,
        verifiedAt: d.verifiedAt,
        lastCheckedAt: d.lastCheckedAt,
      })),
      senders: senderRows.map((s) => ({ id: s.id, kind: s.kind, fromName: s.fromName, fromEmail: s.fromEmail, isDefault: s.isDefault })),
      mailboxes,
    },
    campaigns: recentCampaigns,
    payments,
    activity,
    alerts,
    tickets,
  };
}

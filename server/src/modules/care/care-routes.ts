/**
 * The customer care dashboard's API. Only signed-in care staff (requireCare) reach any of it.
 */
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { attachments, auditLogs, careStaff, supportMessages, supportTickets, tenants, users, whatsappSessions } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError, parseBody } from '../../lib/http.js';
import { BILLING_PLANS, isPlanId } from '../billing/plans.js';
import { notify } from '../notifications/service.js';
import { agencyProfile, deviceName } from './profile.js';
import { addMessage, CATEGORIES, lastMessages, messageText, PRIORITIES, STATUSES, thread, ticketOr404 } from './service.js';
import { requireCare } from './staff.js';
import { createSupportSession, setSessionCookie } from '../auth/sessions.js';

const VIEWS = ['needs_reply', 'waiting', 'resolved', 'mine', 'unassigned', 'all'] as const;
const listQuery = z.object({
  view: z.enum(VIEWS).default('needs_reply'),
  q: z.string().trim().max(120).optional(),
  category: z.enum(CATEGORIES).optional(),
  agency: z.string().max(40).optional(),
});
const careReply = z.object({ body: messageText, internal: z.boolean().default(false), resolve: z.boolean().default(false) });
const ticketPatch = z.object({
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  category: z.enum(CATEGORIES).optional(),
  assigneeId: z.string().max(40).nullable().optional(),
});
const agencyQuery = z.object({ q: z.string().trim().max(120).optional() });
const openBody = z.object({
  reason: z.string().trim().min(5, 'Say in a few words why you’re opening the account').max(200),
  minutes: z.number().int().min(15).max(120).default(60),
});

const PRIORITY_RANK = sql`case ${supportTickets.priority} when 'URGENT' then 0 when 'HIGH' then 1 when 'NORMAL' then 2 else 3 end`;

/** "Basic · 3 logins", "Free trial", for lists. */
function planLabel(t: { plan: string; planId: string | null; seats: number | null }) {
  if (t.plan === 'TRIAL') return t.planId && isPlanId(t.planId) ? `${BILLING_PLANS[t.planId].name} (lapsed)` : 'Free trial';
  if (isPlanId(t.planId)) return `${BILLING_PLANS[t.planId].name} · ${t.seats ?? 1} ${t.seats === 1 ? 'login' : 'logins'}`;
  return 'Paid (set by hand)';
}

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function careRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (req.url.startsWith('/api/care/') && !req.url.startsWith('/api/care/auth/')) await requireCare(req);
  });

  // The numbers at the top of the dashboard
  app.get('/api/care/summary', async (req) => {
    const me = req.care!.staffId;
    const [r] = await db
      .select({
        needsReply: sql<number>`count(*) filter (where ${supportTickets.status} = 'OPEN')::int`,
        urgent: sql<number>`count(*) filter (where ${supportTickets.status} = 'OPEN' and ${supportTickets.priority} in ('URGENT', 'HIGH'))::int`,
        unassigned: sql<number>`count(*) filter (where ${supportTickets.status} = 'OPEN' and ${supportTickets.assigneeId} is null)::int`,
        waiting: sql<number>`count(*) filter (where ${supportTickets.status} = 'WAITING')::int`,
        mine: sql<number>`count(*) filter (where ${supportTickets.status} <> 'RESOLVED' and ${supportTickets.assigneeId} = ${me})::int`,
        resolvedToday: sql<number>`count(*) filter (where ${supportTickets.resolvedAt} >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')::int`,
        all: count(),
        // Minutes from a request arriving to customer care's first reply, last 7 days
        firstReplyMinutes: sql<number | null>`round(percentile_cont(0.5) within group (order by extract(epoch from (${supportTickets.firstResponseAt} - ${supportTickets.createdAt})) / 60) filter (where ${supportTickets.firstResponseAt} is not null and ${supportTickets.createdAt} > now() - interval '7 days'))::int`,
        rating: sql<number | null>`round(avg(${supportTickets.rating}) filter (where ${supportTickets.rating} is not null and ${supportTickets.createdAt} > now() - interval '30 days'), 1)::float`,
        oldestOpen: sql<string | null>`min(${supportTickets.lastMessageAt}) filter (where ${supportTickets.status} = 'OPEN')`,
      })
      .from(supportTickets);
    return r;
  });

  app.get('/api/care/tickets', async (req) => {
    const q = parseBody(listQuery, req.query);
    const me = req.care!.staffId;
    const where: (SQL | undefined)[] = [
      q.view === 'needs_reply' ? eq(supportTickets.status, 'OPEN') : undefined,
      q.view === 'waiting' ? eq(supportTickets.status, 'WAITING') : undefined,
      q.view === 'resolved' ? eq(supportTickets.status, 'RESOLVED') : undefined,
      q.view === 'mine' ? and(eq(supportTickets.assigneeId, me), ne(supportTickets.status, 'RESOLVED')) : undefined,
      q.view === 'unassigned' ? and(isNull(supportTickets.assigneeId), eq(supportTickets.status, 'OPEN')) : undefined,
      q.category ? eq(supportTickets.category, q.category) : undefined,
      q.agency ? eq(supportTickets.tenantId, q.agency) : undefined,
    ];
    if (q.q) {
      const num = Number(q.q.replace(/^#/, ''));
      const l = like(q.q);
      where.push(or(Number.isInteger(num) && num > 0 ? eq(supportTickets.number, num) : undefined, ilike(supportTickets.subject, l), ilike(tenants.name, l), ilike(tenants.loginCode, l), ilike(users.name, l), ilike(users.email, l)));
    }
    // The queue that needs a reply: most urgent first, then whoever has waited longest
    const order = q.view === 'needs_reply' || q.view === 'unassigned' || q.view === 'mine' ? [PRIORITY_RANK, asc(supportTickets.lastMessageAt)] : [desc(supportTickets.lastMessageAt)];
    const rows = await db
      .select({
        id: supportTickets.id,
        number: supportTickets.number,
        subject: supportTickets.subject,
        category: supportTickets.category,
        priority: supportTickets.priority,
        status: supportTickets.status,
        unread: supportTickets.careUnread,
        lastMessageAt: supportTickets.lastMessageAt,
        createdAt: supportTickets.createdAt,
        firstResponseAt: supportTickets.firstResponseAt,
        rating: supportTickets.rating,
        assigneeId: supportTickets.assigneeId,
        assigneeName: careStaff.name,
        agencyId: tenants.id,
        agencyName: tenants.name,
        agencyStatus: tenants.status,
        plan: tenants.plan,
        planId: tenants.planId,
        seats: tenants.seats,
        requester: users.name,
        requesterRole: users.role,
      })
      .from(supportTickets)
      .innerJoin(tenants, eq(tenants.id, supportTickets.tenantId))
      .leftJoin(users, eq(users.id, supportTickets.userId))
      .leftJoin(careStaff, eq(careStaff.id, supportTickets.assigneeId))
      .where(and(...where))
      .orderBy(...order)
      .limit(150);
    const last = await lastMessages(
      rows.map((r) => r.id),
      { internal: true },
    );
    return {
      tickets: rows.map(({ plan, planId, seats, ...r }) => ({
        ...r,
        planLabel: planLabel({ plan, planId, seats }),
        priorityPlan: isPlanId(planId) && plan === 'PAID' && BILLING_PLANS[planId].prioritySupport,
        last: last.get(r.id) ?? null,
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/api/care/tickets/:id', async (req) => {
    const t = await ticketOr404(req.params.id);
    if (t.careUnread) await db.update(supportTickets).set({ careUnread: false }).where(eq(supportTickets.id, t.id));
    const requester = t.userId ? await db.query.users.findFirst({ where: eq(users.id, t.userId) }) : null;
    const assignee = t.assigneeId ? await db.query.careStaff.findFirst({ where: eq(careStaff.id, t.assigneeId), columns: { id: true, name: true } }) : null;
    return {
      ticket: { ...t, careUnread: false, assignee, device: deviceName(t.context.userAgent) },
      requester: requester
        ? { id: requester.id, name: requester.name, role: requester.role, email: requester.email, username: requester.username, lastLoginAt: requester.lastLoginAt, disabled: !!requester.disabledAt, createdAt: requester.createdAt }
        : null,
      messages: await thread(t.id, { internal: true }),
    };
  });

  app.post<{ Params: { id: string } }>('/api/care/tickets/:id/messages', async (req) => {
    const t = await ticketOr404(req.params.id);
    const body = parseBody(careReply, req.body);
    const me = req.care!;
    const message = await addMessage({ ticketId: t.id, author: 'CARE', staffId: me.staffId, body: body.body, internal: body.internal });
    if (body.internal) {
      await db.update(supportTickets).set({ assigneeId: t.assigneeId ?? me.staffId }).where(eq(supportTickets.id, t.id));
      return { message };
    }
    const now = new Date();
    const resolve = body.resolve;
    if (resolve) await addMessage({ ticketId: t.id, author: 'SYSTEM', body: `Marked solved by ${me.name.split(' ')[0]} from customer care` });
    await db
      .update(supportTickets)
      .set({
        status: resolve ? 'RESOLVED' : 'WAITING',
        resolvedAt: resolve ? now : null,
        agencyUnread: true,
        careUnread: false,
        firstResponseAt: t.firstResponseAt ?? now,
        lastMessageAt: now,
        assigneeId: t.assigneeId ?? me.staffId,
      })
      .where(eq(supportTickets.id, t.id));
    await notify(t.tenantId, {
      type: 'support.reply',
      level: resolve ? 'SUCCESS' : 'INFO',
      title: resolve ? `Customer care solved request ${t.number}` : `Customer care replied to request ${t.number}`,
      body: body.body.slice(0, 160),
      link: `/help/${t.id}`,
    });
    return { message };
  });

  app.patch<{ Params: { id: string } }>('/api/care/tickets/:id', async (req) => {
    const t = await ticketOr404(req.params.id);
    const body = parseBody(ticketPatch, req.body);
    const me = req.care!;
    const first = me.name.split(' ')[0];
    const set: Partial<typeof supportTickets.$inferInsert> = {};
    if (body.assigneeId !== undefined && body.assigneeId !== t.assigneeId) {
      const to = body.assigneeId ? await db.query.careStaff.findFirst({ where: and(eq(careStaff.id, body.assigneeId), isNull(careStaff.disabledAt)) }) : null;
      if (body.assigneeId && !to) throw new AppError(400, 'staff_not_found', 'That person isn’t in customer care');
      set.assigneeId = body.assigneeId;
      await addMessage({ ticketId: t.id, author: 'SYSTEM', internal: true, body: to ? (to.id === me.staffId ? `${me.name} took this request` : `${me.name} gave this request to ${to.name}`) : `${me.name} unassigned this request` });
    }
    if (body.priority && body.priority !== t.priority) {
      set.priority = body.priority;
      await addMessage({ ticketId: t.id, author: 'SYSTEM', internal: true, body: `${me.name} set priority to ${body.priority.toLowerCase()}` });
    }
    if (body.category && body.category !== t.category) set.category = body.category;
    if (body.status && body.status !== t.status) {
      set.status = body.status;
      set.resolvedAt = body.status === 'RESOLVED' ? new Date() : null;
      if (body.status === 'RESOLVED') {
        await addMessage({ ticketId: t.id, author: 'SYSTEM', body: `Marked solved by ${first} from customer care` });
        set.agencyUnread = true;
        await notify(t.tenantId, { type: 'support.resolved', level: 'SUCCESS', title: `Customer care solved request ${t.number}`, body: t.subject, link: `/help/${t.id}` });
      } else if (t.status === 'RESOLVED') {
        await addMessage({ ticketId: t.id, author: 'SYSTEM', body: `Reopened by ${first} from customer care` });
      }
    }
    if (Object.keys(set).length) await db.update(supportTickets).set(set).where(eq(supportTickets.id, t.id));
    return { ok: true };
  });

  app.get('/api/care/staff', async () => {
    const staff = await db.select({ id: careStaff.id, name: careStaff.name }).from(careStaff).where(isNull(careStaff.disabledAt)).orderBy(asc(careStaff.name));
    return { staff };
  });

  // Find an agency by its name, agency ID, an employee's name or email, or its WhatsApp number
  app.get('/api/care/agencies', async (req) => {
    const { q } = parseBody(agencyQuery, req.query);
    let ids: string[] | null = null;
    if (q) {
      const l = like(q);
      const digits = q.replace(/\D/g, '');
      const [byTenant, byUser, byPhone] = await Promise.all([
        db.select({ id: tenants.id }).from(tenants).where(or(ilike(tenants.name, l), ilike(tenants.loginCode, l), ilike(tenants.slug, l), eq(tenants.id, q))).limit(30),
        db.select({ id: users.tenantId }).from(users).where(or(ilike(users.name, l), ilike(users.email, l), ilike(users.username, l))).limit(30),
        digits.length >= 6 ? db.select({ id: whatsappSessions.tenantId }).from(whatsappSessions).where(ilike(whatsappSessions.phone, `%${digits}%`)).limit(10) : Promise.resolve([]),
      ]);
      ids = [...new Set([...byTenant, ...byUser, ...byPhone].map((r) => r.id))];
      if (!ids.length) return { agencies: [] };
    }
    const rows = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        loginCode: tenants.loginCode,
        businessType: tenants.businessType,
        status: tenants.status,
        plan: tenants.plan,
        planId: tenants.planId,
        seats: tenants.seats,
        paidUntil: tenants.paidUntil,
        trialEndsAt: tenants.trialEndsAt,
        createdAt: tenants.createdAt,
        ownerName: sql<string | null>`(select ${users.name} from ${users} where ${users.tenantId} = "tenants"."id" and ${users.role} = 'OWNER' limit 1)`,
        ownerEmail: sql<string | null>`(select ${users.email} from ${users} where ${users.tenantId} = "tenants"."id" and ${users.role} = 'OWNER' limit 1)`,
        logins: sql<number>`(select count(*)::int from ${users} where ${users.tenantId} = "tenants"."id")`,
        openRequests: sql<number>`(select count(*)::int from ${supportTickets} where ${supportTickets.tenantId} = "tenants"."id" and ${supportTickets.status} <> 'RESOLVED')`,
      })
      .from(tenants)
      .where(ids ? inArray(tenants.id, ids) : undefined)
      .orderBy(desc(tenants.createdAt))
      .limit(40);
    return { agencies: rows.map(({ plan, planId, seats, ...r }) => ({ ...r, planLabel: planLabel({ plan, planId, seats }), trial: plan === 'TRIAL' })) };
  });

  app.get<{ Params: { id: string } }>('/api/care/agencies/:id', async (req) => agencyProfile(req.params.id));

  /**
   * "Open account": a short support session inside the agency's own dashboard, acting as the owner,
   * so care can add or fix customers, employees, trips, WhatsApp… while talking to them. The owner
   * is told, every change is logged with the care person's name, and payments and the owner's
   * password stay locked. Only if the agency allows support access (on by default).
   */
  app.post<{ Params: { id: string } }>('/api/care/agencies/:id/open', async (req, reply) => {
    const body = parseBody(openBody, req.body);
    const t = await db.query.tenants.findFirst({ where: eq(tenants.id, req.params.id) });
    if (!t) throw new AppError(404, 'agency_not_found', 'Agency not found');
    if (!t.supportAccess) throw new AppError(403, 'support_access_off', 'This agency has switched off support access. Ask the owner to switch it on in Settings → Company, or to share their screen.');
    const owner = await db.query.users.findFirst({ where: and(eq(users.tenantId, t.id), eq(users.role, 'OWNER'), isNull(users.disabledAt)) });
    if (!owner) throw new AppError(409, 'no_owner', 'This agency has no active owner login to open.');
    const { token, expiresAt } = await createSupportSession({ userId: owner.id, tenantId: t.id, careStaffId: req.care!.staffId, reason: body.reason, minutes: body.minutes });
    setSessionCookie(reply, token, expiresAt);
    await db.insert(auditLogs).values({ tenantId: t.id, userId: owner.id, action: 'support.open', meta: { by: req.care!.name, careStaffId: req.care!.staffId, reason: body.reason, until: expiresAt } });
    const until = expiresAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: t.timezone });
    await notify(t.id, {
      userId: owner.id,
      type: 'support.open',
      level: 'INFO',
      title: `${req.care!.name} from Dhrona support is in your account`,
      body: `To help with: ${body.reason}. Their access ends by ${until}, and every change they make is in your history.`,
      link: '/settings',
    });
    return { ok: true, expiresAt };
  });

  // A file an agency attached to a request. Only files that are part of a request can be opened.
  app.get<{ Params: { id: string }; Querystring: { download?: string } }>('/api/care/attachments/:id', async (req, reply) => {
    const id = req.params.id;
    const [used] = await db
      .select({ n: count() })
      .from(supportMessages)
      .where(sql`${supportMessages.attachments} @> jsonb_build_array(jsonb_build_object('id', ${id}::text))`);
    if (!used?.n) throw new AppError(404, 'attachment_not_found', 'File not found');
    const a = await db.query.attachments.findFirst({ where: eq(attachments.id, id) });
    if (!a) throw new AppError(404, 'attachment_not_found', 'File not found');
    const inline = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|quicktime|3gpp)|audio\/[a-z0-9.+-]+)$/.test(a.type) && req.query.download === undefined;
    const ascii = a.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    return reply
      .header('content-type', inline ? a.type : 'application/octet-stream')
      .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.name)}`)
      .header('content-security-policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'")
      .header('cache-control', 'private, max-age=3600')
      .send(a.data);
  });
}

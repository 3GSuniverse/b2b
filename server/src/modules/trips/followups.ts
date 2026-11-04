import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditLogs, messages, quotes, senders, suppressions, tenants, tripFollowups, trips, type Contact, type Tenant, type TripMessageSettings } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError, parseBody } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import { enqueueEmails, enqueueWhatsApp } from '../../queues/index.js';
import { requireAuth, requireRole, tenantOf } from '../auth/guard.js';
import { findUnknownTags, renderString } from '../email/render.js';
import { trialEnded, whatsappWebAllowed } from '../plans/entitlements.js';
import { REMINDER_HOUR } from '../payments/reminders.js';
import { getSession } from '../whatsapp/service.js';
import { addDays, localDate } from './money.js';
import { quoteUrl } from '../quotes/service.js';

/**
 * Messages around a trip, each optional:
 *   PRE_TRIP    a few days before departure       (about their booking: a service message)
 *   REVIEW      the day after they're back         (marketing: needs their consent on that channel)
 *   WHERE_NEXT  a few months after they're back    (marketing)
 * Each trip gets each kind at most once (unique row in trip_followups).
 */

export type FollowupKind = 'PRE_TRIP' | 'REVIEW' | 'WHERE_NEXT' | 'QUOTE_FOLLOWUP';

export const FOLLOWUP_DEFAULTS = {
  PRE_TRIP: {
    days: 2,
    text: 'Hi {first_name}, your {trip} starts on {start_date}! We’re excited for you. If you have any questions before you leave, just reply to this message.\n\nHave a wonderful trip!\n{company_name}',
  },
  REVIEW: {
    days: 1,
    text: 'Hi {first_name}, welcome back from {destination}! We hope you had a wonderful time.\n\nCould you spare a minute to tell others about your trip? It helps a small agency like ours a lot: {review_link}\n\nThank you for travelling with {company_name}!',
  },
  QUOTE_FOLLOWUP: {
    days: 2,
    text: 'Hi {first_name}, just checking you got the quote for your {trip}. You can see the full plan and accept it here: {quote_link}\n\nHappy to change anything; just reply to this message.\n{company_name}',
  },
  WHERE_NEXT: {
    days: 90,
    text: 'Hi {first_name}, it’s been a few months since your {destination} trip. Thinking about the next one? Reply to this message and we’ll put together a few ideas for you.\n\n{company_name}',
  },
} as const;

export const FOLLOWUP_TAGS = ['first_name', 'full_name', 'trip', 'destination', 'start_date', 'return_date', 'company_name', 'review_link', 'quote_link'] as const;
/** A message missed by more than this (server down, switched on late) isn't sent: a "welcome back" a month later is worse than none. */
const WINDOW_DAYS = 3;

const KEY: Record<FollowupKind, 'preTrip' | 'review' | 'whereNext' | 'quoteFollowup'> = { PRE_TRIP: 'preTrip', REVIEW: 'review', WHERE_NEXT: 'whereNext', QUOTE_FOLLOWUP: 'quoteFollowup' };
const SUBJECT: Record<FollowupKind, (t: { title: string; destination: string | null }) => string> = {
  PRE_TRIP: (t) => `Your ${t.title} starts soon`,
  REVIEW: (t) => `Welcome back from ${t.destination ?? 'your trip'}`,
  WHERE_NEXT: () => 'Where to next?',
  QUOTE_FOLLOWUP: (t) => `Your quote for ${t.title}`,
};

export function resolvedTripMessages(t: Pick<Tenant, 'tripMessageSettings'>) {
  const s = (t.tripMessageSettings ?? {}) as TripMessageSettings;
  const one = (k: FollowupKind) => {
    const v = s[KEY[k]] ?? {};
    // Following up a quote the agency chose to send is on unless switched off; the rest are off unless switched on
    return { enabled: v.enabled ?? k === 'QUOTE_FOLLOWUP', days: v.days ?? FOLLOWUP_DEFAULTS[k].days, text: v.text ?? FOLLOWUP_DEFAULTS[k].text };
  };
  return {
    channel: s.channel ?? 'AUTO',
    preTrip: one('PRE_TRIP'),
    review: { ...one('REVIEW'), url: s.review?.url ?? null },
    whereNext: one('WHERE_NEXT'),
    quoteFollowup: one('QUOTE_FOLLOWUP'),
  };
}

const text = (k: FollowupKind) =>
  z
    .string()
    .trim()
    .min(20, 'Write a little more')
    .max(1000, 'Keep it under 1,000 characters')
    .superRefine((v, ctx) => {
      const unknown = findUnknownTags(v, FOLLOWUP_TAGS);
      if (unknown.length) ctx.addIssue({ code: 'custom', message: `Unknown tag${unknown.length > 1 ? 's' : ''}: ${unknown.map((u) => `{${u}}`).join(', ')}` });
      if (k === 'REVIEW' && !v.includes('{review_link}')) ctx.addIssue({ code: 'custom', message: 'Include {review_link}, so they can leave the review' });
      if (k === 'QUOTE_FOLLOWUP' && !v.includes('{quote_link}')) ctx.addIssue({ code: 'custom', message: 'Include {quote_link}, so they can open the quote' });
      if (k !== 'QUOTE_FOLLOWUP' && v.includes('{quote_link}')) ctx.addIssue({ code: 'custom', message: '{quote_link} only works in the quote follow-up' });
    });

export const tripMessagesBody = z.object({
  channel: z.enum(['AUTO', 'WHATSAPP', 'EMAIL']).optional(),
  preTrip: z.object({ enabled: z.boolean().optional(), days: z.coerce.number().int().min(1).max(14).optional(), text: text('PRE_TRIP').optional() }).optional(),
  review: z
    .object({
      enabled: z.boolean().optional(),
      days: z.coerce.number().int().min(0).max(14).optional(),
      text: text('REVIEW').optional(),
      url: z.string().trim().url('Paste the full link, starting with https://').max(500).nullable().optional(),
    })
    .optional(),
  whereNext: z.object({ enabled: z.boolean().optional(), days: z.coerce.number().int().min(14).max(730).optional(), text: text('WHERE_NEXT').optional() }).optional(),
  quoteFollowup: z.object({ enabled: z.boolean().optional(), days: z.coerce.number().int().min(1).max(14).optional(), text: text('QUOTE_FOLLOWUP').optional() }).optional(),
});

export async function updateTripMessages(tenantId: string, userId: string, input: z.infer<typeof tripMessagesBody>) {
  const t = (await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }))!;
  const next = structuredClone((t.tripMessageSettings ?? {}) as TripMessageSettings);
  if (input.channel) next.channel = input.channel;
  for (const k of ['PRE_TRIP', 'REVIEW', 'WHERE_NEXT', 'QUOTE_FOLLOWUP'] as const) {
    const part = input[KEY[k]];
    if (!part) continue;
    const cur = { ...(next[KEY[k]] ?? {}) } as Record<string, unknown>;
    for (const [field, value] of Object.entries(part)) {
      if (value === undefined) continue;
      // Our own wording isn't stored, so improvements to it reach everyone who didn't change it
      if (field === 'text' && value === FOLLOWUP_DEFAULTS[k].text) delete cur.text;
      else if (value === null) delete cur[field];
      else cur[field] = value;
    }
    (next as Record<string, unknown>)[KEY[k]] = cur;
  }
  const merged = resolvedTripMessages({ tripMessageSettings: next });
  if (merged.review.enabled && !merged.review.url) {
    throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: { 'review.url': 'Add your Google review link to switch this on' } });
  }
  const [row] = await db.update(tenants).set({ tripMessageSettings: next }).where(eq(tenants.id, tenantId)).returning();
  await db.insert(auditLogs).values({ tenantId, userId, action: 'trips.messages_settings', entity: 'tenant', entityId: tenantId, meta: { changed: Object.keys(input) } });
  return tripMessagesDto(row!);
}

export function tripMessagesDto(t: Pick<Tenant, 'tripMessageSettings'>) {
  return { ...resolvedTripMessages(t), defaults: Object.fromEntries(Object.entries(FOLLOWUP_DEFAULTS).map(([k, v]) => [k, v.text])), tags: FOLLOWUP_TAGS };
}

export async function tripMessageRoutes(app: FastifyInstance) {
  app.get('/api/trips/messages', { preHandler: requireAuth }, async (req) => ({
    settings: tripMessagesDto((await db.query.tenants.findFirst({ where: eq(tenants.id, tenantOf(req)) }))!),
  }));
  app.patch('/api/trips/messages', { preHandler: requireRole('ADMIN') }, async (req) => ({
    settings: await updateTripMessages(tenantOf(req), req.auth!.userId, parseBody(tripMessagesBody, req.body)),
  }));
}

// ---------------------------------------------------------------------

async function latestQuoteLink(tripId: string) {
  const [q] = await db.select({ token: quotes.publicToken }).from(quotes).where(and(eq(quotes.tripId, tripId), eq(quotes.status, 'SENT'))).orderBy(desc(quotes.version)).limit(1);
  return q ? quoteUrl(q.token) : '';
}

function humanDate(iso: string | null) {
  return iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
}

function pickChannel(
  pref: 'AUTO' | 'WHATSAPP' | 'EMAIL',
  c: Contact | null,
  marketing: boolean,
  whatsappUp: boolean,
  hasSender: boolean,
  blocked: { channel: string; reason: string }[],
) {
  if (!c) return null;
  const wa = whatsappUp && !!c.phone && !blocked.some((b) => b.channel === 'WHATSAPP') && (!marketing || c.whatsappStatus === 'SUBSCRIBED');
  const em =
    hasSender &&
    !!c.email &&
    (marketing ? c.emailStatus === 'SUBSCRIBED' && !blocked.some((b) => b.channel === 'EMAIL') : c.emailStatus !== 'BOUNCED' && c.emailStatus !== 'COMPLAINED' && !blocked.some((b) => b.channel === 'EMAIL' && b.reason !== 'UNSUBSCRIBE'));
  if (pref === 'WHATSAPP') return wa ? 'WHATSAPP' : null;
  if (pref === 'EMAIL') return em ? 'EMAIL' : null;
  return wa ? 'WHATSAPP' : em ? 'EMAIL' : null;
}

/** Runs every minute; sends at 10 am company time. */
export async function runTripFollowups(
  opts: { now?: Date; enqueueEmail?: (ids: string[]) => Promise<void>; enqueueWhatsApp?: (ids: string[]) => Promise<void> } = {},
) {
  const now = opts.now ?? new Date();
  const result = { sent: 0, skipped: 0 };
  // Only companies that switched something on
  const active = await db
    .select()
    .from(tenants)
    .where(
      and(
        eq(tenants.status, 'ACTIVE'),
        or(
          sql`(${tenants.tripMessageSettings} -> 'preTrip' ->> 'enabled')::boolean`,
          sql`(${tenants.tripMessageSettings} -> 'review' ->> 'enabled')::boolean`,
          sql`(${tenants.tripMessageSettings} -> 'whereNext' ->> 'enabled')::boolean`,
          sql`exists (select 1 from quotes q where q.tenant_id = ${tenants.id} and q.status = 'SENT')`,
        ),
      ),
    );
  for (const tenant of active) {
    try {
      if (trialEnded(tenant, now)) continue;
      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tenant.timezone, hour: '2-digit', hourCycle: 'h23' }).format(now));
      if (hour < REMINDER_HOUR) continue;
      const today = localDate(tenant.timezone, now);
      const s = resolvedTripMessages(tenant);

      // Which trips are due for which message today
      const wanted: { kind: FollowupKind; where: ReturnType<typeof sql> }[] = [];
      const last = sql`coalesce(${trips.endDate}, ${trips.startDate})`;
      if (s.preTrip.enabled) wanted.push({ kind: 'PRE_TRIP', where: sql`${trips.status} = 'BOOKED' and ${trips.startDate} > ${today}::date and ${trips.startDate} <= ${addDays(today, s.preTrip.days)}::date` });
      if (s.review.enabled && s.review.url)
        wanted.push({ kind: 'REVIEW', where: sql`${trips.status} in ('BOOKED','COMPLETED') and ${last} + ${s.review.days}::int <= ${today}::date and ${last} + ${s.review.days + WINDOW_DAYS}::int >= ${today}::date` });
      if (s.whereNext.enabled)
        wanted.push({ kind: 'WHERE_NEXT', where: sql`${trips.status} = 'COMPLETED' and ${last} + ${s.whereNext.days}::int <= ${today}::date and ${last} + ${s.whereNext.days + WINDOW_DAYS}::int >= ${today}::date` });
      if (s.quoteFollowup.enabled)
        wanted.push({
          kind: 'QUOTE_FOLLOWUP',
          where: sql`${trips.status} = 'QUOTED' and exists (select 1 from quotes q where q.trip_id = "trips"."id" and q.status = 'SENT'
            and (q.sent_at at time zone ${tenant.timezone})::date + ${s.quoteFollowup.days}::int <= ${today}::date
            and (q.sent_at at time zone ${tenant.timezone})::date + ${s.quoteFollowup.days + WINDOW_DAYS}::int >= ${today}::date)`,
        });
      if (!wanted.length) continue;

      const whatsappUp = whatsappWebAllowed(tenant, now) && (await getSession(tenant.id)).status === 'CONNECTED';
      const sender =
        (await db.query.senders.findFirst({ where: and(eq(senders.tenantId, tenant.id), eq(senders.isDefault, true)) })) ??
        (await db.query.senders.findFirst({ where: eq(senders.tenantId, tenant.id), orderBy: [asc(senders.createdAt)] }));

      for (const { kind, where } of wanted) {
        const rows = await db.query.trips.findMany({
          where: and(eq(trips.tenantId, tenant.id), where, sql`not exists (select 1 from trip_followups f where f.trip_id = "trips"."id" and f.kind = ${kind})`),
          with: { contact: true },
          limit: 500,
        });
        const setting = kind === 'PRE_TRIP' ? s.preTrip : kind === 'REVIEW' ? s.review : kind === 'QUOTE_FOLLOWUP' ? s.quoteFollowup : s.whereNext;
        // About their own booking or the quote they asked for: service messages. The rest need consent.
        const marketing = kind === 'REVIEW' || kind === 'WHERE_NEXT';
        for (const trip of rows) {
          const c = trip.contact;
          const blocked = c
            ? await db
                .select({ channel: suppressions.channel, reason: suppressions.reason })
                .from(suppressions)
                .where(and(eq(suppressions.tenantId, tenant.id), inArray(suppressions.address, [c.phone ?? '', c.email ?? ''].filter(Boolean))))
            : [];
          const channel = pickChannel(s.channel, c, marketing, whatsappUp, !!sender, blocked);
          const [claim] = await db
            .insert(tripFollowups)
            .values({ tenantId: tenant.id, tripId: trip.id, kind, channel, skipReason: channel ? null : !c ? 'contact_removed' : marketing ? 'no_consent_or_channel' : 'no_channel' })
            .onConflictDoNothing()
            .returning({ id: tripFollowups.id });
          if (!claim) continue;
          if (!channel) {
            result.skipped++;
            continue; // quietly: not everyone agreed to offers, and that's fine
          }
          const body = renderString(
            setting.text,
            {
              first_name: c!.firstName ?? trip.customerName.split(' ')[0] ?? '',
              full_name: [c!.firstName, c!.lastName].filter(Boolean).join(' ') || trip.customerName,
              trip: trip.title,
              destination: trip.destination ?? trip.title,
              start_date: humanDate(trip.startDate),
              return_date: humanDate(trip.endDate ?? trip.startDate),
              company_name: tenant.name,
              review_link: s.review.url ?? '',
              quote_link: kind === 'QUOTE_FOLLOWUP' ? await latestQuoteLink(trip.id) : '',
            },
            { html: false },
          );
          const [msg] = await db
            .insert(messages)
            .values({
              tenantId: tenant.id,
              tripId: trip.id,
              contactId: c!.id,
              senderId: channel === 'EMAIL' ? sender!.id : null,
              channel,
              toAddress: channel === 'EMAIL' ? c!.email!.toLowerCase() : c!.phone!,
              subject: channel === 'EMAIL' ? SUBJECT[kind](trip) : null,
              body,
              service: !marketing,
            })
            .returning({ id: messages.id });
          await db.update(tripFollowups).set({ messageId: msg!.id }).where(eq(tripFollowups.id, claim.id));
          await db.insert(auditLogs).values({ tenantId: tenant.id, userId: null, action: 'trip.followup', entity: 'trip', entityId: trip.id, meta: { kind, channel } });
          if (channel === 'EMAIL') await (opts.enqueueEmail ?? enqueueEmails)([msg!.id]);
          else await (opts.enqueueWhatsApp ?? enqueueWhatsApp)([msg!.id]);
          result.sent++;
        }
      }
    } catch (err) {
      logger.error({ err, tenantId: tenant.id }, 'trip messages failed');
    }
  }
  return result;
}

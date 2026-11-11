import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { quotes, tenants } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { parseBody } from '../../lib/http.js';
import { requireAuth, requireRole, tenantOf } from '../auth/guard.js';
import { escapeHtml as e } from '../email/render.js';
import { d, layout, notFound, prettyPhone, range, send, waLink } from '../payments/public.js';
import { resolvedSettings } from '../payments/settings.js';
import { aiEnabled, draftBody, draftQuote } from '../ai/quote-draft.js';
import { entitlements } from '../plans/entitlements.js';
import { formatInr, localDate } from '../trips/money.js';
import type { Actor } from '../trips/service.js';
import {
  acceptQuote,
  archiveRate,
  createQuote,
  createRate,
  declineQuote,
  deleteQuote,
  getQuote,
  listQuotes,
  listRates,
  markViewed,
  quoteBody,
  quoteTotals,
  rateBody,
  sendQuote,
  updateQuote,
  updateRate,
} from './service.js';

const actor = (req: FastifyRequest): Actor => ({ tenantId: tenantOf(req), userId: req.auth!.userId });
type Id = { Params: { id: string } };

const UNIT: Record<string, string> = { PER_NIGHT: 'night', PER_DAY: 'day', PER_PERSON: 'person', PER_GROUP: 'group' };
const KIND: Record<string, string> = { HOTEL: 'Stay', TRANSPORT: 'Getting around', ACTIVITY: 'Sightseeing and activities', TRAVEL: 'Travel', OTHER: 'Also included' };

const QUOTE_CSS = `
.days{display:flex;flex-direction:column;gap:0}
.day{display:grid;grid-template-columns:44px 1fr;gap:12px;padding:14px 0;border-top:1px solid var(--soft)}
.day:first-child{border-top:0;padding-top:4px}
.day .n{width:40px;height:40px;border-radius:12px;background:var(--accent-soft);color:var(--accent-strong);display:grid;place-items:center;font-weight:700;font-size:13px;line-height:1.05;text-align:center}
.day h3{margin:0;font-size:15px}.day .date{font-size:12px;color:var(--muted)}
.day p{margin:6px 0 0;font-size:14px;color:var(--ink2);white-space:pre-wrap}
ul.list{margin:0;padding-left:18px;font-size:14px;color:var(--ink2)}ul.list li{margin:4px 0}
.items .row .l{font-size:14px}
details summary{cursor:pointer;color:var(--muted);font-size:14px;text-align:center;padding:10px;list-style:none}
details summary::-webkit-details-marker{display:none}
textarea{width:100%;min-height:90px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;font:inherit;resize:vertical;margin:8px 0}
.per{font-size:14px;color:var(--muted)}
.banner{background:#e8edf5;color:#2b4a73;border-radius:12px;padding:10px 14px;font-size:13px;font-weight:600;text-align:center}
`;

export async function quoteRoutes(app: FastifyInstance) {
  // ---- Price list
  app.get('/api/rates', { preHandler: requireAuth }, async (req) => {
    const q = parseBody(z.object({ destination: z.string().max(80).optional(), search: z.string().max(80).optional() }), req.query);
    return { rates: await listRates(tenantOf(req), q) };
  });
  app.post('/api/rates', { preHandler: requireAuth }, async (req, reply) => reply.code(201).send({ rate: await createRate(tenantOf(req), parseBody(rateBody, req.body)) }));
  app.patch<Id>('/api/rates/:id', { preHandler: requireAuth }, async (req) => ({ rate: await updateRate(tenantOf(req), req.params.id, parseBody(rateBody.partial(), req.body)) }));
  app.delete<Id>('/api/rates/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    await archiveRate(tenantOf(req), req.params.id);
    return reply.code(204).send();
  });

  // ---- Quotes
  app.get<Id>('/api/trips/:id/quotes', { preHandler: requireAuth }, async (req) => ({ quotes: await listQuotes(tenantOf(req), req.params.id) }));
  app.post<Id>('/api/trips/:id/quotes', { preHandler: requireAuth }, async (req, reply) => reply.code(201).send({ quote: await createQuote(actor(req), req.params.id) }));
  app.get<Id>('/api/quotes/:id', { preHandler: requireAuth }, async (req) => ({ quote: await getQuote(tenantOf(req), req.params.id) }));
  app.patch<Id>('/api/quotes/:id', { preHandler: requireAuth }, async (req) => ({ quote: await updateQuote(actor(req), req.params.id, parseBody(quoteBody, req.body)) }));
  app.delete<Id>('/api/quotes/:id', { preHandler: requireAuth }, async (req, reply) => {
    await deleteQuote(actor(req), req.params.id);
    return reply.code(204).send();
  });
  // enabled: Drona AI can be used here (the server has an AI key and the agency's plan includes it)
  app.get('/api/ai', { preHandler: requireAuth }, async (req) => {
    const t = (await db.query.tenants.findFirst({ where: eq(tenants.id, tenantOf(req)) }))!;
    const plan = entitlements(t);
    return { enabled: aiEnabled() && plan.ai, configured: aiEnabled(), inPlan: plan.ai, perDay: plan.aiPerDay };
  });
  app.post<Id>('/api/quotes/:id/draft', { preHandler: requireAuth, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req) => ({
    draft: await draftQuote(tenantOf(req), req.auth!.userId, req.params.id, parseBody(draftBody, req.body)),
  }));
  app.post<Id>('/api/quotes/:id/send', { preHandler: requireAuth }, async (req) => ({
    quote: await sendQuote(actor(req), req.params.id, parseBody(z.object({ via: z.enum(['EMAIL', 'MANUAL']) }), req.body).via),
  }));

  // ---- The customer's quote page
  const TOKEN = /^[a-z0-9]{40,80}$/i;
  app.get<{ Params: { token: string }; Querystring: { preview?: string; done?: string } }>('/q/:token', async (req, reply) => {
    if (!TOKEN.test(req.params.token)) return notFound(reply);
    const q = await db.query.quotes.findFirst({ where: eq(quotes.publicToken, req.params.token), with: { trip: true } });
    if (!q) return notFound(reply);
    const trip = q.trip;
    const tenant = (await db.query.tenants.findFirst({ where: eq(tenants.id, trip.tenantId) }))!;
    // A newer version was sent: send them to it
    const newer = await db.query.quotes.findFirst({ where: and(eq(quotes.tripId, trip.id), eq(quotes.version, q.version + 1)) });
    if (newer && newer.status !== 'DRAFT') return reply.redirect(`/q/${newer.publicToken}`, 303);
    if (!req.query.preview && q.status !== 'DRAFT') await markViewed(q.id);

    const s = resolvedSettings(tenant);
    const today = localDate(tenant.timezone);
    const travellers = trip.adults + trip.children;
    const t = quoteTotals(q.lines, q.discount, travellers);
    const expired = q.status === 'SENT' && q.validUntil && q.validUntil < today;
    const ask = waLink(s.contactPhone, `Hi, about the quote for ${trip.title} (trip #${trip.number}): `);

    const brand = `<div class="brand"><span>${e(tenant.name)}</span><small>Quote ${q.version > 1 ? `v${q.version} ` : ''}· ${tenant.businessType === 'TRAVEL' ? 'Trip' : 'Order'} #${trip.number}</small></div>`;
    const draft = q.status === 'DRAFT' ? `<div class="banner">Preview. The customer can’t see this until you send it.</div>` : '';
    const head = `<div class="card"><h1>${e(trip.title)}</h1><div class="meta">${[e(`For ${trip.customerName}`), e(range(trip.startDate, trip.endDate)), `${travellers} traveller${travellers === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</div>${q.intro ? `<p style="margin:14px 0 0;color:var(--ink2)">${e(q.intro)}</p>` : ''}</div>`;

    let action = '';
    if (q.status === 'ACCEPTED') {
      action = `<div class="card paid"><div class="due-label">Accepted on ${d(q.respondedAt!.toISOString())}</div><div class="meta" style="margin:4px 0 12px">Thank you! The next step is the advance, which confirms your booking.</div><a class="btn" href="/p/${trip.publicToken}">See payment details</a></div>`;
    } else if (q.status === 'DECLINED') {
      action = `<div class="card"><div class="due-label">You asked for changes</div><div class="meta">${e(tenant.name)} will get back to you with an updated plan.</div></div>`;
    } else if (expired) {
      action = `<div class="card"><div class="due-label">This quote expired on ${d(q.validUntil)}</div><div class="meta" style="margin-bottom:12px">Prices and availability may have changed. Ask us for an updated one.</div>${ask ? `<a class="btn" href="${e(ask)}">Ask on WhatsApp</a>` : ''}</div>`;
    } else if (q.status === 'SENT') {
      const done = req.query.done;
      action = `${done === 'declined' ? '<div class="banner">Thanks, we’ve told them. They’ll be in touch.</div>' : ''}
<form method="post" action="/q/${q.publicToken}/accept" class="stack" style="margin-top:0"><button class="btn" type="submit">Accept this quote</button></form>
<details class="card" style="padding:4px 16px"><summary>Want something changed?</summary><form method="post" action="/q/${q.publicToken}/decline"><textarea name="note" maxlength="1000" placeholder="Tell us what you’d like different: dates, hotels, budget…"></textarea><button class="btn secondary" type="submit" style="margin-bottom:14px">Send to ${e(tenant.name)}</button></form></details>
${ask ? `<p class="note" style="text-align:center;margin:0">Questions? <a href="${e(ask)}">Ask on WhatsApp</a></p>` : ''}`;
    }

    const price = `<div class="card"><div class="due-label">Total${tenant.businessType === 'TRAVEL' ? ` for ${travellers} traveller${travellers === 1 ? '' : 's'}` : ''}</div><div class="amount">${formatInr(t.total)}</div>${t.perPerson && travellers > 1 ? `<div class="per">${formatInr(t.perPerson)} per person</div>` : ''}${q.discount > 0 ? `<div class="per">Includes a discount of ${formatInr(q.discount)}</div>` : ''}${q.validUntil && !expired && q.status === 'SENT' ? `<p class="note">Valid until ${d(q.validUntil)}</p>` : ''}</div>`;

    const start = trip.startDate;
    const days = q.days.length
      ? `<div class="card"><h2>Day by day</h2><div class="days">${q.days
          .map((day, i) => {
            const date = start ? d(new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10)) : '';
            return `<div class="day"><div class="n">Day<br>${i + 1}</div><div>${date ? `<div class="date">${e(date)}</div>` : ''}<h3>${e(day.title || `Day ${i + 1}`)}</h3>${day.description ? `<p>${e(day.description)}</p>` : ''}</div></div>`;
          })
          .join('')}</div></div>`
      : '';

    const groups = new Map<string, string[]>();
    for (const l of q.lines) {
      const qty = l.unit === 'PER_PERSON' ? `${l.quantity} ${l.quantity === 1 ? 'person' : 'people'}` : l.unit === 'PER_GROUP' ? '' : `${l.quantity} × ${l.times} ${UNIT[l.unit]}${l.times === 1 ? '' : 's'}`;
      groups.set(l.kind, [...(groups.get(l.kind) ?? []), `<div class="row"><div class="l">${e(l.label)}</div><div class="r" style="font-weight:500;color:var(--muted);font-size:13px">${e(qty)}</div></div>`]);
    }
    const items = q.lines.length
      ? `<div class="card items"><h2>What’s in the package</h2>${[...groups.entries()].map(([k, rows]) => `<div style="margin-top:10px"><div style="font-size:12px;font-weight:600;color:var(--faint);margin-bottom:2px">${KIND[k]}</div>${rows.join('')}</div>`).join('')}</div>`
      : '';
    const list = (title: string, xs: string[]) => (xs.length ? `<div class="card"><h2>${title}</h2><ul class="list">${xs.map((x) => `<li>${e(x)}</li>`).join('')}</ul></div>` : '');
    const terms = q.terms ? `<div class="card"><h2>Good to know</h2><p style="margin:0;font-size:14px;color:var(--ink2);white-space:pre-wrap">${e(q.terms)}</p></div>` : '';
    const footer = `<footer>${[tenant.name, tenant.postalAddress, prettyPhone(s.contactPhone)].filter(Boolean).map((x) => e(x!)).join('<br>')}</footer>
<div class="stack noprint" style="margin-top:0"><button class="btn secondary" type="button" data-print>Save as PDF</button></div>`;

    return send(reply, layout(`Quote: ${trip.title} · ${tenant.name}`, `${brand}${draft}${head}${price}${action}${days}${items}${list('Included', q.inclusions)}${list('Not included', q.exclusions)}${terms}${footer}`, QUOTE_CSS));
  });

  app.post<{ Params: { token: string } }>('/q/:token/accept', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!TOKEN.test(req.params.token)) return notFound(reply);
    const q = await acceptQuote(req.params.token);
    if (!q) return notFound(reply);
    return reply.redirect(`/q/${req.params.token}`, 303);
  });

  app.post<{ Params: { token: string }; Body: { note?: string } }>('/q/:token/decline', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!TOKEN.test(req.params.token)) return notFound(reply);
    const note = String((req.body as { note?: unknown } | undefined)?.note ?? '').trim().slice(0, 1000);
    const q = await declineQuote(req.params.token, note);
    if (!q) return notFound(reply);
    return reply.redirect(`/q/${req.params.token}?done=declined`, 303);
  });
}


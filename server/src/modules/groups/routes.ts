import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { tenants, trips } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError, parseBody } from '../../lib/http.js';
import { requireAuth, requireRole, tenantOf } from '../auth/guard.js';
import { escapeHtml as e } from '../email/render.js';
import { layout, notFound, range, send } from '../payments/public.js';
import type { Actor } from '../trips/service.js';
import {
  addBooking,
  autoAssign,
  broadcast,
  broadcastBody,
  createGroup,
  getGroup,
  groupBody,
  groupBookingBody,
  ID_TYPES,
  listGroups,
  listTravellers,
  revealIds,
  saveTravellers,
  travellerIn,
  updateGroup,
} from './service.js';

const actor = (req: FastifyRequest): Actor => ({ tenantId: tenantOf(req), userId: req.auth!.userId });
type Id = { Params: { id: string } };

const ID_LABEL: Record<string, string> = { AADHAAR: 'Aadhaar', PASSPORT: 'Passport', VOTER_ID: 'Voter ID', DRIVING_LICENCE: 'Driving licence', PAN: 'PAN', OTHER: 'Other' };
const FORM_CSS = `
fieldset{border:1px solid var(--line);border-radius:16px;padding:16px;margin:0;background:var(--surface);display:grid;grid-template-columns:1fr 1fr;gap:12px}
legend{font-weight:700;font-size:14px;padding:0 6px}
label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:600;color:var(--ink2)}
label.full{grid-column:1/-1}
input,select{height:44px;border:1px solid var(--line);border-radius:10px;padding:0 12px;font:inherit;font-weight:400;background:#fff;color:var(--ink);width:100%}
small{font-weight:400;color:var(--muted);font-size:12px}
.err{background:var(--danger-soft);color:var(--danger);border-radius:12px;padding:10px 14px;font-size:14px}
`;

export async function groupRoutes(app: FastifyInstance) {
  app.get('/api/groups', { preHandler: requireAuth }, async (req) => ({ groups: await listGroups(tenantOf(req)) }));
  app.post('/api/groups', { preHandler: requireAuth }, async (req, reply) => {
    const g = await createGroup(actor(req), parseBody(groupBody, req.body));
    return reply.code(201).send({ group: await getGroup(tenantOf(req), g.id) });
  });
  app.get<Id>('/api/groups/:id', { preHandler: requireAuth }, async (req) => ({ group: await getGroup(tenantOf(req), req.params.id) }));
  app.patch<Id>('/api/groups/:id', { preHandler: requireAuth }, async (req) => ({
    group: await updateGroup(actor(req), req.params.id, parseBody(groupBody.partial().extend({ status: z.enum(['BOOKED', 'CANCELLED', 'COMPLETED']).optional() }), req.body)),
  }));
  app.post<Id>('/api/groups/:id/bookings', { preHandler: requireAuth }, async (req, reply) => reply.code(201).send({ trip: await addBooking(actor(req), req.params.id, parseBody(groupBookingBody, req.body)) }));
  app.post<Id>('/api/groups/:id/assign', { preHandler: requireAuth }, async (req) => ({ group: await autoAssign(actor(req), req.params.id) }));
  app.post<Id>('/api/groups/:id/broadcast', { preHandler: requireAuth, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => broadcast(actor(req), req.params.id, parseBody(broadcastBody, req.body)));
  // Full ID numbers, for the passenger manifest. Admins only; every look is logged.
  app.post<Id>('/api/groups/:id/ids', { preHandler: requireRole('ADMIN') }, async (req) => ({ ids: await revealIds(tenantOf(req), req.auth!.userId, req.params.id) }));

  app.get<Id>('/api/trips/:id/travellers', { preHandler: requireAuth }, async (req) => ({ travellers: await listTravellers(tenantOf(req), req.params.id) }));
  app.put<Id>('/api/trips/:id/travellers', { preHandler: requireAuth }, async (req) => ({
    travellers: await saveTravellers(tenantOf(req), req.params.id, parseBody(z.object({ travellers: z.array(travellerIn).max(300) }), req.body).travellers),
  }));

  // ---- The customer fills in their party's details: /p/:token/travellers
  const TOKEN = /^[a-z0-9]{40,80}$/i;
  async function page(token: string) {
    if (!TOKEN.test(token)) return null;
    const trip = await db.query.trips.findFirst({ where: eq(trips.publicToken, token), with: { travellers: { orderBy: (t, { asc }) => [asc(t.position)] } } });
    if (!trip || trip.status === 'LOST' || trip.status === 'CANCELLED') return null;
    const tenant = (await db.query.tenants.findFirst({ where: eq(tenants.id, trip.tenantId) }))!;
    return { trip, tenant };
  }

  function form(p: NonNullable<Awaited<ReturnType<typeof page>>>, error?: string, saved?: boolean) {
    const { trip, tenant } = p;
    const n = Math.max(1, trip.adults + trip.children, trip.travellers.length);
    const sel = (name: string, value: string | null, opts: [string, string][]) =>
      `<select name="${name}"><option value="">Choose</option>${opts.map(([v, l]) => `<option value="${v}"${value === v ? ' selected' : ''}>${e(l)}</option>`).join('')}</select>`;
    const blocks = Array.from({ length: n }, (_, i) => {
      const t = trip.travellers[i];
      const v = (x: string | number | null | undefined) => e(x === null || x === undefined ? '' : String(x));
      return `<fieldset><legend>Traveller ${i + 1}${i === 0 ? ' (you)' : ''}</legend>
<input type="hidden" name="t${i}_id" value="${v(t?.id)}">
<label class="full">Full name, as on the ID<input name="t${i}_name" value="${v(t?.name)}" autocomplete="${i === 0 ? 'name' : 'off'}"></label>
<label>Age<input name="t${i}_age" type="number" min="0" max="120" inputmode="numeric" value="${v(t?.age)}"></label>
<label>Gender${sel(`t${i}_gender`, t?.gender ?? null, [['F', 'Female'], ['M', 'Male'], ['O', 'Other']])}</label>
<label>ID type${sel(`t${i}_idType`, t?.idType ?? null, ID_TYPES.map((x) => [x, ID_LABEL[x]!]))}</label>
<label>ID number${t?.idLast4 ? ` <small>on file: ending ${e(t.idLast4)}. Leave empty to keep it.</small>` : ''}<input name="t${i}_idNumber" autocomplete="off" spellcheck="false"></label>
<label>Food${sel(`t${i}_food`, t?.food ?? null, [['VEG', 'Vegetarian'], ['NON_VEG', 'Non-vegetarian'], ['JAIN', 'Jain'], ['OTHER', 'Other']])}</label>
<label>Phone <small>optional</small><input name="t${i}_phone" type="tel" inputmode="tel" value="${v(t?.phone)}"></label>
<label class="full">Anything we should know? <small>Medical needs, wheelchair, a lower berth…</small><input name="t${i}_needs" value="${v(t?.needs)}"></label>
${i === 0 ? `<label>Emergency contact name<input name="t${i}_emergencyName" value="${v(t?.emergencyName)}"></label><label>Their phone<input name="t${i}_emergencyPhone" type="tel" inputmode="tel" value="${v(t?.emergencyPhone)}"></label>` : ''}
</fieldset>`;
    }).join('');
    const body = `<div class="brand"><span>${e(tenant.name)}</span><small>Trip #${trip.number}</small></div>
<div class="card"><h1>Traveller details</h1><div class="meta">${e(trip.title)}${trip.startDate ? ` · ${e(range(trip.startDate, trip.endDate))}` : ''}</div>
<p class="note" style="margin-top:10px">We need these for tickets, hotel check-in and permits. ID numbers are stored encrypted and only used for your booking.</p></div>
${saved ? `<div class="card paid"><div class="due-label">Saved, thank you!</div><div class="meta" style="margin:0">You can come back to this page to change anything.</div></div>` : ''}
${error ? `<div class="err">${e(error)}</div>` : ''}
<form method="post" class="stack" style="margin-top:0;gap:14px">${blocks}<button class="btn" type="submit">Save details</button></form>
<a class="btn secondary" href="/p/${trip.publicToken}">Back to your trip</a>`;
    return layout(`Traveller details · ${tenant.name}`, body, FORM_CSS);
  }

  app.get<{ Params: { token: string }; Querystring: { saved?: string } }>('/p/:token/travellers', async (req, reply) => {
    const p = await page(req.params.token);
    return p ? send(reply, form(p, undefined, !!req.query.saved)) : notFound(reply);
  });

  app.post<{ Params: { token: string } }>('/p/:token/travellers', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const p = await page(req.params.token);
    if (!p) return notFound(reply);
    const body = (req.body ?? {}) as Record<string, string>;
    const n = Math.max(1, p.trip.adults + p.trip.children, p.trip.travellers.length);
    const list = [];
    for (let i = 0; i < n; i++) {
      const g = (k: string) => (body[`t${i}_${k}`] ?? '').trim();
      if (!g('name')) continue; // blank traveller: not filled in yet
      list.push({ id: g('id') || undefined, name: g('name'), age: g('age') ? Number(g('age')) : null, gender: g('gender') || null, phone: g('phone') || null, idType: g('idType') || null, idNumber: g('idNumber') || null, food: g('food') || null, needs: g('needs') || null, emergencyName: g('emergencyName') || null, emergencyPhone: g('emergencyPhone') || null });
    }
    try {
      const parsed = z.array(travellerIn).parse(list);
      await saveTravellers(p.trip.tenantId, p.trip.id, parsed, { byCustomer: true });
    } catch (err) {
      const msg = err instanceof AppError && (err.details as { fields?: Record<string, string> })?.fields
        ? Object.entries((err.details as { fields: Record<string, string> }).fields).map(([k, v]) => `Traveller ${Number(k.split('.')[0]) + 1}: ${v}`).join('. ')
        : err instanceof z.ZodError
          ? 'Please check the details and try again.'
          : err instanceof AppError
            ? err.message
            : 'Something went wrong. Please try again.';
      return send(reply, form((await page(req.params.token))!, msg), 400);
    }
    return reply.redirect(`/p/${req.params.token}/travellers?saved=1`, 303);
  });
}


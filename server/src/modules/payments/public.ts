import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import QRCode from 'qrcode';
import { tenants, tripPayments, trips } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { escapeHtml as e } from '../email/render.js';
import { formatInr, localDate, tripMoney, type DueInput } from '../trips/money.js';
import { resolvedSettings } from './settings.js';
import { rupeesInWords, upiLink } from './upi.js';

/**
 * Pages customers open from a WhatsApp or email link, without signing in:
 *   /p/:token  their trip: what's due, pay by UPI, receipts
 *   /r/:token  one receipt, printable
 * The tokens are long and random; nothing else identifies the trip.
 */

const METHOD: Record<string, string> = { UPI: 'UPI', CASH: 'Cash', BANK: 'Bank transfer', CARD: 'Card', ONLINE: 'Online payment', OTHER: 'Other' };

export function d(iso: string | null | undefined, withYear = true) {
  if (!iso) return '';
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: iso.length === 10 ? 'UTC' : 'Asia/Kolkata' });
}

export function range(start: string | null, end: string | null) {
  if (!start) return '';
  return end && end !== start ? `${d(start, false)} – ${d(end)}` : d(start);
}

export const PUBLIC_CSS = `
:root{--ground:#f5f6f4;--surface:#fff;--ink:#111816;--ink2:#3a433f;--muted:#59625e;--faint:#8a928e;--line:#e3e6e3;--soft:#eef0ee;--accent:#0b7a62;--accent-soft:#e4f2ed;--accent-strong:#075c49;--warm-soft:#fceee3;--warm-strong:#8a3d07;--danger:#b42318;--danger-soft:#fdecea}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--ground);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-variant-numeric:tabular-nums}
main{max-width:560px;margin:0 auto;padding:20px 16px 48px;display:flex;flex-direction:column;gap:16px}
.brand{font-weight:700;font-size:15px;letter-spacing:-.01em;display:flex;justify-content:space-between;align-items:center;gap:12px}
.brand small{font-weight:500;color:var(--muted);font-size:13px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:20px}
h1{font-size:24px;line-height:1.2;letter-spacing:-.02em;margin:0}
h2{font-size:13px;font-weight:600;color:var(--muted);margin:0 0 10px}
.meta{color:var(--muted);font-size:14px;margin-top:6px}
.due-label{font-size:13px;font-weight:600;color:var(--muted)}
.amount{font-size:36px;font-weight:700;letter-spacing:-.03em;line-height:1.1;margin:6px 0 4px}
.overdue .due-label,.overdue .amount{color:var(--danger)}
.paid{background:var(--accent-soft);border-color:#c9e6dc}.paid .due-label,.paid .amount{color:var(--accent-strong)}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:48px;border-radius:12px;border:0;background:var(--ink);color:#fff;font-weight:600;font-size:15px;line-height:1;font-family:inherit;text-decoration:none;cursor:pointer}
.btn.secondary{background:var(--surface);color:var(--ink);border:1px solid var(--line)}
.upi{display:grid;grid-template-columns:132px 1fr;gap:16px;align-items:center;margin-top:16px;padding-top:16px;border-top:1px solid var(--soft)}
.upi img{width:132px;height:132px;border-radius:10px;border:1px solid var(--soft)}
.upi p{margin:0 0 6px;font-size:13px;color:var(--muted)}
.upi code{font:600 13px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink);overflow-wrap:anywhere}
.copy{margin-top:8px;font-weight:600;font-size:13px;line-height:1;font-family:inherit;color:var(--accent);background:none;border:0;padding:0;cursor:pointer}
.stack{display:flex;flex-direction:column;gap:10px;margin-top:16px}
.note{font-size:13px;color:var(--muted);margin:12px 0 0}
.row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--soft)}
.row:first-of-type{border-top:0;padding-top:0}
.row .l{display:flex;flex-direction:column;min-width:0}.row .l span{font-size:13px;color:var(--muted)}
.row .r{text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-weight:600}
.pill{display:inline-block;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;background:var(--soft);color:var(--ink2)}
.pill.PAID{background:var(--accent-soft);color:var(--accent-strong)}.pill.OVERDUE{background:var(--danger-soft);color:var(--danger)}
.pill.DUE_TODAY{background:var(--warm-soft);color:var(--warm-strong)}.pill.PART_PAID{background:#e8edf5;color:#2b4a73}
a{color:var(--accent)}
footer{font-size:12px;color:var(--muted);text-align:center;line-height:1.6}
@media (max-width:380px){.upi{grid-template-columns:1fr}.upi img{margin:0 auto}}
/* Receipt */
.receipt{padding:28px}
.rhead{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:1px solid var(--soft);padding-bottom:18px;margin-bottom:18px}
.rhead .co{font-weight:700;font-size:17px}.rhead .addr{font-size:12px;color:var(--muted);margin-top:4px;max-width:260px}
.rhead .title{text-align:right}.rhead .title b{display:block;font-size:13px;letter-spacing:.04em;color:var(--muted)}.rhead .title span{font-size:13px;color:var(--muted)}
.box{background:var(--ground);border-radius:12px;padding:16px;margin:16px 0}
.words{font-size:13px;color:var(--ink2)}
dl{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;margin:0;font-size:14px}dt{color:var(--muted)}dd{margin:0;text-align:right}
.void{border:2px solid var(--danger);color:var(--danger);border-radius:10px;padding:10px 14px;font-weight:700;text-align:center;margin-bottom:16px}
@media print{body{background:#fff}main{padding:0}.card{border:0}.noprint{display:none!important}}
`;

export function layout(title: string, body: string, extraCss = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${e(title)}</title><style>${PUBLIC_CSS}${extraCss}</style></head><body><main>${body}</main><script src="/p/page.js" defer></script></body></html>`;
}

export function send(reply: FastifyReply, html: string, status = 200) {
  return reply
    .code(status)
    .header('content-type', 'text/html; charset=utf-8')
    .header('cache-control', 'no-store') // balances change; never show an old one
    .header('x-robots-tag', 'noindex, nofollow')
    .header('referrer-policy', 'no-referrer') // the token must not leak to sites linked from the page
    .send(html);
}

export const notFound = (reply: FastifyReply) =>
  send(reply, layout('Link not found', `<div class="card"><h1>This link doesn’t work</h1><p class="meta">It may have been mistyped. Ask the travel agent to send it again.</p></div>`), 404);

/** +919848022338 → +91 98480 22338 */
export function prettyPhone(p: string | null) {
  const m = p ? /^\+91(\d{5})(\d{5})$/.exec(p) : null;
  return m ? `+91 ${m[1]} ${m[2]}` : p;
}

export function waLink(phone: string | null, text: string) {
  return phone ? `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}` : null;
}

export async function publicPaymentRoutes(app: FastifyInstance) {
  // The only script these pages use: print, and copy the UPI ID. Served from here so the CSP stays 'self'-only.
  app.get('/p/page.js', async (_req, reply) =>
    reply
      .header('content-type', 'application/javascript; charset=utf-8')
      .header('cache-control', 'public, max-age=86400')
      .send(
        `document.addEventListener('click',function(ev){var t=ev.target.closest('[data-print],[data-copy]');if(!t)return;if(t.hasAttribute('data-print')){window.print();return}navigator.clipboard&&navigator.clipboard.writeText(t.getAttribute('data-copy')).then(function(){var o=t.textContent;t.textContent='Copied';setTimeout(function(){t.textContent=o},1500)})});`,
      ),
  );

  app.get<{ Params: { token: string } }>('/p/:token', async (req, reply) => {
    if (!/^[a-z0-9]{40,80}$/i.test(req.params.token)) return notFound(reply);
    const trip = await db.query.trips.findFirst({ where: eq(trips.publicToken, req.params.token), with: { dues: true, payments: true, contact: true } });
    if (!trip) return notFound(reply);
    const tenant = (await db.query.tenants.findFirst({ where: eq(tenants.id, trip.tenantId) }))!;
    const s = resolvedSettings(tenant);
    const today = localDate(tenant.timezone);
    const m = tripMoney({ price: trip.price, dues: trip.dues as DueInput[], payments: trip.payments }, today);
    const first = trip.contact?.firstName ?? trip.customerName.split(' ')[0];
    const contactPhone = s.contactPhone;
    const brand = `<div class="brand"><span>${e(tenant.name)}</span><small>Trip #${trip.number}</small></div>`;
    const head = `<div class="card"><h1>${e(trip.title)}</h1><div class="meta">${[e(first ? `For ${trip.customerName}` : ''), e(range(trip.startDate, trip.endDate)), `${trip.adults + trip.children} traveller${trip.adults + trip.children === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</div></div>`;

    if (trip.status === 'LOST' || trip.status === 'CANCELLED') {
      return send(reply, layout(`${trip.title} · ${tenant.name}`, `${brand}${head}<div class="card"><p style="margin:0">This trip is ${trip.status === 'CANCELLED' ? 'cancelled' : 'no longer active'}. For any questions, please contact ${e(tenant.name)}.</p></div>`));
    }

    // What to pay now: anything overdue, else the next instalment, else the balance
    const nowPaise = m.overdue > 0 ? m.overdue : m.nextDue ? m.nextDue.remaining : Math.max(0, m.balance);
    const dueClass = m.overdue > 0 ? 'overdue' : nowPaise === 0 && m.price > 0 ? 'paid' : '';
    let dueCard: string;
    if (m.price > 0 && m.balance <= 0) {
      dueCard = `<div class="card paid"><div class="due-label">All paid</div><div class="amount">${formatInr(m.paid)}</div><div class="meta">Received in full. Thank you, and have a wonderful trip!</div></div>`;
    } else if (nowPaise === 0) {
      dueCard = `<div class="card"><div class="due-label">Nothing to pay right now</div><div class="meta">${e(tenant.name)} will let you know the amount once your trip is confirmed.</div></div>`;
    } else {
      const label = m.overdue > 0 ? 'Overdue' : m.nextDue ? `${m.nextDue.label} · due ${d(m.nextDue.dueDate)}` : 'Balance';
      let pay = '';
      const online = s.razorpayKeyId && s.razorpaySecretEnc && nowPaise >= 100
        ? `<form method="post" action="/p/${trip.publicToken}/pay" class="stack" style="margin-top:${s.upiId ? '10px' : '16px'}"><button class="btn${s.upiId ? ' secondary' : ''}" type="submit">Pay ${formatInr(nowPaise)} online${s.upiId ? ' (card, net banking)' : ''}</button></form>`
        : '';
      if (s.upiId) {
        const link = upiLink({ upiId: s.upiId, payeeName: s.upiName ?? tenant.name, paise: nowPaise, note: `Trip ${trip.number} ${trip.title}` });
        const qr = await QRCode.toDataURL(link, { margin: 1, width: 264, color: { dark: '#111816', light: '#ffffff' } });
        const told = waLink(contactPhone, `Hi, I’ve paid ${formatInr(nowPaise)} for trip #${trip.number} (${trip.title}). UPI reference: `);
        pay = `<div class="stack"><a class="btn" href="${e(link)}">Pay ${formatInr(nowPaise)} with a UPI app</a></div>${online}
<div class="upi"><img src="${qr}" alt="UPI QR code for ${formatInr(nowPaise)}"><div><p>Or scan with GPay, PhonePe, Paytm or your bank app. Paying to</p><code>${e(s.upiId).replace('@', '@<wbr>')}</code><div>${e(s.upiName ?? tenant.name)}</div><button class="copy noprint" type="button" data-copy="${e(s.upiId)}">Copy UPI ID</button></div></div>
<p class="note">${told ? `After paying, <a href="${e(told)}">send us the UPI reference on WhatsApp</a> and we’ll send your receipt.` : 'After paying, send the UPI reference to your travel agent and they’ll send your receipt.'}</p>`;
      } else {
        const ask = waLink(contactPhone, `Hi, how can I pay ${formatInr(nowPaise)} for trip #${trip.number} (${trip.title})?`);
        pay = online || `<div class="stack">${ask ? `<a class="btn" href="${e(ask)}">Ask how to pay on WhatsApp</a>` : ''}</div><p class="note">Please contact ${e(tenant.name)} to pay.</p>`;
      }
      dueCard = `<div class="card ${dueClass}"><div class="due-label">${e(label)}</div><div class="amount">${formatInr(nowPaise)}</div>${m.price > 0 ? `<div class="meta">${formatInr(m.paid)} paid of ${formatInr(m.price)}</div>` : ''}${pay}</div>`;
    }

    const STATE: Record<string, string> = { PAID: 'Paid', PART_PAID: 'Part paid', OVERDUE: 'Overdue', DUE_TODAY: 'Due today', UPCOMING: 'Upcoming' };
    const schedule = m.dues.length
      ? `<div class="card"><h2>Payment schedule</h2>${m.dues
          .map((x) => `<div class="row"><div class="l">${e(x.label)}<span>Due ${d(x.dueDate)}</span></div><div class="r">${formatInr(x.amount)}<span class="pill ${x.state}">${STATE[x.state]}</span></div></div>`)
          .join('')}</div>`
      : '';
    const valid = trip.payments.filter((p) => !p.voidedAt).sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());
    const received = valid.length
      ? `<div class="card"><h2>Received</h2>${valid
          .map((p) => `<div class="row"><div class="l">${formatInr(p.amount)}<span>${d(p.paidAt.toISOString())} · ${METHOD[p.method]}</span></div><div class="r"><a href="/r/${p.publicToken}">Receipt #${p.receiptNumber}</a></div></div>`)
          .join('')}</div>`
      : '';
    const party = trip.adults + trip.children;
    const travellersCard =
      trip.status === 'BOOKED' || trip.status === 'QUOTED'
        ? `<div class="card"><h2>Traveller details</h2><p class="meta" style="margin:0 0 12px">Names and ID details for tickets and check-in${party > 1 ? `, for all ${party} travellers` : ''}.</p><a class="btn secondary" href="/p/${trip.publicToken}/travellers">Fill in traveller details</a></div>`
        : '';
    const footer = `<footer>${[tenant.name, tenant.postalAddress, prettyPhone(contactPhone)].filter(Boolean).map((x) => e(x!)).join('<br>')}</footer>`;
    const q = req.query as { paid?: string; error?: string };
    const banner = q.paid
      ? `<div class="card paid"><div class="due-label">Thank you!</div><div class="meta" style="margin:0">Your payment is being confirmed. Your receipt appears below within a minute; refresh this page to see it.</div></div>`
      : q.error
        ? `<div class="card overdue"><div class="due-label">Online payment isn’t available right now</div><div class="meta" style="margin:0">Please pay by UPI below, or contact ${e(tenant.name)}.</div></div>`
        : '';
    return send(reply, layout(`${trip.title} · ${tenant.name}`, `${brand}${banner}${head}${dueCard}${schedule}${received}${travellersCard}${footer}`));
  });

  app.get<{ Params: { token: string } }>('/r/:token', async (req, reply) => {
    if (!/^[a-z0-9]{40,80}$/i.test(req.params.token)) return notFound(reply);
    const p = await db.query.tripPayments.findFirst({ where: eq(tripPayments.publicToken, req.params.token), with: { trip: { with: { dues: true, payments: true, contact: true } }, tenant: true } });
    if (!p) return notFound(reply);
    const { trip, tenant } = p;
    const m = tripMoney({ price: trip.price, dues: trip.dues as DueInput[], payments: trip.payments }, localDate(tenant.timezone));
    const body = `
<div class="card receipt">
  ${p.voidedAt ? `<div class="void">CANCELLED${p.voidReason ? ` · ${e(p.voidReason)}` : ''}</div>` : ''}
  <div class="rhead">
    <div><div class="co">${e(tenant.name)}</div>${tenant.postalAddress ? `<div class="addr">${e(tenant.postalAddress)}</div>` : ''}</div>
    <div class="title"><b>PAYMENT RECEIPT</b><div style="font-weight:700;font-size:20px">#${p.receiptNumber}</div><span>${d(p.paidAt.toISOString())}</span></div>
  </div>
  <dl>
    <dt>Received from</dt><dd>${e(trip.customerName)}</dd>
    <dt>For</dt><dd>Trip #${trip.number}, ${e(trip.title)}${trip.startDate ? `<br><span style="color:var(--muted);font-size:13px">${e(range(trip.startDate, trip.endDate))}</span>` : ''}</dd>
    <dt>Paid by</dt><dd>${METHOD[p.method]}${p.reference ? `<br><span style="color:var(--muted);font-size:13px">${e(p.reference)}</span>` : ''}</dd>
  </dl>
  <div class="box"><div class="due-label">Amount received</div><div class="amount" style="font-size:32px">${formatInr(p.amount)}</div><div class="words">${rupeesInWords(p.amount)}</div></div>
  ${m.price > 0 ? `<dl><dt>Trip total</dt><dd>${formatInr(m.price)}</dd><dt>Paid so far</dt><dd>${formatInr(m.paid)}</dd><dt>Balance today</dt><dd style="font-weight:600">${formatInr(Math.max(0, m.balance))}</dd></dl>` : ''}
  <p class="note">This is a payment receipt, not a tax invoice.</p>
</div>
<div class="stack noprint"><button class="btn" type="button" data-print>Print or save as PDF</button><a class="btn secondary" href="/p/${trip.publicToken}">See your trip and payments</a></div>`;
    return send(reply, layout(`Receipt #${p.receiptNumber} · ${tenant.name}`, body));
  });
}

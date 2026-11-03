import type { FastifyInstance, FastifyReply } from 'fastify';
import { escapeHtml } from '../email/render.js';
import { lookupForUnsubscribe, unsubscribeByMessage } from './service.js';
import { verifyUnsubscribeToken } from './token.js';

function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  const visible = user.length <= 2 ? user.slice(0, 1) : user.slice(0, 2);
  return `${visible}${'•'.repeat(Math.max(2, user.length - visible.length))}@${domain}`;
}

function page(reply: FastifyReply, status: number, title: string, body: string) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F5F6F4;color:#111816;
    font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px;box-sizing:border-box}
  .card{max-width:420px;width:100%;background:#fff;border:1px solid #E3E6E3;border-radius:16px;padding:32px;box-sizing:border-box}
  h1{font-size:22px;margin:0 0 8px;letter-spacing:-.01em} p{margin:0 0 20px;color:#3A433F}
  button{width:100%;min-height:48px;border:0;border-radius:10px;background:#111816;color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer}
  button:focus-visible{outline:3px solid #0B7A62;outline-offset:2px}
  .ok{width:44px;height:44px;border-radius:99px;background:#E4F2ED;display:grid;place-items:center;margin-bottom:16px}
  small{display:block;margin-top:16px;color:#59625E;font-size:13px}
  @media (prefers-color-scheme:dark){body{background:#111816;color:#F5F6F4}.card{background:#1B2320;border-color:#2C3632}p{color:#C9D1CD}small{color:#A3ADA8}button{background:#F5F6F4;color:#111816}}
</style></head><body><main class="card">${body}</main></body></html>`;
  return reply.code(status).type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
}

const check = `<div class="ok" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0B7A62" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>`;

function notFound(reply: FastifyReply) {
  return page(reply, 404, 'Link not valid', `<h1>This link isn’t valid</h1><p>It may be incomplete. Try opening it again from the email.</p>`);
}

export async function unsubscribeRoutes(app: FastifyInstance) {
  // GET only shows a confirmation button. Email security scanners open links automatically,
  // so unsubscribing on GET would remove people who never asked.
  app.get<{ Params: { token: string } }>('/u/:token', async (req, reply) => {
    const messageId = verifyUnsubscribeToken(req.params.token);
    if (!messageId) return notFound(reply);
    const info = await lookupForUnsubscribe(messageId);
    if (!info) return notFound(reply);
    const name = escapeHtml(info.tenantName);
    if (info.alreadyUnsubscribed) {
      return page(reply, 200, 'Unsubscribed', `${check}<h1>You’re already unsubscribed</h1><p>${escapeHtml(maskEmail(info.email))} won’t get marketing emails from ${name}.</p>`);
    }
    return page(
      reply,
      200,
      `Unsubscribe from ${info.tenantName}`,
      `<h1>Unsubscribe from ${name}?</h1>
       <p>${escapeHtml(maskEmail(info.email))} will stop receiving marketing emails from ${name}.</p>
       <form method="post" action="/u/${escapeHtml(req.params.token)}"><button type="submit">Unsubscribe</button></form>
       <small>Changed your mind? Just close this page.</small>`,
    );
  });

  // POST does the work. Gmail/Yahoo "one-click" sends: List-Unsubscribe=One-Click
  app.post<{ Params: { token: string }; Body: Record<string, string> | undefined }>('/u/:token', async (req, reply) => {
    const messageId = verifyUnsubscribeToken(req.params.token);
    if (!messageId) return notFound(reply);
    const info = await unsubscribeByMessage(messageId);
    if (!info) return notFound(reply);

    const oneClick = req.body && typeof req.body === 'object' && req.body['List-Unsubscribe'] === 'One-Click';
    if (oneClick) return reply.code(200).send({ ok: true });

    const name = escapeHtml(info.tenantName);
    return page(reply, 200, 'Unsubscribed', `${check}<h1>You’re unsubscribed</h1><p>${escapeHtml(maskEmail(info.email))} won’t get marketing emails from ${name} any more.</p><small>Unsubscribed by mistake? Reply to any earlier email from ${name}.</small>`);
  });
}

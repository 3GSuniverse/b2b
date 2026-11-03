import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { env, isProd } from '../../config/env.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { AppError } from '../../lib/http.js';
import { requireAuth, requireRole, tenantOf } from '../auth/guard.js';
import { buildAuthUrl, createPkce, googleConfig } from './google.js';
import { completeGoogleConnect, createOAuthState, disconnectMailbox, listMailboxes, readOAuthState } from './service.js';

const PKCE_COOKIE = 'g_pkce';
const appUrl = () => (env.APP_URL ?? env.PUBLIC_URL).replace(/\/$/, '');

function backToApp(reply: FastifyReply, params: Record<string, string>) {
  reply.clearCookie(PKCE_COOKIE, { path: '/api/integrations/gmail' });
  return reply.redirect(`${appUrl()}/settings/senders?${new URLSearchParams(params)}`, 303);
}

export async function mailboxRoutes(app: FastifyInstance) {
  // Step 1 — the dashboard sends the browser here; we bounce it to Google's consent screen
  app.get('/api/integrations/gmail/connect', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    googleConfig(); // fail early with a clear message if not configured
    const nonce = randomBytes(16).toString('base64url');
    const { verifier, challenge } = createPkce();
    // The verifier waits in an httpOnly, encrypted cookie until Google sends the user back
    reply.setCookie(PKCE_COOKIE, encryptSecret(JSON.stringify({ nonce, verifier })), {
      path: '/api/integrations/gmail',
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 600,
    });
    const state = createOAuthState(tenantOf(req), req.auth!.userId, nonce);
    return reply.redirect(buildAuthUrl({ state, challenge }), 302);
  });

  // Step 2 — Google sends the user back here
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/integrations/gmail/callback',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { code, state, error } = req.query;
      if (error) return backToApp(reply, { gmail: 'cancelled' }); // user clicked Cancel on Google's screen

      const s = state ? readOAuthState(state) : null;
      let cookie: { nonce?: string; verifier?: string } = {};
      try {
        cookie = JSON.parse(decryptSecret(req.cookies[PKCE_COOKIE] ?? ''));
      } catch {
        /* missing or tampered */
      }
      // The state must be ours, unexpired, for THIS signed-in user, and match this browser's cookie
      if (!code || !s || s.u !== req.auth!.userId || s.t !== req.auth!.tenantId || !cookie.verifier || cookie.nonce !== s.n) {
        return backToApp(reply, { gmail: 'error', reason: 'invalid_state' });
      }

      try {
        const r = await completeGoogleConnect({ tenantId: s.t, userId: s.u, code, verifier: cookie.verifier });
        return backToApp(reply, { gmail: 'connected', email: r.email });
      } catch (err) {
        const reason = err instanceof AppError ? err.code : 'google_error';
        req.log.warn({ err }, 'gmail connect failed');
        return backToApp(reply, { gmail: 'error', reason });
      }
    },
  );

  app.get('/api/mailboxes', { preHandler: requireAuth }, async (req) => ({ mailboxes: await listMailboxes(tenantOf(req)) }));

  app.delete<{ Params: { id: string } }>('/api/mailboxes/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    await disconnectMailbox(tenantOf(req), req.params.id);
    return reply.code(204).send();
  });
}

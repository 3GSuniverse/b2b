import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Paths the API owns. Anything else that asks for HTML is a dashboard page. */
const SERVER_PREFIXES = ['/api/', '/u/', '/p/', '/q/', '/r/', '/webhooks/', '/health'];

/**
 * Serves the built dashboard (web/dist) from the same origin as the API, so
 * cookies, CSRF rules and the CSP all stay simple. Hashed assets are cached
 * for a year; index.html is never cached, so a deploy shows up immediately.
 */
async function web(app: FastifyInstance, opts: { root?: string }) {
  const root = path.resolve(opts.root ?? process.env.WEB_DIST ?? path.join(process.cwd(), '../web/dist'));
  const index = path.join(root, 'index.html');
  const enabled = existsSync(index);
  if (!enabled) app.log.info({ root }, 'dashboard build not found, serving the API only');

  if (enabled) {
    await app.register(fastifyStatic, {
      root,
      wildcard: false, // only real files; unknown paths fall through to the SPA handler below
      index: false,
      cacheControl: false, // we set it ourselves, per file
      setHeaders(res, file) {
        res.setHeader('cache-control', /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    const wantsPage = (req.method === 'GET' || req.method === 'HEAD') && !SERVER_PREFIXES.some((p) => req.url.startsWith(p)) && String(req.headers.accept ?? '').includes('text/html');
    if (enabled && wantsPage) {
      return reply.header('cache-control', 'no-cache').type('text/html').sendFile('index.html', { cacheControl: false });
    }
    return reply.code(404).send({ error: 'not_found', message: 'Not found' });
  });
}

// Not encapsulated: the 404 handler and sendFile must apply to the whole app
export const webRoutes = fp(web, { name: 'web' });

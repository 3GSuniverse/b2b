import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { closeDatabase } from '../src/lib/db.js';
import { blockedOnLinksHost, customerLink } from '../src/lib/links.js';
import { closeRedis } from '../src/lib/redis.js';
import { quoteUrl } from '../src/modules/quotes/service.js';
import { unsubscribeUrl } from '../src/modules/unsubscribe/token.js';

// Agencies' customers must only ever see their agency, never the platform's own domain
const mutable = env as { LINKS_URL?: string };
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  mutable.LINKS_URL = 'https://go.example-links.in';
  app = await buildApp({ authRateLimit: 10_000 });
});
afterAll(async () => {
  delete mutable.LINKS_URL;
  await app.close();
  await closeRedis();
  await closeDatabase();
});

describe('neutral customer links', () => {
  it('builds every customer link on the links address', () => {
    expect(customerLink('/p/abc')).toBe('https://go.example-links.in/p/abc');
    expect(quoteUrl('tok')).toBe('https://go.example-links.in/q/tok');
    expect(unsubscribeUrl('msg_1')).toMatch(/^https:\/\/go\.example-links\.in\/u\//);
  });

  it('serves only customer pages there: the app, sign-in and home page are not reachable', async () => {
    const host = 'go.example-links.in';
    for (const url of ['/', '/signin', '/trips', '/api/auth/me', '/privacy', '/favicon.svg']) {
      const r = await app.inject({ method: 'GET', url, headers: { host } });
      expect(r.statusCode, url).toBe(404);
      expect(r.body, url).toContain('This link isn’t valid');
      expect(r.body, url).not.toMatch(/dhrona|drona|kurukshetra/i);
    }
    // Customer pages pass through to their own handlers (an unknown token is their own 404)
    const pay = await app.inject({ method: 'GET', url: '/p/not-a-real-token', headers: { host } });
    expect(pay.body).not.toContain('This link isn’t valid');
    expect(blockedOnLinksHost(host, '/q/abc?x=1')).toBe(false);
    expect(blockedOnLinksHost(host, '/u/abc')).toBe(false);
    expect(blockedOnLinksHost(host, '/health')).toBe(false);
  });

  it('leaves the app address alone', async () => {
    expect(blockedOnLinksHost(new URL(env.PUBLIC_URL).host, '/signin')).toBe(false);
    const r = await app.inject({ method: 'GET', url: '/health', headers: { host: new URL(env.PUBLIC_URL).host } });
    expect(r.statusCode).toBe(200);
  });
});

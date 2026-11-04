import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { closeDatabase } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';

// A tiny fake build of the dashboard
const root = mkdtempSync(path.join(tmpdir(), 'web-dist-'));
mkdirSync(path.join(root, 'assets'));
writeFileSync(path.join(root, 'index.html'), '<!doctype html><div id="root"></div><script type="module" src="/assets/app-abc123.js"></script>');
writeFileSync(path.join(root, 'assets', 'app-abc123.js'), 'console.log(1)');

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  app = await buildApp({ webRoot: root });
});
afterAll(async () => {
  await app.close();
  await closeRedis();
  await closeDatabase();
});

describe('serving the dashboard', () => {
  it('any page URL gets the app, never cached', async () => {
    const r = await app.inject({ method: 'GET', url: '/campaigns/abc/edit', headers: { accept: 'text/html' } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.headers['cache-control']).toBe('no-cache');
    expect(r.body).toContain('id="root"');
  });

  it('answers HEAD for pages too (uptime checks)', async () => {
    const r = await app.inject({ method: 'HEAD', url: '/', headers: { accept: 'text/html' } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
  });

  it('hashed assets are cached for a year', async () => {
    const r = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toContain('immutable');
  });

  it('unknown API paths stay JSON 404s, not the app', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/nope', headers: { accept: 'text/html' } });
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toBe('not_found');
    expect((await app.inject({ method: 'GET', url: '/assets/missing.js' })).statusCode).toBe(404);
  });

  it('the page runs only our own scripts and can’t be framed', async () => {
    const csp = String((await app.inject({ method: 'GET', url: '/', headers: { accept: 'text/html' } })).headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

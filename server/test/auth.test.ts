import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { sessions, tenants, users } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { hashPassword, verifyPassword } from '../src/modules/auth/password.js';
import { api, signup } from './api-helpers.js';
import { resetDb } from './helpers.js';

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  app = await buildApp({ authRateLimit: 10_000 });
});
afterAll(async () => {
  await app.close();
  await closeRedis();
  await closeDatabase();
});
beforeEach(resetDb);

describe('passwords', () => {
  it('hashes with a random salt and verifies', async () => {
    const a = await hashPassword('correct-horse-battery');
    const b = await hashPassword('correct-horse-battery');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct-horse-battery', a)).toBe(true);
    expect(await verifyPassword('wrong-horse-battery', a)).toBe(false);
  });
});

describe('signup and login', () => {
  it('signup creates a company and its owner, and signs them in', async () => {
    const { cookie, json, body } = await signup(app, { companyName: 'ABC Holidays' });
    expect(json.tenant).toMatchObject({ name: 'ABC Holidays', status: 'ACTIVE' });
    const me = await api(app, cookie).get('/api/auth/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ email: body.email, role: 'OWNER' });
    expect(me.json().user).not.toHaveProperty('passwordHash');
  });

  it('sets an httpOnly cookie and stores only a hash of the session token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { companyName: 'X Tours', name: 'X', email: 'x@xtours.in', password: 'correct-horse-battery' },
    });
    const c = res.cookies.find((k) => k.name === 'sid')!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Lax');
    const [row] = await db.select().from(sessions);
    expect(row!.tokenHash).not.toBe(c.value);
    expect(row!.tokenHash).toHaveLength(64);
  });

  it('rejects a duplicate email (any letter case)', async () => {
    await signup(app, { email: 'ravi@abc.in' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { companyName: 'Other', name: 'R', email: 'RAVI@abc.in', password: 'correct-horse-battery' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('email_taken');
  });

  it('explains what is wrong with each field', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { companyName: 'A', email: 'nope', password: 'short' } });
    expect(res.statusCode).toBe(400);
    const fields = res.json().details.fields;
    expect(Object.keys(fields).sort()).toEqual(['companyName', 'email', 'name', 'password']);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { body } = await signup(app);
    const wrongPw = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: body.email, password: 'not-the-password' } });
    const noUser = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ghost@nowhere.in', password: 'whatever-123' } });
    expect(wrongPw.statusCode).toBe(401);
    expect(noUser.statusCode).toBe(401);
    expect(wrongPw.json()).toEqual(noUser.json());
  });

  it('logs in, and logging out ends the session', async () => {
    const { body } = await signup(app);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: body.email, password: body.password } });
    expect(login.statusCode).toBe(200);
    const cookie = `sid=${login.cookies.find((c) => c.name === 'sid')!.value}`;
    expect((await api(app, cookie).get('/api/auth/me')).statusCode).toBe(200);
    expect((await api(app, cookie).post('/api/auth/logout')).statusCode).toBe(200);
    expect((await api(app, cookie).get('/api/auth/me')).statusCode).toBe(401);
  });

  it('blocks suspended companies from signing in', async () => {
    const { body, json } = await signup(app);
    await db.update(tenants).set({ status: 'SUSPENDED' }).where(eq(tenants.id, json.tenant.id));
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: body.email, password: body.password } });
    expect(res.statusCode).toBe(403);
  });
});

describe('brute-force protection', () => {
  it('locks out an IP after too many sign-in attempts', async () => {
    const strict = await buildApp({ authRateLimit: 3 });
    const attempt = () =>
      strict.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@b.in', password: 'guess-guess-1' } });
    for (let i = 0; i < 3; i++) expect((await attempt()).statusCode).toBe(401);
    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toBe('rate_limited');
    await strict.close();
  });
});

describe('API protection', () => {
  it('requires sign-in', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/domains' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('not_signed_in');
  });

  it('rejects form posts to the API (blocks cross-site request forgery)', async () => {
    const { cookie } = await signup(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'domain=evil.com',
    });
    expect(res.statusCode).toBe(415);
  });

  it('members cannot change sending settings', async () => {
    const { json } = await signup(app);
    await db.update(users).set({ role: 'MEMBER' }).where(eq(users.id, json.user.id));
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: (await db.query.users.findFirst({ where: eq(users.id, json.user.id) }))!.email, password: 'correct-horse-battery' } });
    const cookie = `sid=${login.cookies.find((c) => c.name === 'sid')!.value}`;
    expect((await api(app, cookie).get('/api/domains')).statusCode).toBe(200);
    expect((await api(app, cookie).post('/api/domains', { domain: 'abc.in' })).statusCode).toBe(403);
  });
});

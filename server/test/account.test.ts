import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { closeDatabase } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
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

describe('account', () => {
  it('owners set the company name and the address printed in every footer', async () => {
    const { cookie } = await signup(app);
    const c = api(app, cookie);
    expect((await c.get('/api/account')).json().account).toMatchObject({ postalAddress: null, timezone: 'Asia/Kolkata' });
    expect((await c.patch('/api/account', { postalAddress: 'short' })).json().details.fields.postalAddress).toBe('Enter your full office address');
    const r = (await c.patch('/api/account', { name: 'Kurukshetra Travels', postalAddress: 'Road No. 12, Banjara Hills, Hyderabad 500034' })).json();
    expect(r.account).toMatchObject({ name: 'Kurukshetra Travels', postalAddress: 'Road No. 12, Banjara Hills, Hyderabad 500034' });
  });

  it('needs a signed-in user', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/account' })).statusCode).toBe(401);
  });
});

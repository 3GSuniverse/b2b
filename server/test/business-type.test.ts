import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { customFields, tenants } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { syncContactTripFields } from '../src/modules/trips/service.js';
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

describe('kind of business', () => {
  it('travel agencies stay as they are; other kinds are saved and reach the screen', async () => {
    const travel = await signup(app);
    expect((await api(app, travel.cookie).get('/api/auth/me')).json().tenant.businessType).toBe('TRAVEL');

    const shop = await signup(app, { businessType: 'RETAIL' });
    expect((await api(app, shop.cookie).get('/api/auth/me')).json().tenant.businessType).toBe('RETAIL');

    const bad = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { companyName: 'Zed', name: 'Z', email: 'z@zed.in', password: 'correct-horse-battery', businessType: 'SPACESHIP' } });
    expect(bad.statusCode).toBe(400);
  });

  it('a shop’s order fields use order words under the same keys', async () => {
    const shop = await signup(app, { businessType: 'RETAIL' });
    const tenantId = shop.json.tenant.id;
    const { makeContact } = await import('./helpers.js');
    const { trips } = await import('../src/db/schema.js');
    const contact = await makeContact(tenantId, {});
    await db.insert(trips).values({ tenantId, contactId: contact.id, customerName: 'Ravi', title: 'Sofa set', destination: 'Sofa', startDate: '2030-01-10', endDate: '2030-01-12', status: 'BOOKED', number: 1 } as never);
    await syncContactTripFields(tenantId, contact.id);
    const fields = await db.select().from(customFields).where(eq(customFields.tenantId, tenantId));
    expect(fields.map((f) => [f.key, f.label]).sort()).toEqual([['destination', 'Product'], ['return_date', 'Delivery date'], ['trip_date', 'Order date']]);
    expect((await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }))!.businessType).toBe('RETAIL');
  });
});

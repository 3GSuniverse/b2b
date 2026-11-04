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

async function setup() {
  const s = await signup(app);
  const c = api(app, s.cookie);
  const pkg = (
    await c.post('/api/packages', {
      name: 'Kerala 4N/5D',
      destination: 'Kerala',
      nights: 4,
      summary: 'Munnar, Alleppey houseboat and Kochi',
      pricePerAdult: '24,500',
      pricePerChild: '12,000',
      costPerPerson: '18,000',
      days: [{ title: 'Arrive in Kochi', description: 'Drive to Munnar.' }],
      inclusions: ['Hotels with breakfast', 'Private car'],
    })
  ).json().package;
  return { ...s, c, pkg };
}

describe('packages', () => {
  it('validates and shows the margin per person', async () => {
    const { c, pkg } = await setup();
    expect(pkg).toMatchObject({ name: 'Kerala 4N/5D', nights: 4, pricePerAdult: 2_450_000, pricePerChild: 1_200_000, costPerPerson: 1_800_000, marginPerPerson: 650_000 });
    const bad = await c.post('/api/packages', { name: '', pricePerAdult: 'abc' });
    expect(bad.json().details.fields).toMatchObject({ name: 'Name the package, e.g. “Kerala 4N/5D”', pricePerAdult: 'Enter an amount like 24,500' });
  });

  it('a trip sold as a package gets its price, destination and dates; the package knows who took it', async () => {
    const { c, pkg } = await setup();
    const t = (await c.post('/api/trips', { customer: { name: 'Lakshmi', phone: '9000000001' }, packageId: pkg.id, startDate: '2026-12-12', adults: 2, children: 1, status: 'BOOKED' })).json().trip;
    expect(t).toMatchObject({ title: 'Kerala 4N/5D', destination: 'Kerala', endDate: '2026-12-16', price: 6_100_000, package: { id: pkg.id, name: 'Kerala 4N/5D' } });
    await c.post(`/api/trips/${t.id}/payments`, { amount: '20,000', method: 'UPI' });
    await c.post('/api/trips', { customer: { name: 'Ravi', phone: '9000000002' }, packageId: pkg.id, adults: 2 }); // still an enquiry

    const p = (await c.get(`/api/packages/${pkg.id}`)).json().package;
    expect(p.stats).toEqual({ bookings: 1, enquiries: 1, travellers: 3, value: 6_100_000, received: 2_000_000, cost: 5_400_000, margin: 700_000 });
    expect(p.trips.map((x: { customer: string }) => x.customer).sort()).toEqual(['Lakshmi', 'Ravi']);
    expect((await c.get(`/api/trips?packageId=${pkg.id}`)).json().total).toBe(2);
  });

  it('the price follows the party size, unless the agent set their own', async () => {
    const { c, pkg } = await setup();
    const t = (await c.post('/api/trips', { customer: { name: 'A', phone: '9000000001' }, packageId: pkg.id, adults: 2 })).json().trip;
    expect((await c.patch(`/api/trips/${t.id}`, { adults: 3 })).json().trip.price).toBe(7_350_000);
    await c.patch(`/api/trips/${t.id}`, { price: '70,000' }); // a deal
    expect((await c.patch(`/api/trips/${t.id}`, { adults: 4 })).json().trip.price).toBe(7_000_000);
  });

  it('assigning a package later fills in the price, and a quote starts from its plan', async () => {
    const { c, pkg } = await setup();
    const t = (await c.post('/api/trips', { customer: { name: 'A', phone: '9000000001' }, adults: 2, startDate: '2026-12-01' })).json().trip;
    const after = (await c.patch(`/api/trips/${t.id}`, { packageId: pkg.id })).json().trip;
    expect(after).toMatchObject({ price: 4_900_000, destination: 'Kerala', endDate: '2026-12-05' });
    const q = (await c.post(`/api/trips/${t.id}/quotes`)).json().quote;
    expect(q.days[0].title).toBe('Arrive in Kochi');
    expect(q.inclusions).toEqual(['Hotels with breakfast', 'Private car']);
    expect(q.totals).toMatchObject({ total: 4_900_000, margin: 1_300_000 });
  });

  it('a group departure of a package: its price per person, and every family counts towards it', async () => {
    const { c, pkg } = await setup();
    const g = (await c.post('/api/groups', { title: 'Kerala group, Jan', packageId: pkg.id, startDate: '2027-01-10' })).json().group;
    expect(g).toMatchObject({ perPersonPrice: 2_450_000, destination: 'Kerala', endDate: '2027-01-14' });
    await c.post(`/api/groups/${g.id}/bookings`, { customer: { name: 'B', phone: '9000000003' }, adults: 4 });
    const p = (await c.get(`/api/packages/${pkg.id}`)).json().package;
    expect(p.stats).toMatchObject({ bookings: 1, travellers: 4, value: 9_800_000 });
  });

  it('another company’s package can’t be used; archived ones drop off the list but keep their trips', async () => {
    const { c, pkg } = await setup();
    const other = await setup();
    const r = await other.c.post('/api/trips', { customer: { name: 'X', phone: '9000000009' }, packageId: pkg.id });
    expect(r.json().details.fields.packageId).toBe('Choose one of your packages');
    await c.post('/api/trips', { customer: { name: 'A', phone: '9000000001' }, packageId: pkg.id, status: 'BOOKED' });
    expect((await c.del(`/api/packages/${pkg.id}`)).statusCode).toBe(204);
    expect((await c.get('/api/packages')).json().packages).toHaveLength(0);
    expect((await c.get(`/api/packages/${pkg.id}`)).json().package.stats.bookings).toBe(1);
  });
});

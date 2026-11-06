import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { campaigns, contacts, messages } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
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

describe('the Email and WhatsApp master tabs', () => {
  it('each shows only its own channel', async () => {
    const { cookie, json } = await signup(app);
    const tenantId = json.tenant.id;
    const now = new Date();
    const [wa] = await db.insert(campaigns).values({ tenantId, name: 'Diwali on WhatsApp', channel: 'WHATSAPP', text: 'Hi', status: 'SENT', startedAt: now }).returning();
    await db.insert(campaigns).values({ tenantId, name: 'Email draft', subject: 'Hi', html: '<p>Hi</p>' });
    await db.insert(messages).values([
      { tenantId, channel: 'EMAIL', toAddress: 'a@example.com', status: 'DELIVERED', sentAt: now, deliveredAt: now, firstOpenedAt: now },
      { tenantId, channel: 'EMAIL', toAddress: 'b@example.com', status: 'BOUNCED', sentAt: now },
      { tenantId, channel: 'WHATSAPP', campaignId: wa!.id, toAddress: '+919000000001', status: 'DELIVERED', sentAt: now, deliveredAt: now },
    ]);
    const c = api(app, cookie);

    const email = (await c.get('/api/channels/email')).json();
    expect(email.thisMonth).toMatchObject({ sent: 2, delivered: 1, opened: 1, failed: 1, bySource: { broadcast: 0, direct: 2 } });
    expect(email.broadcasts.drafts).toBe(1);
    expect(email.email.quota.used).toBe(2);
    expect(email.activity).toHaveLength(2);

    const whatsapp = (await c.get('/api/channels/whatsapp')).json();
    expect(whatsapp.thisMonth).toMatchObject({ sent: 1, bySource: { broadcast: 1 } });
    expect(whatsapp.email).toBeNull();
    expect(whatsapp.last14Days).toHaveLength(14);

    expect((await c.get('/api/channels/sms')).statusCode).toBe(404);
    const list = (await c.get('/api/campaigns?channel=WHATSAPP')).json();
    expect(list.campaigns.map((x: { name: string }) => x.name)).toEqual(['Diwali on WhatsApp']);
  });
});

describe('who gets a broadcast', () => {
  it('lists or hand-picked people with nothing ticked means nobody, never everyone', async () => {
    const { cookie, json } = await signup(app);
    const tenantId = json.tenant.id;
    const c = api(app, cookie);
    const [a, b] = await db.insert(contacts).values([
      { tenantId, email: 'a@example.com', phone: '+919000000001', whatsappStatus: 'SUBSCRIBED' },
      { tenantId, email: 'b@example.com' },
    ]).returning();
    const count = async (audience: object) => (await c.post('/api/audience/count', audience)).json().count;
    expect(await count({})).toBe(2);
    expect(await count({ mode: 'lists', listIds: [] })).toBe(0);
    expect(await count({ mode: 'people', contactIds: [] })).toBe(0);
    expect(await count({ mode: 'people', contactIds: [a!.id] })).toBe(1);
    expect(await count({ mode: 'people', contactIds: [a!.id, b!.id], channel: 'WHATSAPP' })).toBe(1);
    expect(await count({ mode: 'everyone', contactIds: [a!.id] })).toBe(2);
    const picked = (await c.get(`/api/contacts?ids=${a!.id},${b!.id}`)).json();
    expect(picked.contacts).toHaveLength(2);
  });
});

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { campaigns, messages, notifications } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { MemoryEmailProvider } from '../src/modules/email/memory-provider.js';
import { getOverview } from '../src/modules/overview/service.js';
import { processSendJob } from '../src/modules/sending/send-message.js';
import { startCampaign } from '../src/modules/sending/start-campaign.js';
import { evaluateTenantHealth, HEALTH } from '../src/modules/webhooks/tenant-health.js';
import { api, signup } from './api-helpers.js';
import { fakeQueue, makeCampaign, makeContact, makeTenant, resetDb } from './helpers.js';

const provider = new MemoryEmailProvider();
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  app = await buildApp({ authRateLimit: 10_000 });
});
afterAll(async () => {
  await app.close();
  await closeRedis();
  await closeDatabase();
});
beforeEach(async () => {
  await resetDb();
  provider.clear();
});

describe('overview', () => {
  it('summarises the month, the last 30 days by IST day, health, audience and what’s next', async () => {
    const { cookie, json } = await signup(app, { name: 'Anil Kumar' });
    const tenantId = json.tenant.id;
    const now = new Date('2026-11-03T08:00:00Z'); // 1:30 PM IST
    for (const e of ['a@x.in', 'b@x.in', 'c@x.in']) await makeContact(tenantId, { email: e });
    await makeContact(tenantId, { email: 'gone@x.in', emailStatus: 'UNSUBSCRIBED' });

    const [camp] = await db.insert(campaigns).values({ tenantId, name: 'Diwali', status: 'SENT', startedAt: new Date('2026-11-02T04:00:00Z'), unsubscribed: 1 }).returning();
    const at = (iso: string) => new Date(iso);
    await db.insert(messages).values([
      // 2 Nov 20:00 UTC = 3 Nov 01:30 IST → counts on 3 Nov
      { tenantId, campaignId: camp!.id, toAddress: 'a@x.in', status: 'DELIVERED', queuedAt: at('2026-11-02T20:00:00Z'), sentAt: at('2026-11-02T20:00:00Z'), deliveredAt: at('2026-11-02T20:00:05Z'), firstClickedAt: at('2026-11-02T21:00:00Z') },
      { tenantId, campaignId: camp!.id, toAddress: 'b@x.in', status: 'DELIVERED', queuedAt: at('2026-11-01T05:00:00Z'), sentAt: at('2026-11-01T05:00:00Z'), deliveredAt: at('2026-11-01T05:00:05Z') },
      { tenantId, campaignId: camp!.id, toAddress: 'c@x.in', status: 'BOUNCED', queuedAt: at('2026-11-01T05:00:00Z'), sentAt: at('2026-11-01T05:00:00Z') },
      // last month
      { tenantId, campaignId: camp!.id, toAddress: 'old@x.in', status: 'DELIVERED', queuedAt: at('2026-10-15T05:00:00Z'), sentAt: at('2026-10-15T05:00:00Z'), deliveredAt: at('2026-10-15T05:00:05Z') },
    ]);
    await db.insert(campaigns).values({ tenantId, name: 'Kashi yatra', status: 'SCHEDULED', scheduledAt: new Date('2026-11-08T04:30:00Z') });

    const o = await getOverview(tenantId, json.user.id, now);
    expect(o.greeting).toBe('Good afternoon, Anil');
    expect(o.quota).toMatchObject({ used: 3, limit: 200, resetsOn: '2026-12-01' });
    expect(o.thisMonth).toMatchObject({ sent: 3, delivered: 2, deliveryRate: 66.7, clicked: 1, clickRate: 50, sentChange: 200, unsubscribed: 1 });
    expect(o.last30Days).toHaveLength(30);
    expect(o.last30Days.at(-1)).toEqual({ day: '2026-11-03', sent: 1, delivered: 1, clicked: 1, campaigns: [] });
    expect(o.last30Days.find((d) => d.day === '2026-11-01')).toEqual({ day: '2026-11-01', sent: 2, delivered: 1, clicked: 0, campaigns: [] });
    // The chart names the campaign that started that day (IST)
    expect(o.last30Days.find((d) => d.day === '2026-11-02').campaigns).toEqual([{ id: camp!.id, name: 'Diwali' }]);
    expect(o.audience).toEqual({ total: 4, subscribed: 3, suppressed: 1 });
    expect(o.upcoming).toMatchObject({ name: 'Kashi yatra', recipients: 3 });
    expect(o.recentCampaigns.map((c) => c.name)).toContain('Diwali');

    // and over HTTP
    const res = await api(app, cookie).get('/api/overview');
    expect(res.statusCode).toBe(200);
    expect(res.json().account.status).toBe('ACTIVE');
  });
});

describe('notifications', () => {
  it('tells the company when a campaign finishes — once', async () => {
    const { tenant, sender } = await makeTenant();
    await makeContact(tenant.id);
    await makeContact(tenant.id);
    const c = await makeCampaign(tenant.id, sender.id, { name: 'Diwali packages' });
    const q = fakeQueue();
    await startCampaign(c.id, { enqueue: q.enqueue });
    for (const id of q.queued) await processSendJob(id, provider);
    await processSendJob(q.queued[0]!, provider); // re-run changes nothing

    const rows = await db.select().from(notifications).where(eq(notifications.tenantId, tenant.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'campaign.completed', level: 'SUCCESS', title: '“Diwali packages” has been sent', link: `/campaigns/${c.id}` });
    expect(rows[0]!.body).toMatch(/Sent to 2 of 2 people/);
  });

  it('warns when sending is paused for high bounces', async () => {
    const { tenant, sender } = await makeTenant();
    const c = await makeCampaign(tenant.id, sender.id);
    await db.insert(messages).values(
      Array.from({ length: HEALTH.minSample }, (_, i) => ({
        tenantId: tenant.id,
        campaignId: c.id,
        toAddress: `p${i}@x.in`,
        status: i < 20 ? ('BOUNCED' as const) : ('DELIVERED' as const),
        sentAt: new Date(),
      })),
    );
    await evaluateTenantHealth(tenant.id);
    const [n] = await db.select().from(notifications);
    expect(n).toMatchObject({ type: 'tenant.paused', level: 'ERROR' });
    expect(n!.body).toMatch(/Bounce rate 10\.0%/);
  });

  it('lists, counts and marks notifications read — per company', async () => {
    const a = await signup(app);
    const b = await signup(app);
    await db.insert(notifications).values([
      { tenantId: a.json.tenant.id, type: 'x', title: 'One' },
      { tenantId: a.json.tenant.id, type: 'x', title: 'Two' },
      { tenantId: b.json.tenant.id, type: 'x', title: 'Other company' },
    ]);
    const ca = api(app, a.cookie);
    const list = (await ca.get('/api/notifications')).json();
    expect(list.unread).toBe(2);
    expect(list.notifications.map((n: { title: string }) => n.title).sort()).toEqual(['One', 'Two']);
    expect((await ca.post('/api/notifications/read', { ids: [list.notifications[0].id] })).json().unread).toBe(1);
    expect((await ca.post('/api/notifications/read', {})).json().unread).toBe(0);
    expect((await api(app, b.cookie).get('/api/notifications')).json().unread).toBe(1);
  });
});



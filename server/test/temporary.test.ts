import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { campaigns, contacts, messages, suppressions, whatsappSessions } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { wipeTemporaryLists } from '../src/modules/campaigns/service.js';
import { MemoryEmailProvider } from '../src/modules/email/memory-provider.js';
import { processSendJob } from '../src/modules/sending/send-message.js';
import { startCampaign } from '../src/modules/sending/start-campaign.js';
import { MemoryWhatsAppGateway } from '../src/modules/whatsapp/gateway.js';
import { processWhatsAppJob } from '../src/modules/whatsapp/service.js';
import { api, signup } from './api-helpers.js';
import { fakeQueue, makeCampaign, makeContact, makeTenant, resetDb, makeLine } from './helpers.js';

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

describe('temporary lists: send to pasted numbers and emails without saving them', () => {
  it('WhatsApp: cleans up the numbers, skips people who said STOP, saves nobody', async () => {
    const { tenant } = await makeTenant({ whatsappWebEnabled: true });
    await makeLine(tenant.id, { status: 'CONNECTED', phone: '+919000000001', dailyLimit: 200, intervalSeconds: 0 });
    const ravi = await makeContact(tenant.id, { phone: '+919000000002', whatsappStatus: 'SUBSCRIBED', firstName: 'Ravi' });
    await db.insert(suppressions).values({ tenantId: tenant.id, channel: 'WHATSAPP', address: '+919000000003', reason: 'UNSUBSCRIBE' });
    const audience = { mode: 'temporary' as const, addresses: ['98480 12345', '+91 98480-12345', 'not a number', '9000000002', '9000000003'] };
    const [c] = await db.insert(campaigns).values({ tenantId: tenant.id, channel: 'WHATSAPP', name: 'Fair visitors', text: 'Namaste {first_name|there}', audience }).returning();

    // Without the promise that they agreed, nothing goes
    await expect(startCampaign(c!.id, { enqueue: async () => undefined, enqueueWhatsApp: fakeQueue().enqueue })).rejects.toThrow(/agreed/);

    await db.update(campaigns).set({ audience: { ...audience, consent: true } }).where(eq(campaigns.id, c!.id));
    const q = fakeQueue();
    const r = await startCampaign(c!.id, { enqueue: async () => undefined, enqueueWhatsApp: q.enqueue });
    expect(r.recipients).toBe(2);
    const sent = await db.select().from(messages).where(eq(messages.campaignId, c!.id));
    expect(sent.map((m) => m.toAddress).sort()).toEqual(['+919000000002', '+919848012345']);
    expect(sent.find((m) => m.toAddress === '+919000000002')!.contactId).toBe(ravi.id);
    expect(sent.find((m) => m.toAddress === '+919848012345')!.contactId).toBeNull();
    expect(await db.$count(contacts, eq(contacts.tenantId, tenant.id))).toBe(1); // nobody new saved

    const gw = new MemoryWhatsAppGateway();
    for (const id of q.queued) expect(await processWhatsAppJob(id, gw)).toBe('sent');
    expect(gw.sent.map((s) => s.text).sort()).toEqual(['Namaste Ravi', 'Namaste there']);
  });

  it('email: leaves out unsubscribed and bounced people, and the checks explain it', async () => {
    const { tenant, sender } = await makeTenant();
    await makeContact(tenant.id, { email: 'gone@example.com', emailStatus: 'UNSUBSCRIBED' });
    await db.insert(suppressions).values({ tenantId: tenant.id, channel: 'EMAIL', address: 'bounced@example.com', reason: 'HARD_BOUNCE' });
    const c = await makeCampaign(tenant.id, sender.id, {
      audience: { mode: 'temporary', consent: true, addresses: ['New@Example.com', 'gone@example.com', 'bounced@example.com', 'nonsense'] },
    });
    const q = fakeQueue();
    expect((await startCampaign(c.id, { enqueue: q.enqueue })).recipients).toBe(1);
    const provider = new MemoryEmailProvider();
    expect(await processSendJob(q.queued[0]!, provider)).toBe('sent');
    expect(provider.outbox[0]!.to).toBe('new@example.com');
  });

  it('counts from the app, and never falls back to all customers', async () => {
    const { cookie, json } = await signup(app);
    await makeContact(json.tenant.id, { email: 'saved@example.com' });
    const c = api(app, cookie);
    const count = async (audience: object) => (await c.post('/api/audience/count', audience)).json().count;
    expect(await count({ mode: 'temporary', addresses: [] })).toBe(0);
    expect(await count({ mode: 'temporary', addresses: ['a@example.com', 'A@example.com', 'b@example.com'] })).toBe(2);
    expect(await count({ mode: 'temporary', channel: 'WHATSAPP', addresses: ['9848012345', '98480 12345'] })).toBe(1);
  });

  it('wipes the pasted list 30 days after the send', async () => {
    const { tenant, sender } = await makeTenant();
    const c = await makeCampaign(tenant.id, sender.id, { audience: { mode: 'temporary', consent: true, addresses: ['a@example.com', 'b@example.com'] } });
    await db.update(campaigns).set({ status: 'SENT', completedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(campaigns.id, c.id));
    expect(await wipeTemporaryLists()).toBe(1);
    const after = await db.query.campaigns.findFirst({ where: eq(campaigns.id, c.id) });
    expect(after!.audience).toMatchObject({ mode: 'temporary', addresses: [], addressCount: 2 });
    expect(await wipeTemporaryLists()).toBe(0);
  });
});

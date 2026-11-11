import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { campaigns, messages, waChats, whatsappSessions } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { recordIncoming } from '../src/modules/inbox/service.js';
import { api, employee, signup } from './api-helpers.js';
import { makeContact, resetDb } from './helpers.js';

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

describe('employees never see each other’s work', () => {
  it('chats, campaigns and the dashboard stay with the employee who did the work; the owner sees all', async () => {
    const owner = await signup(app);
    const tenantId = owner.json.tenant.id;
    const asha = await employee(app, owner, 'asha');
    const ravi = await employee(app, owner, 'ravi');

    const [ashaLine] = await db.insert(whatsappSessions).values({ tenantId, userId: asha.id, status: 'CONNECTED', phone: '+919000000001' }).returning();
    await db.insert(whatsappSessions).values({ tenantId, userId: ravi.id, status: 'CONNECTED', phone: '+919000000002' });
    const customer = await makeContact(tenantId, { phone: '+919848012345', whatsappStatus: 'SUBSCRIBED', firstName: 'Meena' });
    const chatId = await recordIncoming(tenantId, ashaLine!.id, { phone: '+919848012345', text: 'Please hold my seats', waId: 'P-1', at: new Date() });

    const [camp] = await db.insert(campaigns).values({ tenantId, channel: 'WHATSAPP', name: 'Asha secret offer', text: 'hello', createdById: asha.id, status: 'SENT' }).returning();
    await db.insert(messages).values({ tenantId, channel: 'WHATSAPP', toAddress: '+919848012345', contactId: customer.id, campaignId: camp!.id, sentById: asha.id, whatsappSessionId: ashaLine!.id, status: 'SENT', sentAt: new Date(), body: 'hello' });

    const A = api(app, asha.cookie);
    const R = api(app, ravi.cookie);
    const O = api(app, owner.cookie);

    // Chats
    expect((await A.get('/api/inbox')).json().chats).toHaveLength(1);
    expect((await R.get('/api/inbox')).json().chats).toHaveLength(0);
    expect((await R.get(`/api/inbox/${chatId}`)).statusCode).toBe(404);
    expect((await R.post(`/api/inbox/${chatId}/reply`, { text: 'hi' })).statusCode).toBe(404);
    expect((await O.get('/api/inbox')).json().chats).toHaveLength(1);

    // Campaigns
    expect((await A.get('/api/campaigns')).json().campaigns).toHaveLength(1);
    expect((await R.get('/api/campaigns')).json().campaigns).toHaveLength(0);
    expect((await R.get(`/api/campaigns/${camp!.id}`)).statusCode).toBe(404);
    expect((await R.get(`/api/campaigns/${camp!.id}/report`)).statusCode).toBe(404);
    expect((await R.del(`/api/campaigns/${camp!.id}`)).statusCode).toBe(404);
    expect((await O.get('/api/campaigns')).json().campaigns).toHaveLength(1);

    // Dashboard and WhatsApp page: no activity from a colleague
    const ro = (await R.get('/api/overview')).json();
    expect(ro.communication.activity).toHaveLength(0);
    expect(ro.communication.thisMonth.sent).toBe(0);
    expect(ro.recentCampaigns).toHaveLength(0);
    expect((await A.get('/api/overview')).json().communication.activity).toHaveLength(1);
    expect((await O.get('/api/overview')).json().communication.activity).toHaveLength(1);
    expect((await R.get('/api/channels/whatsapp')).json().activity ?? []).toHaveLength(0);
    expect((await A.get('/api/channels/whatsapp')).json().activity ?? []).toHaveLength(1);
    expect(await db.$count(waChats)).toBe(1);
  });
});

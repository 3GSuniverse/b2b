import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { campaigns, messages, users, waChatMessages, waChats, whatsappSessions } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { extractContent } from '../src/modules/inbox/extract.js';
import { recordFromPhone, recordIncoming, reply } from '../src/modules/inbox/service.js';
import { startCampaign } from '../src/modules/sending/start-campaign.js';
import { MemoryWhatsAppGateway } from '../src/modules/whatsapp/gateway.js';
import { processWhatsAppJob } from '../src/modules/whatsapp/service.js';
import { api, signup } from './api-helpers.js';
import { fakeQueue, makeContact, makeTenant, resetDb, makeLine } from './helpers.js';

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

async function agencyWithBroadcast() {
  const { tenant } = await makeTenant({ whatsappWebEnabled: true });
  const line = await makeLine(tenant.id, { status: 'CONNECTED', phone: '+919000000001', dailyLimit: 200, intervalSeconds: 0 });
  const ravi = await makeContact(tenant.id, { phone: '+919848012345', whatsappStatus: 'SUBSCRIBED', firstName: 'Ravi' });
  const [c] = await db.insert(campaigns).values({ tenantId: tenant.id, channel: 'WHATSAPP', name: 'Kerala offer', text: 'Namaste {first_name|there}, Kerala 3 nights ₹18,500' }).returning();
  const q = fakeQueue();
  await startCampaign(c!.id, { enqueue: async () => undefined, enqueueWhatsApp: q.enqueue });
  const gw = new MemoryWhatsAppGateway();
  await processWhatsAppJob(q.queued[0]!, gw);
  return { tenant, ravi, gw, line };
}

describe('WhatsApp inbox', () => {
  it('a reply opens a conversation that starts with the broadcast it answers', async () => {
    const { tenant, line } = await agencyWithBroadcast();
    // Nobody has replied yet: no conversation
    expect(await db.$count(waChats)).toBe(0);

    const chatId = await recordIncoming(tenant.id, line.id, { phone: '+919848012345', text: 'Is it available in December?', waId: 'IN-1', at: new Date() });
    // The same message delivered twice is kept once
    await recordIncoming(tenant.id, line.id, { phone: '+919848012345', text: 'Is it available in December?', waId: 'IN-1', at: new Date() });
    const thread = await db.select().from(waChatMessages).where(eq(waChatMessages.chatId, chatId)).orderBy(waChatMessages.at);
    expect(thread.map((m) => [m.direction, m.source, m.body])).toEqual([
      ['OUT', 'broadcast', 'Namaste Ravi, Kerala 3 nights ₹18,500'],
      ['IN', 'customer', 'Is it available in December?'],
    ]);
    const chat = await db.query.waChats.findFirst({ where: eq(waChats.id, chatId) });
    expect(chat).toMatchObject({ unread: 1, lastDirection: 'IN', lastPreview: 'Is it available in December?' });
  });

  it('the team answers from Dhrona; the reply is sent and not recorded twice', async () => {
    const { tenant, gw, line } = await agencyWithBroadcast();
    const chatId = await recordIncoming(tenant.id, line.id, { phone: '+919848012345', text: 'Price for 4?', waId: 'IN-2', at: new Date() });
    const q = fakeQueue();
    // The employee whose number it is answers
    const user = { id: line.userId };
    const r = await reply({ tenantId: tenant.id, userId: user.id, role: 'MEMBER' }, chatId, 'Namaste Ravi garu 🙏 For 4 people it is ₹74,000.', q.enqueue);
    expect(q.queued).toEqual([r.messageId]);
    const m = await db.query.messages.findFirst({ where: eq(messages.id, r.messageId) });
    expect(m).toMatchObject({ service: true, sentById: user.id, toAddress: '+919848012345', whatsappSessionId: line.id });

    expect(await processWhatsAppJob(r.messageId, gw)).toBe('sent');
    const waId = gw.sent.at(-1)!.id;
    // WhatsApp echoes our own message back as "sent from this number"
    await recordFromPhone(tenant.id, line.id, { phone: '+919848012345', text: 'Namaste Ravi garu 🙏 For 4 people it is ₹74,000.', waId, at: new Date() });
    const rows = await db.select().from(waChatMessages).where(eq(waChatMessages.chatId, chatId));
    expect(rows.filter((x) => x.source === 'reply')).toHaveLength(1);
    expect(rows.find((x) => x.source === 'reply')!.waId).toBe(waId);
    expect(rows.filter((x) => x.source === 'phone')).toHaveLength(0);
    expect((await db.query.waChats.findFirst({ where: eq(waChats.id, chatId) }))!.unread).toBe(0);

    // Typed on the phone itself: recorded as sent from the phone
    await recordFromPhone(tenant.id, line.id, { phone: '+919848012345', text: 'Sending the itinerary now', waId: 'PHONE-1', at: new Date() });
    expect(await db.$count(waChatMessages, eq(waChatMessages.source, 'phone'))).toBe(1);
  });

  it('the app lists conversations with names, unread counts and threads, per agency only', async () => {
    const owner = await signup(app, { companyName: 'Inbox Travels' });
    const other = await signup(app, { companyName: 'Other Travels' });
    const tenantId = owner.json.tenant.id;
    const line = await makeLine(tenantId, { userId: owner.json.user.id });
    await makeContact(tenantId, { phone: '+919848012345', firstName: 'Ravi', lastName: 'Kumar' });
    const chatId = await recordIncoming(tenantId, line.id, { phone: '+919848012345', text: 'Hello', waId: 'A', at: new Date() });
    await recordIncoming(tenantId, line.id, { phone: '+919000000077', text: null, mediaKind: 'image', waId: 'B', at: new Date(Date.now() + 1000) });
    const c = api(app, owner.cookie);

    const list = (await c.get('/api/inbox')).json().chats;
    expect(list.map((x: { name: string | null; lastPreview: string }) => [x.name, x.lastPreview])).toEqual([
      [null, '📷 Photo'],
      ['Ravi Kumar', 'Hello'],
    ]);
    expect((await c.get('/api/inbox/unread')).json()).toEqual({ chats: 2, messages: 2 });
    expect((await c.get('/api/inbox?search=ravi')).json().chats).toHaveLength(1);

    const thread = (await c.get(`/api/inbox/${chatId}`)).json();
    expect(thread.contact.name).toBe('Ravi Kumar');
    expect(thread.messages[0]).toMatchObject({ direction: 'IN', body: 'Hello' });
    await c.post(`/api/inbox/${chatId}/read`);
    await c.post(`/api/inbox/${chatId}/done`, { done: true });
    expect((await c.get('/api/inbox?filter=done')).json().chats).toHaveLength(1);
    expect((await c.post(`/api/inbox/${chatId}/reply`, { text: '' })).statusCode).toBe(400);

    expect((await api(app, other.cookie).get(`/api/inbox/${chatId}`)).statusCode).toBe(404);
    expect((await api(app, other.cookie).get('/api/inbox')).json().chats).toHaveLength(0);
  });

  it('reads the words out of any kind of WhatsApp message', () => {
    expect(extractContent({ conversation: 'Hi' })).toMatchObject({ text: 'Hi' });
    expect(extractContent({ ephemeralMessage: { message: { extendedTextMessage: { text: 'Hidden hi' } } } })).toMatchObject({ text: 'Hidden hi' });
    expect(extractContent({ imageMessage: { caption: 'Passport' } })).toMatchObject({ text: 'Passport', mediaKind: 'image' });
    expect(extractContent({ documentMessage: { fileName: 'tickets.pdf' } })).toMatchObject({ mediaKind: 'document', mediaName: 'tickets.pdf' });
    expect(extractContent({ reactionMessage: { text: '👍' } })).toBeNull();
  });
});

import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { messages, notifications, waChatMessages, waChats } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { runAutopilot } from '../src/modules/ai/autopilot.js';
import { setAiClient } from '../src/modules/ai/quote-draft.js';
import { recordFromPhone, recordIncoming } from '../src/modules/inbox/service.js';
import { api, signup } from './api-helpers.js';
import { makeLine, resetDb } from './helpers.js';

let app: Awaited<ReturnType<typeof buildApp>>;
const calls: { system: string; prompt: string; think?: number }[] = [];
let answer: object = {};
beforeAll(async () => {
  app = await buildApp({ authRateLimit: 10_000 });
});
afterAll(async () => {
  await app.close();
  await closeRedis();
  await closeDatabase();
});
beforeEach(async () => {
  calls.length = 0;
  answer = { situation: 'greeting', language: 'English', reply: 'Namaste Sir 🙏 How may we help you plan your trip?', needsHuman: false, note: null };
  setAiClient({
    async complete(input) {
      calls.push(input);
      return JSON.stringify(answer);
    },
  });
  await resetDb();
});
afterEach(() => setAiClient(null));

async function setup() {
  const owner = await signup(app, { companyName: 'Sai Travels' });
  const tenantId = owner.json.tenant.id;
  const line = await makeLine(tenantId, { userId: owner.json.user.id, status: 'CONNECTED', phone: '+919999900000' });
  const c = api(app, owner.cookie);
  return { tenantId, line, c };
}

describe('Drona AI Autopilot', () => {
  it('is switched on by the employee whose number it is', async () => {
    const { c } = await setup();
    expect((await c.get('/api/ai/autopilot')).json()).toMatchObject({ linked: true, on: false });
    const r = await c.put('/api/ai/autopilot', { on: true });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ on: true, today: { sent: 0, waiting: 0 } });
  });

  it('answers simple questions by itself, with a stricter autopilot prompt and thinking', async () => {
    const { tenantId, line, c } = await setup();
    await c.put('/api/ai/autopilot', { on: true });
    await c.put('/api/ai/notes', { aiNotes: 'Office 9 to 8', aiLanguage: 'Telugu' });
    const at = new Date();
    const chatId = await recordIncoming(tenantId, line.id, { phone: '+919848012345', text: 'Hi', waId: 'a1', at });
    expect(await runAutopilot({ chatId, at: at.getTime() })).toBe('sent');
    const [out] = await db.select().from(waChatMessages).where(eq(waChatMessages.source, 'autopilot'));
    expect(out!.body).toContain('Namaste');
    expect(await db.select().from(messages).where(eq(messages.tenantId, tenantId))).toHaveLength(1);
    expect(calls[0]!.system).toContain('AUTOPILOT');
    expect(calls[0]!.system).toContain('Always reply in Telugu');
    expect(calls[0]!.think).toBeGreaterThan(0);
    // Already answered: running again does nothing
    expect(await runAutopilot({ chatId, at: at.getTime() })).toBe('skipped_answered');
  });

  it('holds back anything a person should check, and tells the employee', async () => {
    const { tenantId, line, c } = await setup();
    await c.put('/api/ai/autopilot', { on: true });
    answer = { situation: 'payment', language: 'English', reply: 'Thank you Sir, we will confirm your payment shortly.', needsHuman: true, note: 'Check the UPI payment of ₹15,000' };
    const at = new Date();
    const chatId = await recordIncoming(tenantId, line.id, { phone: '+919848012345', text: 'I paid 15000 by UPI', waId: 'b1', at });
    expect(await runAutopilot({ chatId, at: at.getTime() })).toBe('held');
    expect(await db.select().from(waChatMessages).where(eq(waChatMessages.source, 'autopilot'))).toHaveLength(0);
    const thread = (await c.get(`/api/inbox/${chatId}`)).json();
    expect(thread.chat.aiDraft).toEqual({ text: 'Thank you Sir, we will confirm your payment shortly.', note: 'Check the UPI payment of ₹15,000' });
    const [n] = await db.select().from(notifications).where(eq(notifications.tenantId, tenantId));
    expect(n!.title).toContain('+919848012345');
    // The employee answers: the draft goes away
    await c.post(`/api/inbox/${chatId}/reply`, { text: 'Received, thank you!' });
    expect((await db.query.waChats.findFirst({ where: eq(waChats.id, chatId) }))!.aiDraft).toBeNull();
  });

  it('answers once for several quick messages, and stays quiet when the employee is chatting', async () => {
    const { tenantId, line, c } = await setup();
    await c.put('/api/ai/autopilot', { on: true });
    const t1 = new Date(Date.now() - 5000);
    const t2 = new Date();
    const chatId = await recordIncoming(tenantId, line.id, { phone: '+919848012345', text: 'Hi', waId: 'c1', at: t1 });
    await recordIncoming(tenantId, line.id, { phone: '+919848012345', text: 'Kerala price?', waId: 'c2', at: t2 });
    expect(await runAutopilot({ chatId, at: t1.getTime() })).toBe('skipped_newer');

    await recordFromPhone(tenantId, line.id, { phone: '+919848012345', text: 'One minute Sir', waId: 'c3', at: new Date(Date.now() + 1000) });
    const t3 = new Date(Date.now() + 2000);
    await recordIncoming(tenantId, line.id, { phone: '+919848012345', text: 'ok', waId: 'c4', at: t3 });
    expect(await runAutopilot({ chatId, at: t3.getTime() })).toBe('skipped_human');
  });

  it('does nothing when switched off', async () => {
    const { tenantId, line } = await setup();
    const at = new Date();
    const chatId = await recordIncoming(tenantId, line.id, { phone: '+919848012345', text: 'Hi', waId: 'd1', at });
    expect(await runAutopilot({ chatId, at: at.getTime() })).toBe('skipped_off');
    expect(calls).toHaveLength(0);
  });
});

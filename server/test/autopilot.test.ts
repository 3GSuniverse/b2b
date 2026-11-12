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

  it('sends a short holding message, hands the chat to the employee, and stays quiet until they reply', async () => {
    const { tenantId, line, c } = await setup();
    await c.put('/api/ai/autopilot', { on: true });
    answer = { situation: 'payment', language: 'English', reply: 'Thank you Sir 🙏\nLet me check the payment with our team and confirm shortly.\nExtra line\nAnother extra line', needsHuman: true, note: 'Check the UPI payment of ₹15,000' };
    const at = new Date();
    const chatId = await recordIncoming(tenantId, line.id, { phone: '+919848012345', text: 'I paid 15000 by UPI', waId: 'b1', at });
    expect(await runAutopilot({ chatId, at: at.getTime() })).toBe('handed_off');
    const [sent] = await db.select().from(waChatMessages).where(eq(waChatMessages.source, 'autopilot'));
    expect(sent!.body.split('\n')).toHaveLength(3); // never longer than a person types
    const thread = (await c.get(`/api/inbox/${chatId}`)).json();
    expect(thread.chat.handoff.note).toBe('Check the UPI payment of ₹15,000');
    const [n] = await db.select().from(notifications).where(eq(notifications.tenantId, tenantId));
    expect(n!.title).toContain('+919848012345');
    // The customer writes again: the AI waits for the person
    const at2 = new Date(Date.now() + 1000);
    await recordIncoming(tenantId, line.id, { phone: '+919848012345', text: 'Hello?', waId: 'b2', at: at2 });
    expect(await runAutopilot({ chatId, at: at2.getTime() })).toBe('skipped_handoff');
    // The employee answers: the chat is back to normal
    await c.post(`/api/inbox/${chatId}/reply`, { text: 'Received, thank you!' });
    expect((await db.query.waChats.findFirst({ where: eq(waChats.id, chatId) }))!.handoffAt).toBeNull();
  });

  it('answers only the chats ticked in the inbox, several at once', async () => {
    const { tenantId, line, c } = await setup();
    const at = new Date();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await recordIncoming(tenantId, line.id, { phone: `+91984801234${i}`, text: 'Hi', waId: `t${i}`, at }));
    const other = await recordIncoming(tenantId, line.id, { phone: '+919848099999', text: 'Hi', waId: 'tx', at });
    for (const id of ids) expect((await c.put(`/api/inbox/${id}/autopilot`, { on: true })).statusCode).toBe(200);
    const list = (await c.get('/api/inbox')).json().chats as { id: string; autopilot: boolean }[];
    expect(list.filter((x) => x.autopilot)).toHaveLength(5);
    const results = await Promise.all(ids.map((chatId) => runAutopilot({ chatId, at: at.getTime() })));
    expect(results).toEqual(['sent', 'sent', 'sent', 'sent', 'sent']);
    expect(await runAutopilot({ chatId: other, at: at.getTime() })).toBe('skipped_off');
    expect((await c.get('/api/ai/autopilot')).json().chats).toBe(5);
  });

  it('asks the AI for short, human-sized messages', async () => {
    const { tenantId, line, c } = await setup();
    const at = new Date();
    const chatId = await recordIncoming(tenantId, line.id, { phone: '+919848012345', text: 'Hi', waId: 's1', at });
    await c.put(`/api/inbox/${chatId}/autopilot`, { on: true });
    await runAutopilot({ chatId, at: at.getTime() });
    expect(calls[0]!.system).toContain('1 or 2 short lines');
  });

  it('switches itself off for a chat it hands over, and works again as soon as it is ticked back', async () => {
    const { tenantId, line, c } = await setup();
    const at = new Date();
    const chatId = await recordIncoming(tenantId, line.id, { phone: '+919848012345', text: 'I want to cancel', waId: 'h1', at });
    await c.put(`/api/inbox/${chatId}/autopilot`, { on: true });
    answer = { situation: 'cancellation', language: 'English', reply: 'Let me check with our team and get back to you 🙏', needsHuman: true, note: 'Wants to cancel' };
    expect(await runAutopilot({ chatId, at: at.getTime() })).toBe('handed_off');
    let chat = (await c.get(`/api/inbox/${chatId}`)).json().chat;
    expect(chat.autopilot).toBe(false);
    expect(chat.handoff.note).toBe('Wants to cancel');
    expect(chat.ai).toBeNull();

    // The employee answers, then hands the chat back to the AI
    await c.post(`/api/inbox/${chatId}/reply`, { text: 'Cancelled, refund in 3 days.' });
    await c.put(`/api/inbox/${chatId}/autopilot`, { on: true });
    answer = { situation: 'thanks_or_closing', language: 'English', reply: 'Welcome Sir 🙏', needsHuman: false, note: null };
    const at2 = new Date(Date.now() + 1000);
    await recordIncoming(tenantId, line.id, { phone: '+919848012345', text: 'Thanks', waId: 'h2', at: at2 });
    // Not held back by the 30-minute "employee is chatting" rule: they ticked it on after replying
    expect(await runAutopilot({ chatId, at: at2.getTime() })).toBe('sent');
    chat = (await c.get(`/api/inbox/${chatId}`)).json().chat;
    expect(chat.autopilot).toBe(true);
  });

  it('shows in the inbox when the AI is thinking, paused or couldn’t reply', async () => {
    const { tenantId, line, c } = await setup();
    const at = new Date();
    const chatId = await recordIncoming(tenantId, line.id, { phone: '+919848012345', text: 'Hi', waId: 'k1', at });
    await c.put(`/api/inbox/${chatId}/autopilot`, { on: true });
    const row = async () => ((await c.get('/api/inbox')).json().chats as { id: string; aiStatus: string | null; aiStatusNote: string | null }[]).find((x) => x.id === chatId)!;
    expect((await row()).aiStatus).toBe('waiting');
    setAiClient({
      async complete() {
        expect((await row()).aiStatus).toBe('thinking');
        throw new Error('AI service unreachable');
      },
    });
    await expect(runAutopilot({ chatId, at: at.getTime() })).rejects.toThrow();
    expect(await row()).toMatchObject({ aiStatus: 'failed', aiStatusNote: expect.stringContaining('unreachable') });
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

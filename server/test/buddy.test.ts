import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { closeDatabase } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { setAiClient } from '../src/modules/ai/quote-draft.js';
import { api, signup } from './api-helpers.js';
import { resetDb } from './helpers.js';

let app: Awaited<ReturnType<typeof buildApp>>;
const calls: { system: string; prompt: string }[] = [];
let answer = '';
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
  setAiClient({
    async complete(input) {
      calls.push(input);
      return answer;
    },
  });
  await resetDb();
});
afterEach(() => setAiClient(null));

describe('Dhru, the helper', () => {
  it('knows the map, the user and the page, and returns links and drafts', async () => {
    const owner = await signup(app, { companyName: 'Sai Travels' });
    answer = JSON.stringify({
      reply: 'Here is a Diwali wish you can send as an email broadcast!',
      links: [{ label: 'New email broadcast', to: '/campaigns/new?channel=EMAIL' }, { label: 'Bad', to: 'https://evil.example' }],
      draft: { kind: 'email', subject: 'Happy Diwali from Sai Travels', body: 'Dear [Customer name], ...' },
      mood: 'excited',
    });
    const r = await api(app, owner.cookie).post('/api/ai/buddy', { message: 'Write a Diwali email for my customers', page: '/trips' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ mood: 'excited', draft: { kind: 'email', subject: 'Happy Diwali from Sai Travels' }, links: [] });
    expect(calls[0]!.system).toContain('/whatsapp/inbox');
    expect(calls[0]!.system).toContain('the owner at Sai Travels');
    expect(calls[0]!.prompt).toContain('They are on the page: /trips');
  });

  it('keeps only links inside Dhrona', async () => {
    const owner = await signup(app);
    answer = JSON.stringify({ reply: 'Open your inbox', links: [{ label: 'Inbox', to: '/whatsapp/inbox' }], draft: null, mood: 'happy' });
    const r = await api(app, owner.cookie).post('/api/ai/buddy', { message: 'where are my chats?' });
    expect(r.json().links).toEqual([{ label: 'Inbox', to: '/whatsapp/inbox' }]);
  });

  it('says sorry instead of failing on a broken answer', async () => {
    const owner = await signup(app);
    answer = 'not json';
    const r = await api(app, owner.cookie).post('/api/ai/buddy', { message: 'hi' });
    expect(r.json()).toMatchObject({ mood: 'sorry', links: [], draft: null });
  });
});

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { campaigns, contacts, messages, senders, sendingDomains } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { setEmailProvider } from '../src/modules/email/index.js';
import { MemoryEmailProvider } from '../src/modules/email/memory-provider.js';
import { SendError } from '../src/modules/email/types.js';
import { processSendJob } from '../src/modules/sending/send-message.js';
import { closeQueues } from '../src/queues/index.js';
import { api, signup } from './api-helpers.js';
import { resetDb } from './helpers.js';

const provider = new MemoryEmailProvider();
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  setEmailProvider(provider);
  app = await buildApp({ authRateLimit: 10_000 });
});
afterAll(async () => {
  await app.close();
  await closeQueues();
  await closeRedis();
  await closeDatabase();
});
beforeEach(async () => {
  await resetDb();
  provider.clear();
});

/** A signed-up company with a verified domain sender and some contacts. */
async function company(contactsToAdd: { email: string; firstName?: string; attributes?: Record<string, string> }[] = [{ email: 'ravi@x.in', firstName: 'Ravi' }]) {
  const { cookie, json } = await signup(app);
  const tenantId = json.tenant.id;
  const [d] = await db
    .insert(sendingDomains)
    .values({ tenantId, domain: `t${Math.random().toString(36).slice(2, 8)}.in`, identityStatus: 'VERIFIED', dkimStatus: 'VERIFIED', ownershipStatus: 'VERIFIED' })
    .returning();
  const [s] = await db.insert(senders).values({ tenantId, domainId: d!.id, fromName: 'ABC Holidays', fromEmail: `offers@${d!.domain}`, isDefault: true }).returning();
  const c = api(app, cookie);
  for (const ct of contactsToAdd) await c.post('/api/contacts', ct);
  return { cookie, c, tenantId, sender: s! };
}

const draft = {
  name: 'Kashi yatra',
  subject: '{first_name|Traveller}, Kashi yatra seats are open',
  previewText: 'Only 40 seats',
  html: '<p>Namaste {first_name|traveller}, trip from {city|your city}.</p>',
};

describe('campaign drafts', () => {
  it('creates a draft with the default sender, edits it, duplicates it', async () => {
    const { c, sender } = await company();
    const created = await c.post('/api/campaigns', draft);
    expect(created.statusCode).toBe(201);
    const camp = created.json().campaign;
    expect(camp).toMatchObject({ status: 'DRAFT', sender: { id: sender.id } });

    const edited = await c.patch(`/api/campaigns/${camp.id}`, { name: 'Kashi yatra — Karthika' });
    expect(edited.json().campaign.name).toBe('Kashi yatra — Karthika');

    const copy = await c.post(`/api/campaigns/${camp.id}/duplicate`);
    expect(copy.json().campaign).toMatchObject({ name: 'Copy of Kashi yatra — Karthika', status: 'DRAFT', subject: draft.subject });

    const list = (await c.get('/api/campaigns')).json();
    expect(list.total).toBe(2);
    expect(list.campaigns[0].html).toBeNull(); // lists stay light
  });

  it('companies can’t see or touch each other’s campaigns', async () => {
    const a = await company();
    const b = await company();
    const id = (await a.c.post('/api/campaigns', draft)).json().campaign.id;
    expect((await b.c.get(`/api/campaigns/${id}`)).statusCode).toBe(404);
    expect((await b.c.post(`/api/campaigns/${id}/send`)).statusCode).toBe(404);
    // nor use another company's sender
    expect((await b.c.post('/api/campaigns', { ...draft, senderId: a.sender.id })).statusCode).toBe(404);
  });
});

describe('preview and checks', () => {
  it('renders the email for a real recipient and reports what needs fixing', async () => {
    const { c } = await company([
      { email: 'ravi@x.in', firstName: 'Ravi', attributes: { city: 'Guntur' } },
      { email: 'noname@x.in' },
    ]);
    const id = (await c.post('/api/campaigns', { ...draft, html: '<p>Hi {first_name}, from [PRICE] to {cityy}</p>' })).json().campaign.id;
    const p = (await c.post(`/api/campaigns/${id}/preview`, {})).json();

    expect(p.previewAs.email).toBe('ravi@x.in');
    expect(p.rendered.subject).toBe('Ravi, Kashi yatra seats are open');
    expect(p.recipients).toBe(2);
    expect(p.canSend).toBe(false);
    const byId = Object.fromEntries(p.checks.map((x: { id: string }) => [x.id, x]));
    expect(byId.unknown_tags).toMatchObject({ level: 'error' });
    expect(byId.unknown_tags.title).toContain('{cityy}');
    expect(byId.placeholders).toMatchObject({ level: 'error' }); // never send [PLACEHOLDERS] to customers
    expect(byId.placeholders.note).toContain('[PRICE]');
    expect(byId.fallback_first_name).toMatchObject({ level: 'warning', title: '1 contact has no first name.' });
    expect(byId.unsubscribe.level).toBe('ok');
  });

  it('refuses to send while checks fail, with the reason', async () => {
    const { c } = await company([]);
    const id = (await c.post('/api/campaigns', draft)).json().campaign.id;
    const res = await c.post(`/api/campaigns/${id}/send`);
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toBe('Nobody matches this audience.');
  });

  it('counts an audience live', async () => {
    const { c } = await company([{ email: 'a@x.in', attributes: { city: 'Hyderabad' } }, { email: 'b@x.in', attributes: { city: 'Pune' } }]);
    const n = await c.post('/api/audience/count', { filters: [{ field: 'city', op: 'eq', value: 'hyderabad' }] });
    expect(n.json().count).toBe(1);
  });
});

describe('test emails', () => {
  it('sends a [Test] copy, personalised with a real contact', async () => {
    const { c } = await company();
    const id = (await c.post('/api/campaigns', draft)).json().campaign.id;
    const r = (await c.post(`/api/campaigns/${id}/test`, { emails: ['owner@abc.in'] })).json();
    expect(r.results).toEqual([{ to: 'owner@abc.in', ok: true }]);
    expect(provider.outbox[0]).toMatchObject({ to: 'owner@abc.in', subject: '[Test] Ravi, Kashi yatra seats are open' });
    expect(await db.select().from(messages)).toHaveLength(0); // tests aren't counted as campaign sends
  });

  it('explains the SES sandbox when a test goes to an unverified address', async () => {
    const { c } = await company();
    const id = (await c.post('/api/campaigns', draft)).json().campaign.id;
    provider.failNext(new SendError('Email address is not verified. The following identities failed the check', true, 'MessageRejected'));
    const r = (await c.post(`/api/campaigns/${id}/test`, { emails: ['someone@else.in'] })).json();
    expect(r.results[0].ok).toBe(false);
    expect(r.results[0].error).toMatch(/sandbox/);
  });
});

describe('scheduling and sending', () => {
  it('schedules for later, can be unscheduled, and rejects times in the past', async () => {
    const { c } = await company();
    const id = (await c.post('/api/campaigns', draft)).json().campaign.id;
    expect((await c.post(`/api/campaigns/${id}/schedule`, { scheduledAt: '2020-01-01T10:00:00+05:30' })).json().error).toBe('time_in_past');

    const at = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const s = await c.post(`/api/campaigns/${id}/schedule`, { scheduledAt: at });
    expect(s.json().campaign).toMatchObject({ status: 'SCHEDULED' });
    expect(new Date(s.json().campaign.scheduledAt).toISOString()).toBe(at);

    // still editable while scheduled
    expect((await c.patch(`/api/campaigns/${id}`, { subject: 'New subject' })).statusCode).toBe(200);
    expect((await c.post(`/api/campaigns/${id}/unschedule`)).json().campaign.status).toBe('DRAFT');
  });

  it('send now queues everyone; sent campaigns are locked and kept', async () => {
    const { c } = await company([{ email: 'a@x.in' }, { email: 'b@x.in' }]);
    const id = (await c.post('/api/campaigns', draft)).json().campaign.id;
    const sent = await c.post(`/api/campaigns/${id}/send`);
    expect(sent.statusCode).toBe(200);
    expect(sent.json().campaign).toMatchObject({ status: 'SENDING', stats: { recipients: 2 } });

    expect((await c.patch(`/api/campaigns/${id}`, { subject: 'x' })).statusCode).toBe(409);
    expect((await c.del(`/api/campaigns/${id}`)).statusCode).toBe(409);
    expect((await c.post(`/api/campaigns/${id}/send`)).statusCode).toBe(409);
  });

  it('cancelling stops the emails that haven’t gone out yet', async () => {
    const { c } = await company([{ email: 'a@x.in' }, { email: 'b@x.in' }, { email: 'c@x.in' }]);
    const id = (await c.post('/api/campaigns', draft)).json().campaign.id;
    await c.post(`/api/campaigns/${id}/send`);
    const queued = await db.select().from(messages).where(eq(messages.campaignId, id));
    await processSendJob(queued[0]!.id, provider);

    expect((await c.post(`/api/campaigns/${id}/cancel`)).json().campaign.status).toBe('CANCELLED');
    expect(await processSendJob(queued[1]!.id, provider)).toBe('already_processed');
    expect(provider.outbox).toHaveLength(1);

    const report = (await c.get(`/api/campaigns/${id}/report`)).json();
    expect(report).toMatchObject({ cancelled: 2, pending: 0 });
    expect(report.campaign.stats.sent).toBe(1);
    expect((await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) }))!.status).toBe('CANCELLED');
  });

  it('reports rates once events arrive', async () => {
    const { c, tenantId } = await company([{ email: 'a@x.in' }, { email: 'b@x.in' }]);
    const id = (await c.post('/api/campaigns', draft)).json().campaign.id;
    await db.update(campaigns).set({ status: 'SENT', sent: 200, delivered: 196, opened: 80, clicked: 14, bounced: 4, unsubscribed: 2, recipients: 200, startedAt: new Date() }).where(eq(campaigns.id, id));
    const r = (await c.get(`/api/campaigns/${id}/report`)).json();
    expect(r.campaign.rates).toEqual({ delivery: 98, open: 40.8, click: 7.1, bounce: 2, unsubscribe: 1 });
    expect(tenantId).toBeTruthy();
    expect(await db.select().from(contacts)).toHaveLength(2);
  });
});

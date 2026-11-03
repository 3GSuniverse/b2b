import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { campaigns, contacts, messages, suppressions, tenants, whatsappAuth, whatsappSessions } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { countWhatsAppAudience } from '../src/modules/audience/resolve.js';
import { DeferSend } from '../src/modules/sending/send-message.js';
import { startCampaign } from '../src/modules/sending/start-campaign.js';
import { clearAuthState, useDbAuthState } from '../src/modules/whatsapp/auth-store.js';
import { fromJid, MemoryWhatsAppGateway, toJid, WhatsAppError } from '../src/modules/whatsapp/gateway.js';
import { onIncoming, onReceipt, processWhatsAppJob } from '../src/modules/whatsapp/service.js';
import { api, signup } from './api-helpers.js';
import { makeContact, makeTenant, resetDb } from './helpers.js';

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

async function linkedCompany(opts: { dailyLimit?: number; intervalSeconds?: number } = {}) {
  const { tenant } = await makeTenant({ whatsappWebEnabled: true });
  await db.insert(whatsappSessions).values({ tenantId: tenant.id, status: 'CONNECTED', phone: '+919000000001', dailyLimit: opts.dailyLimit ?? 200, intervalSeconds: opts.intervalSeconds ?? 0 });
  return tenant;
}

async function waCampaign(tenantId: string, text = 'Namaste {first_name|there}, your {destination|trip} is confirmed.') {
  const [c] = await db.insert(campaigns).values({ tenantId, channel: 'WHATSAPP', name: 'Trip update', text }).returning();
  return c!;
}

const noQueue = async () => undefined;

describe('WhatsApp Web is only for free trials', () => {
  it('paid companies don’t get it (they get the official WhatsApp route)', async () => {
    const { cookie, json } = await signup(app);
    await db.update(tenants).set({ plan: 'PAID' }).where(eq(tenants.id, json.tenant.id));
    const c = api(app, cookie);
    expect((await c.get('/api/whatsapp')).json().error).toBe('feature_not_enabled');
    expect((await c.post('/api/campaigns', { name: 'x', channel: 'WHATSAPP', text: 'hi' })).statusCode).toBe(403);
    expect((await c.get('/api/auth/me')).json().tenant.features).toEqual({ whatsapp: false });
  });

  it('when on: status, start linking, daily limit settings', async () => {
    const { cookie } = await signup(app); // new companies are on a trial, which includes WhatsApp
    const c = api(app, cookie);
    expect((await c.get('/api/whatsapp')).json().whatsapp).toMatchObject({ status: 'DISCONNECTED', dailyLimit: 200, intervalSeconds: 10, qr: null });
    expect((await c.post('/api/whatsapp/connect')).json().whatsapp.status).toBe('CONNECTING');
    expect((await c.patch('/api/whatsapp', { dailyLimit: 5000 })).statusCode).toBe(400);
    expect((await c.patch('/api/whatsapp', { dailyLimit: 100, intervalSeconds: 15 })).json().whatsapp).toMatchObject({ dailyLimit: 100, intervalSeconds: 15 });
    const created = (await c.post('/api/campaigns', { name: 'Diwali', channel: 'WHATSAPP', text: 'Hi {first_name|there}' })).json().campaign;
    expect(created).toMatchObject({ channel: 'WHATSAPP', text: 'Hi {first_name|there}', sender: null });
  });
});

describe('who gets WhatsApp campaigns', () => {
  it('only people who agreed to WhatsApp, with a number, not unsubscribed', async () => {
    const tenant = await linkedCompany();
    await makeContact(tenant.id, { phone: '+919000000010', whatsappStatus: 'SUBSCRIBED' });
    await makeContact(tenant.id, { phone: '+919000000011', whatsappStatus: 'UNSUBSCRIBED' }); // email only
    await makeContact(tenant.id, { phone: null, whatsappStatus: 'SUBSCRIBED' });
    await makeContact(tenant.id, { phone: '+919000000012', whatsappStatus: 'SUBSCRIBED' });
    await db.insert(suppressions).values({ tenantId: tenant.id, channel: 'WHATSAPP', address: '+919000000012', reason: 'UNSUBSCRIBE' });
    expect(await countWhatsAppAudience(db, tenant.id, null)).toBe(1);
  });
});

describe('before you send', () => {
  it('blocks until the number is linked, placeholders are gone and fields exist', async () => {
    const { cookie, json } = await signup(app);
    await db.update(tenants).set({ whatsappWebEnabled: true }).where(eq(tenants.id, json.tenant.id));
    const c = api(app, cookie);
    await c.post('/api/contacts', { phone: '98480 22338', firstName: 'Ravi', whatsappOptIn: true });
    const id = (await c.post('/api/campaigns', { name: 'x', channel: 'WHATSAPP', text: 'Hi {first_name|there}, [PRICE] for {cityy}' })).json().campaign.id;
    let p = (await c.post(`/api/campaigns/${id}/preview`, {})).json();
    const byId = (x: typeof p) => Object.fromEntries(x.checks.map((k: { id: string }) => [k.id, k]));
    expect(p.canSend).toBe(false);
    expect(byId(p).sender.level).toBe('error');
    expect(byId(p).placeholders.level).toBe('error');
    expect(byId(p).unknown_tags.level).toBe('error');
    expect(p.rendered.text).toBe('Hi Ravi, [PRICE] for {cityy}'); // unknown tags stay visible, and block sending

    await db.update(whatsappSessions).set({ status: 'CONNECTED', phone: '+919000000001' }).where(eq(whatsappSessions.tenantId, json.tenant.id));
    await c.patch(`/api/campaigns/${id}`, { text: 'Hi {first_name|there}, your Goa trip is on Friday.' });
    p = (await c.post(`/api/campaigns/${id}/preview`, {})).json();
    expect(p.canSend).toBe(true);
    expect(p.recipients).toBe(1);
    expect(byId(p).risk.level).toBe('warning'); // always says it's unofficial
  });
});

describe('sending', () => {
  it('queues one WhatsApp message per recipient and sends it personalised', async () => {
    const tenant = await linkedCompany();
    await makeContact(tenant.id, { phone: '+919000000010', firstName: 'Priya', whatsappStatus: 'SUBSCRIBED', attributes: { destination: 'Kerala' } });
    const c = await waCampaign(tenant.id);
    const queued: string[] = [];
    await startCampaign(c.id, { enqueueWhatsApp: async (ids) => void queued.push(...ids) });
    expect(queued).toHaveLength(1);

    const gw = new MemoryWhatsAppGateway();
    expect(await processWhatsAppJob(queued[0]!, gw)).toBe('sent');
    expect(gw.sent[0]).toMatchObject({ to: '+919000000010', text: 'Namaste Priya, your Kerala is confirmed.' });
    const done = await db.query.campaigns.findFirst({ where: eq(campaigns.id, c.id) });
    expect(done).toMatchObject({ status: 'SENT', sent: 1, recipients: 1 });
    expect(await processWhatsAppJob(queued[0]!, gw)).toBe('already_processed'); // never twice
  });

  it('numbers without WhatsApp fail cleanly; temporary errors retry', async () => {
    const tenant = await linkedCompany();
    await makeContact(tenant.id, { phone: '+919000000010', whatsappStatus: 'SUBSCRIBED' });
    await makeContact(tenant.id, { phone: '+919000000011', whatsappStatus: 'SUBSCRIBED' });
    const c = await waCampaign(tenant.id);
    await startCampaign(c.id, { enqueueWhatsApp: noQueue });
    const rows = await db.select().from(messages).where(eq(messages.campaignId, c.id));
    const gw = new MemoryWhatsAppGateway();
    gw.notOnWhatsApp.add('+919000000010');
    const first = rows.find((r) => r.toAddress === '+919000000010')!;
    const second = rows.find((r) => r.toAddress === '+919000000011')!;
    expect(await processWhatsAppJob(first.id, gw)).toBe('failed');
    expect((await db.query.messages.findFirst({ where: eq(messages.id, first.id) }))!.error).toBe('not_on_whatsapp');
    gw.failNext = new WhatsAppError('socket closed', false);
    await expect(processWhatsAppJob(second.id, gw)).rejects.toThrow('socket closed');
    expect((await db.query.messages.findFirst({ where: eq(messages.id, second.id) }))!.status).toBe('QUEUED');
  });

  it('waits between messages and stops at the daily limit instead of dropping', async () => {
    const tenant = await linkedCompany({ dailyLimit: 1, intervalSeconds: 10 });
    await makeContact(tenant.id, { phone: '+919000000010', whatsappStatus: 'SUBSCRIBED' });
    await makeContact(tenant.id, { phone: '+919000000011', whatsappStatus: 'SUBSCRIBED' });
    const c = await waCampaign(tenant.id);
    await startCampaign(c.id, { enqueueWhatsApp: noQueue });
    const [a, b] = await db.select().from(messages).where(eq(messages.campaignId, c.id));
    const gw = new MemoryWhatsAppGateway();
    expect(await processWhatsAppJob(a!.id, gw)).toBe('sent');
    const err = await processWhatsAppJob(b!.id, gw).catch((e) => e);
    expect(err).toBeInstanceOf(DeferSend);
    expect(err.message).toContain('Daily WhatsApp limit of 1');
    expect((err as DeferSend).until.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);

    await db.update(whatsappSessions).set({ dailyLimit: 10 }).where(eq(whatsappSessions.tenantId, tenant.id));
    const paced = await processWhatsAppJob(b!.id, gw).catch((e) => e);
    expect(paced).toBeInstanceOf(DeferSend);
    expect(paced.message).toBe('pacing');
    expect(gw.sent).toHaveLength(1);
  });

  it('holds messages while the number is unlinked', async () => {
    const tenant = await linkedCompany();
    await makeContact(tenant.id, { phone: '+919000000010', whatsappStatus: 'SUBSCRIBED' });
    const c = await waCampaign(tenant.id);
    await startCampaign(c.id, { enqueueWhatsApp: noQueue });
    await db.update(whatsappSessions).set({ status: 'LOGGED_OUT' }).where(eq(whatsappSessions.tenantId, tenant.id));
    const [m] = await db.select().from(messages).where(eq(messages.campaignId, c.id));
    await expect(processWhatsAppJob(m!.id, new MemoryWhatsAppGateway())).rejects.toBeInstanceOf(DeferSend);
  });

  it('can’t start without a linked number', async () => {
    const { tenant } = await makeTenant({ whatsappWebEnabled: true });
    const c = await waCampaign(tenant.id);
    await expect(startCampaign(c.id, { enqueueWhatsApp: noQueue })).rejects.toThrow('Link your WhatsApp number first');
  });
});

describe('after sending', () => {
  it('✓✓ delivered and blue ✓✓ read are counted once', async () => {
    const tenant = await linkedCompany();
    await makeContact(tenant.id, { phone: '+919000000010', whatsappStatus: 'SUBSCRIBED' });
    const c = await waCampaign(tenant.id);
    await startCampaign(c.id, { enqueueWhatsApp: noQueue });
    const [m] = await db.select().from(messages).where(eq(messages.campaignId, c.id));
    const gw = new MemoryWhatsAppGateway();
    await processWhatsAppJob(m!.id, gw);
    await onReceipt(gw.sent[0]!.id, 3);
    await onReceipt(gw.sent[0]!.id, 4);
    await onReceipt(gw.sent[0]!.id, 4);
    expect(await db.query.campaigns.findFirst({ where: eq(campaigns.id, c.id) })).toMatchObject({ delivered: 1, opened: 1 });
  });

  it('a STOP reply unsubscribes them from WhatsApp for good', async () => {
    const tenant = await linkedCompany();
    const contact = await makeContact(tenant.id, { phone: '+919000000010', whatsappStatus: 'SUBSCRIBED' });
    const c = await waCampaign(tenant.id);
    await startCampaign(c.id, { enqueueWhatsApp: noQueue });
    const [m] = await db.select().from(messages).where(eq(messages.campaignId, c.id));
    await processWhatsAppJob(m!.id, new MemoryWhatsAppGateway());

    expect(await onIncoming(tenant.id, '+919000000010', 'When is pickup?')).toBeNull();
    expect(await onIncoming(tenant.id, '+919000000010', ' Stop ')).toContain('won’t get any more WhatsApp messages from Kurukshetra Travels');
    expect((await db.query.contacts.findFirst({ where: eq(contacts.id, contact.id) }))!.whatsappStatus).toBe('UNSUBSCRIBED');
    expect(await countWhatsAppAudience(db, tenant.id, null)).toBe(0);
    expect((await db.query.campaigns.findFirst({ where: eq(campaigns.id, c.id) }))!.unsubscribed).toBe(1);
  });
});

describe('the linked session', () => {
  it('login keys are stored encrypted and removed on unlink', async () => {
    const { tenant } = await makeTenant({ whatsappWebEnabled: true });
    const a = await useDbAuthState(tenant.id);
    await a.saveCreds();
    await a.state.keys.set({ 'pre-key': { '1': { public: Buffer.from('pub'), private: Buffer.from('secret-key') } } });
    const raw = await db.select().from(whatsappAuth).where(eq(whatsappAuth.tenantId, tenant.id));
    expect(raw).toHaveLength(2);
    expect(raw.map((r) => r.valueEnc).join('')).not.toContain('secret-key');

    const b = await useDbAuthState(tenant.id);
    expect(b.state.creds.registrationId).toBe(a.state.creds.registrationId);
    const keys = await b.state.keys.get('pre-key', ['1', '2']);
    expect(Buffer.from(keys['1']!.private).toString()).toBe('secret-key');
    expect(keys['2']).toBeUndefined();

    await clearAuthState(tenant.id);
    expect(await db.select().from(whatsappAuth).where(eq(whatsappAuth.tenantId, tenant.id))).toHaveLength(0);
  });

  it('phone numbers map to WhatsApp ids and back', () => {
    expect(toJid('+919848022338')).toBe('919848022338@s.whatsapp.net');
    expect(fromJid('919848022338:12@s.whatsapp.net')).toBe('+919848022338');
  });
});

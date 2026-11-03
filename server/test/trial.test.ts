import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { automations, campaigns, customFields, messages, notifications, tenants, whatsappAuth, whatsappSessions } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { trialActive, whatsappWebAllowed } from '../src/modules/plans/entitlements.js';
import { runTrialLifecycle } from '../src/modules/plans/trial-lifecycle.js';
import { processSendJob } from '../src/modules/sending/send-message.js';
import { startCampaign } from '../src/modules/sending/start-campaign.js';
import { onConnected, processWhatsAppJob } from '../src/modules/whatsapp/service.js';
import { MemoryWhatsAppGateway } from '../src/modules/whatsapp/gateway.js';
import { DeferSend } from '../src/modules/sending/send-message.js';
import { MemoryEmailProvider } from '../src/modules/email/memory-provider.js';
import { api, signup } from './api-helpers.js';
import { makeCampaign, makeContact, makeTenant, resetDb } from './helpers.js';

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

const DAY = 86_400_000;
const noQueue = async () => undefined;

async function trialCompany(endsInMs = 3 * DAY) {
  const { tenant, sender } = await makeTenant({ plan: 'TRIAL', trialEndsAt: new Date(Date.now() + endsInMs) });
  return { tenant, sender };
}

describe('a new company starts on a 5-day trial', () => {
  it('with 200 emails and up to 100 WhatsApp messages a day', async () => {
    const { cookie, json } = await signup(app);
    const t = await db.query.tenants.findFirst({ where: eq(tenants.id, json.tenant.id) });
    expect(t).toMatchObject({ plan: 'TRIAL', monthlyQuota: 200 });
    expect(t!.trialEndsAt!.getTime() - Date.now()).toBeGreaterThan(4.9 * DAY);
    const me = (await api(app, cookie).get('/api/auth/me')).json().tenant;
    expect(me.features.whatsapp).toBe(true);
    expect(me.plan).toMatchObject({ plan: 'TRIAL', trialEnded: false, daysLeft: 5, whatsapp: { perDay: 100, sentToday: 0 }, emailLimit: 200 });
  });

  it('only paid companies (or the operator override) lose or keep WhatsApp Web accordingly', () => {
    const later = new Date(Date.now() + DAY);
    const past = new Date(Date.now() - DAY);
    expect(whatsappWebAllowed({ plan: 'TRIAL', trialEndsAt: later, whatsappWebEnabled: false })).toBe(true);
    expect(whatsappWebAllowed({ plan: 'TRIAL', trialEndsAt: past, whatsappWebEnabled: false })).toBe(false);
    expect(whatsappWebAllowed({ plan: 'PAID', trialEndsAt: null, whatsappWebEnabled: false })).toBe(false);
    expect(whatsappWebAllowed({ plan: 'PAID', trialEndsAt: null, whatsappWebEnabled: true })).toBe(true);
    expect(trialActive({ plan: 'TRIAL', trialEndsAt: past, whatsappWebEnabled: false })).toBe(false);
  });
});

describe('the trial WhatsApp allowance: 100 a day', () => {
  async function usedToday(tenantId: string, n: number) {
    const [old] = await db.insert(campaigns).values({ tenantId, channel: 'WHATSAPP', name: 'old', status: 'SENT', text: 'hi' }).returning();
    await db.insert(messages).values(Array.from({ length: n }, (_, i) => ({ tenantId, campaignId: old!.id, channel: 'WHATSAPP' as const, toAddress: `+9180000${String(i).padStart(5, '0')}`, status: 'SENT' as const, sentAt: new Date() })));
  }

  it('refuses a campaign that couldn’t finish before the trial ends', async () => {
    const { tenant } = await trialCompany(20 * 3_600_000); // last day
    await db.insert(whatsappSessions).values({ tenantId: tenant.id, status: 'CONNECTED', phone: '+919000000001' });
    await usedToday(tenant.id, 98);
    for (let i = 0; i < 3; i++) await makeContact(tenant.id, { phone: `+91900000001${i}`, whatsappStatus: 'SUBSCRIBED' });
    const [c] = await db.insert(campaigns).values({ tenantId: tenant.id, channel: 'WHATSAPP', name: 'new', text: 'Hi' }).returning();
    await expect(startCampaign(c!.id, { enqueueWhatsApp: noQueue })).rejects.toThrow('can fit 2 more before it ends. This needs 3');
    expect((await db.query.campaigns.findFirst({ where: eq(campaigns.id, c!.id) }))!.status).toBe('DRAFT');
  });

  it('with days left, the same campaign is fine: today’s cap is hit, the rest goes tomorrow', async () => {
    const { tenant } = await trialCompany(3 * DAY);
    await db.insert(whatsappSessions).values({ tenantId: tenant.id, status: 'CONNECTED', phone: '+919000000001', dailyLimit: 200, intervalSeconds: 0 });
    await usedToday(tenant.id, 100);
    await makeContact(tenant.id, { phone: '+919000000010', whatsappStatus: 'SUBSCRIBED' });
    const [c] = await db.insert(campaigns).values({ tenantId: tenant.id, channel: 'WHATSAPP', name: 'new', text: 'Hi' }).returning();
    await startCampaign(c!.id, { enqueueWhatsApp: noQueue });
    const [m] = await db.select().from(messages).where(eq(messages.campaignId, c!.id));
    // the number's own setting says 200, but the trial caps it at 100
    const err = await processWhatsAppJob(m!.id, new MemoryWhatsAppGateway()).catch((e) => e);
    expect(err).toBeInstanceOf(DeferSend);
    expect(err.message).toBe('Daily WhatsApp limit of 100 reached');
  });

  it('a trial can’t raise its own daily limit above 100', async () => {
    const { cookie } = await signup(app);
    const c = api(app, cookie);
    expect((await c.patch('/api/whatsapp', { dailyLimit: 150 })).json().details.fields.dailyLimit).toBe('The free trial allows up to 100 a day');
    expect((await c.get('/api/whatsapp')).json().whatsapp).toMatchObject({ dailyLimit: 100, trialPerDay: 100 });
  });
});

describe('when the trial ends', () => {
  it('nothing can be sent', async () => {
    const { tenant, sender } = await trialCompany(-60_000);
    const contact = await makeContact(tenant.id);
    const c = await makeCampaign(tenant.id, sender.id);
    await expect(startCampaign(c.id, { enqueue: noQueue })).rejects.toThrow('free trial has ended');
    // a message queued before the end is not sent after it
    const [m] = await db.insert(messages).values({ tenantId: tenant.id, campaignId: c.id, contactId: contact.id, toAddress: contact.email!, senderId: sender.id }).returning();
    const provider = new MemoryEmailProvider();
    expect(await processSendJob(m!.id, provider)).toBe('failed');
    expect(provider.outbox).toHaveLength(0);
    expect((await db.query.messages.findFirst({ where: eq(messages.id, m!.id) }))!.error).toBe('trial_ended');
  });

  it('the clean-up unlinks WhatsApp, cancels scheduled sends, pauses automations and tells them once', async () => {
    const { tenant, sender } = await trialCompany(-60_000);
    await db.insert(whatsappSessions).values({ tenantId: tenant.id, status: 'CONNECTED', phone: '+919000000001' });
    await db.insert(whatsappAuth).values({ tenantId: tenant.id, key: 'creds', valueEnc: 'x' });
    const c = await makeCampaign(tenant.id, sender.id);
    await db.update(campaigns).set({ status: 'SCHEDULED', scheduledAt: new Date(Date.now() + DAY) }).where(eq(campaigns.id, c.id));
    const [f] = await db.insert(customFields).values({ tenantId: tenant.id, key: 'trip_date', label: 'Trip date', type: 'DATE' }).returning();
    const [a] = await db.insert(automations).values({ tenantId: tenant.id, name: 'Reminder', status: 'ACTIVE', dateFieldId: f!.id }).returning();

    expect(await runTrialLifecycle()).toMatchObject({ ended: 1 });
    expect((await db.query.whatsappSessions.findFirst({ where: eq(whatsappSessions.tenantId, tenant.id) }))!.status).toBe('DISCONNECTED');
    expect(await db.select().from(whatsappAuth).where(eq(whatsappAuth.tenantId, tenant.id))).toHaveLength(0);
    expect((await db.query.campaigns.findFirst({ where: eq(campaigns.id, c.id) }))!.status).toBe('CANCELLED');
    expect((await db.query.automations.findFirst({ where: eq(automations.id, a!.id) }))!.status).toBe('PAUSED');
    expect((await db.select().from(notifications).where(eq(notifications.tenantId, tenant.id))).map((n) => n.type)).toEqual(['trial.ended']);
    expect(await runTrialLifecycle()).toMatchObject({ ended: 0 }); // only once
  });

  it('a reminder goes out the day before', async () => {
    const { tenant } = await trialCompany(20 * 3_600_000);
    expect(await runTrialLifecycle()).toMatchObject({ reminded: 1, ended: 0 });
    await runTrialLifecycle();
    expect(await db.select().from(notifications).where(eq(notifications.tenantId, tenant.id))).toHaveLength(1);
  });

  it('upgrading brings sending back', async () => {
    const { cookie, json } = await signup(app);
    await db.update(tenants).set({ trialEndsAt: new Date(Date.now() - 1000) }).where(eq(tenants.id, json.tenant.id));
    const c = api(app, cookie);
    expect((await c.get('/api/auth/me')).json().tenant.plan.trialEnded).toBe(true);
    expect((await c.get('/api/whatsapp')).json().message).toBe('Your free trial has ended');
    await db.update(tenants).set({ plan: 'PAID' }).where(eq(tenants.id, json.tenant.id));
    expect((await c.get('/api/auth/me')).json().tenant.plan).toMatchObject({ plan: 'PAID', trialEnded: false });
  });
});

describe('one free trial per WhatsApp number', () => {
  it('a number already used for a trial can’t be linked to another trial', async () => {
    const a = await trialCompany();
    const b = await trialCompany();
    const paid = await makeTenant();
    for (const t of [a.tenant, b.tenant, paid.tenant]) await db.insert(whatsappSessions).values({ tenantId: t.id, status: 'CONNECTING' });

    expect(await onConnected(a.tenant.id, '+919848022338', 'Ravi')).toBe(true);
    expect(await onConnected(a.tenant.id, '+919848022338', 'Ravi')).toBe(true); // relinking your own is fine
    expect(await onConnected(b.tenant.id, '+919848022338', 'Ravi')).toBe(false);
    const s = await db.query.whatsappSessions.findFirst({ where: eq(whatsappSessions.tenantId, b.tenant.id) });
    expect(s).toMatchObject({ status: 'DISCONNECTED', phone: null });
    expect(s!.lastError).toContain('already been used for a free trial');
    expect(await onConnected(paid.tenant.id, '+919848022338', 'Ravi')).toBe(true); // not a trial
  });
});

import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { campaigns, contacts, messages, suppressions, tenants } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { countEmailAudience } from '../src/modules/audience/resolve.js';
import { MemoryEmailProvider } from '../src/modules/email/memory-provider.js';
import { SendError } from '../src/modules/email/types.js';
import { runSchedulerTick } from '../src/modules/scheduler/tick.js';
import { processSendJob } from '../src/modules/sending/send-message.js';
import { CampaignError, startCampaign } from '../src/modules/sending/start-campaign.js';
import { fakeQueue, makeCampaign, makeContact, makeList, makeTenant, resetDb } from './helpers.js';

const provider = new MemoryEmailProvider();

beforeEach(async () => {
  await resetDb();
  provider.clear();
});
afterAll(closeDatabase);

async function campaignRow(id: string) {
  return (await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) }))!;
}

describe('audience', () => {
  it('excludes unsubscribed, bounced, suppressed and email-less contacts', async () => {
    const { tenant } = await makeTenant();
    await makeContact(tenant.id);
    await makeContact(tenant.id, { emailStatus: 'UNSUBSCRIBED' });
    await makeContact(tenant.id, { emailStatus: 'BOUNCED' });
    await makeContact(tenant.id, { email: null, phone: '+919848012345' });
    const s = await makeContact(tenant.id);
    await db.insert(suppressions).values({ tenantId: tenant.id, address: s.email!, reason: 'MANUAL' });
    expect(await countEmailAudience(db, tenant.id, null)).toBe(1);
  });

  it('never leaks contacts from another tenant', async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await makeContact(a.tenant.id);
    const other = await makeContact(b.tenant.id);
    expect(await countEmailAudience(db, a.tenant.id, { contactIds: [other.id] })).toBe(0);
  });

  it('combines lists, hand-picked contacts and attribute filters', async () => {
    const { tenant } = await makeTenant();
    const hyd1 = await makeContact(tenant.id, { attributes: { city: 'Hyderabad' } });
    const hyd2 = await makeContact(tenant.id, { attributes: { city: 'hyderabad' } });
    const vij = await makeContact(tenant.id, { attributes: { city: 'Vijayawada' } });
    const list = await makeList(tenant.id, 'Pilgrimage', [hyd1.id, vij.id]);

    expect(await countEmailAudience(db, tenant.id, { listIds: [list.id] })).toBe(2);
    expect(await countEmailAudience(db, tenant.id, { listIds: [list.id], contactIds: [hyd2.id] })).toBe(3);
    expect(
      await countEmailAudience(db, tenant.id, { filters: [{ field: 'city', op: 'eq', value: 'HYDERABAD' }] }),
    ).toBe(2);
    expect(
      await countEmailAudience(db, tenant.id, {
        listIds: [list.id],
        filters: [{ field: 'city', op: 'contains', value: 'vija' }],
      }),
    ).toBe(1);
    expect(await countEmailAudience(db, tenant.id, { filters: [{ field: 'city', op: 'contains', value: '%' }] })).toBe(0);
  });
});

describe('startCampaign', () => {
  it('creates one message per recipient and queues them', async () => {
    const { tenant, sender } = await makeTenant();
    await makeContact(tenant.id);
    await makeContact(tenant.id);
    const c = await makeCampaign(tenant.id, sender.id);
    const q = fakeQueue();

    expect(await startCampaign(c.id, { enqueue: q.enqueue })).toEqual({ recipients: 2 });
    expect(q.queued).toHaveLength(2);
    const row = await campaignRow(c.id);
    expect(row.status).toBe('SENDING');
    expect(row.recipients).toBe(2);
  });

  it('cannot be started twice', async () => {
    const { tenant, sender } = await makeTenant();
    await makeContact(tenant.id);
    const c = await makeCampaign(tenant.id, sender.id);
    const q = fakeQueue();
    await startCampaign(c.id, { enqueue: q.enqueue });
    await expect(startCampaign(c.id, { enqueue: q.enqueue })).rejects.toMatchObject({ code: 'not_startable' });
    expect(q.queued).toHaveLength(1);
  });

  it('refuses to go over the monthly quota and queues nothing', async () => {
    const { tenant, sender } = await makeTenant({ monthlyQuota: 2 });
    for (let i = 0; i < 3; i++) await makeContact(tenant.id);
    const c = await makeCampaign(tenant.id, sender.id);
    const q = fakeQueue();
    const err = await startCampaign(c.id, { enqueue: q.enqueue }).catch((e) => e);
    expect(err).toBeInstanceOf(CampaignError);
    expect(err.code).toBe('quota_exceeded');
    expect(q.queued).toHaveLength(0);
    expect((await campaignRow(c.id)).status).toBe('DRAFT');
  });

  it('finishes immediately when nobody matches', async () => {
    const { tenant, sender } = await makeTenant();
    const c = await makeCampaign(tenant.id, sender.id);
    expect(await startCampaign(c.id, { enqueue: fakeQueue().enqueue })).toEqual({ recipients: 0 });
    expect((await campaignRow(c.id)).status).toBe('SENT');
  });
});

describe('processSendJob', () => {
  it('sends a personalised email with one-click unsubscribe headers and completes the campaign', async () => {
    const { tenant, sender } = await makeTenant();
    await makeContact(tenant.id, { firstName: 'Lakshmi', email: 'Lakshmi@Example.com', attributes: { city: 'Guntur' } });
    const c = await makeCampaign(tenant.id, sender.id);
    const q = fakeQueue();
    await startCampaign(c.id, { enqueue: q.enqueue });

    expect(await processSendJob(q.queued[0]!, provider)).toBe('sent');

    const email = provider.outbox[0]!;
    expect(email.to).toBe('lakshmi@example.com');
    expect(email.subject).toBe('Lakshmi, Kashi yatra seats are open');
    expect(email.html).toContain('Namaste Lakshmi');
    expect(email.html).toContain('Trip from Guntur');
    expect(email.headers['List-Unsubscribe']).toMatch(/^<https:\/\/campaigns\.example\.in\/u\/.+>$/);
    expect(email.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(email.tags.message_id).toBe(q.queued[0]);
    expect(email.replyTo).toBe('bookings@kurukshetra-travels.in');

    const msg = (await db.query.messages.findFirst({ where: eq(messages.id, q.queued[0]!) }))!;
    expect(msg.status).toBe('SENT');
    expect(msg.providerMessageId).toBe(email.providerMessageId);

    const row = await campaignRow(c.id);
    expect(row.sent).toBe(1);
    expect(row.status).toBe('SENT');
  });

  it('is safe to run twice for the same message', async () => {
    const { tenant, sender } = await makeTenant();
    await makeContact(tenant.id);
    const c = await makeCampaign(tenant.id, sender.id);
    const q = fakeQueue();
    await startCampaign(c.id, { enqueue: q.enqueue });
    await processSendJob(q.queued[0]!, provider);
    expect(await processSendJob(q.queued[0]!, provider)).toBe('already_processed');
    expect(provider.outbox).toHaveLength(1);
  });

  it('skips someone who unsubscribed after the campaign was queued', async () => {
    const { tenant, sender } = await makeTenant();
    const contact = await makeContact(tenant.id);
    const c = await makeCampaign(tenant.id, sender.id);
    const q = fakeQueue();
    await startCampaign(c.id, { enqueue: q.enqueue });
    await db.update(contacts).set({ emailStatus: 'UNSUBSCRIBED' }).where(eq(contacts.id, contact.id));

    expect(await processSendJob(q.queued[0]!, provider)).toBe('suppressed');
    expect(provider.outbox).toHaveLength(0);
    const row = await campaignRow(c.id);
    expect(row.suppressed).toBe(1);
    expect(row.status).toBe('SENT');
  });

  it('retries temporary SES errors but fails permanent ones straight away', async () => {
    const { tenant, sender } = await makeTenant();
    await makeContact(tenant.id);
    await makeContact(tenant.id);
    const c = await makeCampaign(tenant.id, sender.id);
    const q = fakeQueue();
    await startCampaign(c.id, { enqueue: q.enqueue });

    provider.failNext(new SendError('Rate exceeded', false, 'ThrottlingException'));
    await expect(processSendJob(q.queued[0]!, provider)).rejects.toThrow('Rate exceeded');
    const retrying = (await db.query.messages.findFirst({ where: eq(messages.id, q.queued[0]!) }))!;
    expect(retrying.status).toBe('QUEUED');
    expect(retrying.attempts).toBe(1);
    expect(await processSendJob(q.queued[0]!, provider)).toBe('sent');

    provider.failNext(new SendError('Email address is not verified', true, 'MessageRejected'));
    expect(await processSendJob(q.queued[1]!, provider)).toBe('failed');
    const row = await campaignRow(c.id);
    expect(row.sent).toBe(1);
    expect(row.failed).toBe(1);
    expect(row.status).toBe('SENT');
  });

  it('does not send for a paused tenant', async () => {
    const { tenant, sender } = await makeTenant();
    await makeContact(tenant.id);
    const c = await makeCampaign(tenant.id, sender.id);
    const q = fakeQueue();
    await startCampaign(c.id, { enqueue: q.enqueue });
    await db.update(tenants).set({ status: 'PAUSED' }).where(eq(tenants.id, tenant.id));
    expect(await processSendJob(q.queued[0]!, provider)).toBe('failed');
    expect(provider.outbox).toHaveLength(0);
  });
});

describe('scheduler', () => {
  it('starts campaigns whose time has come, and only those', async () => {
    const { tenant, sender } = await makeTenant();
    await makeContact(tenant.id);
    const now = new Date('2026-11-08T04:30:00Z'); // 10:00 IST
    const due = await makeCampaign(tenant.id, sender.id, { status: 'SCHEDULED', scheduledAt: new Date('2026-11-08T04:30:00Z') });
    const late = await makeCampaign(tenant.id, sender.id, { status: 'SCHEDULED', scheduledAt: new Date('2026-11-07T04:30:00Z') });
    const future = await makeCampaign(tenant.id, sender.id, { status: 'SCHEDULED', scheduledAt: new Date('2026-11-09T04:30:00Z') });
    const q = fakeQueue();

    const res = await runSchedulerTick({ now, enqueue: q.enqueue });
    expect(res.started.sort()).toEqual([due.id, late.id].sort());
    expect((await campaignRow(future.id)).status).toBe('SCHEDULED');
    expect(q.queued).toHaveLength(2);

    // Next minute: nothing new
    expect((await runSchedulerTick({ now, enqueue: q.enqueue })).started).toEqual([]);
  });

  it('marks a scheduled campaign as failed with a reason instead of retrying forever', async () => {
    const { tenant, sender } = await makeTenant({ monthlyQuota: 0 });
    await makeContact(tenant.id);
    const c = await makeCampaign(tenant.id, sender.id, { status: 'SCHEDULED', scheduledAt: new Date('2026-01-01') });
    const res = await runSchedulerTick({ enqueue: fakeQueue().enqueue });
    expect(res.failed[0]?.campaignId).toBe(c.id);
    const row = await campaignRow(c.id);
    expect(row.status).toBe('FAILED');
    expect(row.lastError).toMatch(/left this month/);
  });
});

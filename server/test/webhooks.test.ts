import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { campaigns, contacts, messages, suppressions, tenants, trackedLinks } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { MemoryEmailProvider } from '../src/modules/email/memory-provider.js';
import { processSendJob } from '../src/modules/sending/send-message.js';
import { startCampaign } from '../src/modules/sending/start-campaign.js';
import { evaluateTenantHealth, HEALTH } from '../src/modules/webhooks/tenant-health.js';
import { fakeQueue, makeCampaign, makeContact, makeTenant, resetDb } from './helpers.js';

const provider = new MemoryEmailProvider();
const confirmed: string[] = [];
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({
    webhooks: { verify: async (m) => m.Signature === 'valid', confirmSubscription: async (u) => void confirmed.push(u) },
  });
});
afterAll(async () => {
  await app.close();
  await closeRedis();
  await closeDatabase();
});
beforeEach(async () => {
  await resetDb();
  provider.clear();
});

/** One sent campaign email, ready to receive events. */
async function sentMessage() {
  const { tenant, sender } = await makeTenant();
  const contact = await makeContact(tenant.id, { email: 'ravi@example.com' });
  const c = await makeCampaign(tenant.id, sender.id);
  const q = fakeQueue();
  await startCampaign(c.id, { enqueue: q.enqueue });
  await processSendJob(q.queued[0]!, provider);
  const msg = (await db.query.messages.findFirst({ where: eq(messages.id, q.queued[0]!) }))!;
  return { tenant, contact, campaign: c, msg };
}

let snsSeq = 0;
function post(sesEvent: object, opts: { signature?: string; snsId?: string } = {}) {
  return app.inject({
    method: 'POST',
    url: '/webhooks/ses',
    headers: { 'content-type': 'text/plain; charset=UTF-8' },
    payload: JSON.stringify({
      Type: 'Notification',
      MessageId: opts.snsId ?? `sns-${++snsSeq}`,
      TopicArn: 'arn:aws:sns:ap-south-1:123:ses-events',
      Message: JSON.stringify(sesEvent),
      Timestamp: new Date().toISOString(),
      SignatureVersion: '2',
      Signature: opts.signature ?? 'valid',
      SigningCertURL: 'https://sns.ap-south-1.amazonaws.com/x.pem',
    }),
  });
}

const mail = (msg: { id: string; providerMessageId: string | null }) => ({
  messageId: msg.providerMessageId,
  tags: { message_id: [msg.id] },
});

async function campaignRow(id: string) {
  return (await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) }))!;
}

describe('SES webhook', () => {
  it('rejects unsigned or forged notifications', async () => {
    const { msg } = await sentMessage();
    const res = await post({ eventType: 'Delivery', mail: mail(msg) }, { signature: 'forged' });
    expect(res.statusCode).toBe(403);
    const after = (await db.query.messages.findFirst({ where: eq(messages.id, msg.id) }))!;
    expect(after.status).toBe('SENT');
  });

  it('confirms the SNS subscription only for AWS URLs', async () => {
    const sub = (url: string) =>
      app.inject({
        method: 'POST',
        url: '/webhooks/ses',
        headers: { 'content-type': 'text/plain' },
        payload: JSON.stringify({
          Type: 'SubscriptionConfirmation', MessageId: 'm', TopicArn: 't', Message: 'x', Timestamp: 't',
          SignatureVersion: '2', Signature: 'valid', SigningCertURL: 'https://sns.ap-south-1.amazonaws.com/x.pem',
          Token: 'tok', SubscribeURL: url,
        }),
      });
    expect((await sub('https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription')).statusCode).toBe(200);
    expect((await sub('https://attacker.example.com/')).statusCode).toBe(400);
    expect(confirmed).toEqual(['https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription']);
  });

  it('records deliveries once even if SNS delivers the same notification twice', async () => {
    const { msg, campaign } = await sentMessage();
    const ev = { eventType: 'Delivery', mail: mail(msg), delivery: { timestamp: '2026-11-03T10:00:01Z' } };
    expect((await post(ev, { snsId: 'dup-1' })).json().result).toBe('processed');
    expect((await post(ev, { snsId: 'dup-1' })).json().result).toBe('duplicate');
    expect((await campaignRow(campaign.id)).delivered).toBe(1);
    const after = (await db.query.messages.findFirst({ where: eq(messages.id, msg.id) }))!;
    expect(after.status).toBe('DELIVERED');
  });

  it('suppresses an address after a hard bounce, but not after a soft one', async () => {
    const { msg, contact, campaign, tenant } = await sentMessage();

    await post({ eventType: 'Bounce', mail: mail(msg), bounce: { bounceType: 'Transient', bounceSubType: 'MailboxFull' } });
    expect(await db.select().from(suppressions)).toHaveLength(0);

    await post({ eventType: 'Bounce', mail: mail(msg), bounce: { bounceType: 'Permanent', bounceSubType: 'General' } });
    const [sup] = await db.select().from(suppressions).where(eq(suppressions.tenantId, tenant.id));
    expect(sup?.address).toBe('ravi@example.com');
    expect(sup?.reason).toBe('HARD_BOUNCE');
    expect((await db.query.contacts.findFirst({ where: eq(contacts.id, contact.id) }))!.emailStatus).toBe('BOUNCED');
    expect((await campaignRow(campaign.id)).bounced).toBe(1);
  });

  it('handles spam complaints', async () => {
    const { msg, contact, campaign } = await sentMessage();
    await post({ eventType: 'Complaint', mail: mail(msg), complaint: { complaintFeedbackType: 'abuse' } });
    expect((await db.query.contacts.findFirst({ where: eq(contacts.id, contact.id) }))!.emailStatus).toBe('COMPLAINED');
    expect((await campaignRow(campaign.id)).complained).toBe(1);
  });

  it('counts unique opens and clicks, and tallies clicks per link', async () => {
    const { msg, campaign } = await sentMessage();
    const link = 'https://kurukshetra-travels.com/kashi';
    await post({ eventType: 'Open', mail: mail(msg) });
    await post({ eventType: 'Open', mail: mail(msg) });
    await post({ eventType: 'Click', mail: mail(msg), click: { link } });
    await post({ eventType: 'Click', mail: mail(msg), click: { link } });
    const row = await campaignRow(campaign.id);
    expect(row.opened).toBe(1);
    expect(row.clicked).toBe(1);
    const [tl] = await db.select().from(trackedLinks).where(eq(trackedLinks.campaignId, campaign.id));
    expect(tl?.clicks).toBe(2);
  });

  it('finds the message by SES id when the tag is missing', async () => {
    const { msg } = await sentMessage();
    const res = await post({ eventType: 'Delivery', mail: { messageId: msg.providerMessageId } });
    expect(res.json().result).toBe('processed');
  });

  it('ignores events for messages it does not know', async () => {
    const res = await post({ eventType: 'Delivery', mail: { messageId: 'nope' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toBe('unknown_message');
  });
});

describe('tenant auto-pause', () => {
  it('pauses a tenant whose bounce rate crosses the limit', async () => {
    const { tenant, sender } = await makeTenant({ monthlyQuota: 10_000 });
    const c = await makeCampaign(tenant.id, sender.id);
    const n = HEALTH.minSample;
    const bounced = Math.ceil(n * HEALTH.maxBounceRate);
    await db.insert(messages).values(
      Array.from({ length: n }, (_, i) => ({
        tenantId: tenant.id,
        campaignId: c.id,
        toAddress: `p${i}@example.com`,
        status: i < bounced ? ('BOUNCED' as const) : ('DELIVERED' as const),
        sentAt: new Date(),
      })),
    );
    expect(await evaluateTenantHealth(tenant.id)).toBe(true);
    const t = (await db.query.tenants.findFirst({ where: eq(tenants.id, tenant.id) }))!;
    expect(t.status).toBe('PAUSED');
    expect(t.pausedReason).toMatch(/Bounce rate/);
  });

  it('does not judge tenants on a tiny sample', async () => {
    const { tenant, sender } = await makeTenant();
    const c = await makeCampaign(tenant.id, sender.id);
    await db.insert(messages).values({ tenantId: tenant.id, campaignId: c.id, toAddress: 'a@x.com', status: 'BOUNCED', sentAt: new Date() });
    expect(await evaluateTenantHealth(tenant.id)).toBe(false);
  });
});

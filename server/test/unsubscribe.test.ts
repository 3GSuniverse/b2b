import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { campaigns, contacts, suppressions } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { MemoryEmailProvider } from '../src/modules/email/memory-provider.js';
import { processSendJob } from '../src/modules/sending/send-message.js';
import { startCampaign } from '../src/modules/sending/start-campaign.js';
import { fakeQueue, makeCampaign, makeContact, makeTenant, resetDb } from './helpers.js';

const provider = new MemoryEmailProvider();
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
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

async function sentEmail() {
  const { tenant, sender } = await makeTenant();
  const contact = await makeContact(tenant.id, { email: 'suresh@example.com' });
  const c = await makeCampaign(tenant.id, sender.id);
  const q = fakeQueue();
  await startCampaign(c.id, { enqueue: q.enqueue });
  await processSendJob(q.queued[0]!, provider);
  const header = provider.outbox[0]!.headers['List-Unsubscribe']!;
  const path = new URL(header.slice(1, -1)).pathname;
  return { contact, campaign: c, path };
}

describe('unsubscribe', () => {
  it('GET shows a confirmation page but changes nothing (link scanners are safe)', async () => {
    const { path, contact } = await sentEmail();
    const res = await app.inject({ method: 'GET', url: path });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Unsubscribe from Kurukshetra Travels?');
    expect(res.body).toContain('su••••@example.com');
    expect(res.body).not.toContain('suresh@example.com');
    expect((await db.query.contacts.findFirst({ where: eq(contacts.id, contact.id) }))!.emailStatus).toBe('SUBSCRIBED');
  });

  it('Gmail one-click POST unsubscribes, suppresses and counts it once', async () => {
    const { path, contact, campaign } = await sentEmail();
    const oneClick = () =>
      app.inject({
        method: 'POST',
        url: path,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'List-Unsubscribe=One-Click',
      });
    expect((await oneClick()).statusCode).toBe(200);
    expect((await oneClick()).statusCode).toBe(200);

    expect((await db.query.contacts.findFirst({ where: eq(contacts.id, contact.id) }))!.emailStatus).toBe('UNSUBSCRIBED');
    expect(await db.select().from(suppressions)).toHaveLength(1);
    expect((await db.query.campaigns.findFirst({ where: eq(campaigns.id, campaign.id) }))!.unsubscribed).toBe(1);

    const again = await app.inject({ method: 'GET', url: path });
    expect(again.body).toContain('already unsubscribed');
  });

  it('the page button POST shows a friendly confirmation', async () => {
    const { path } = await sentEmail();
    const res = await app.inject({ method: 'POST', url: path });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('You’re unsubscribed');
  });

  it('rejects tampered links', async () => {
    const { path } = await sentEmail();
    const res = await app.inject({ method: 'POST', url: `${path.slice(0, -2)}xx` });
    expect(res.statusCode).toBe(404);
  });
});

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { campaigns, sendingDomains } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { setDnsLookup, type DnsRecord } from '../src/modules/domains/dns.js';
import { MemoryIdentityProvider, setIdentityProvider } from '../src/modules/domains/identity-provider.js';
import { refreshPendingDomains } from '../src/modules/domains/service.js';
import { normalizeDomain } from '../src/modules/domains/validate.js';
import { CampaignError, startCampaign } from '../src/modules/sending/start-campaign.js';
import { api, FakeDns, signup } from './api-helpers.js';
import { fakeQueue, makeContact, resetDb } from './helpers.js';

const ses = new MemoryIdentityProvider();
const dns = new FakeDns();
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  setIdentityProvider(ses);
  setDnsLookup(dns);
  app = await buildApp({ authRateLimit: 10_000 });
});
afterAll(async () => {
  await app.close();
  await closeRedis();
  await closeDatabase();
});
beforeEach(async () => {
  await resetDb();
  ses.domains.clear();
  dns.clear();
});

/** Plays the company's part: adds every required record to their DNS. */
function publish(records: DnsRecord[], opts: { skip?: DnsRecord['purpose'][] } = {}) {
  for (const r of records) {
    if (opts.skip?.includes(r.purpose) || !r.required) continue;
    dns.add(r.type, r.name, r.value, r.priority);
  }
}

describe('domain input', () => {
  it('cleans up whatever the user pastes', () => {
    expect(normalizeDomain('https://www.ABC-Holidays.com/contact?x=1')).toBe('abc-holidays.com');
    expect(normalizeDomain('offers@abcholidays.co.in')).toBe('abcholidays.co.in');
    expect(normalizeDomain('  mail.abc.in. ')).toBe('mail.abc.in');
  });

  it('rejects free mailbox domains with a helpful reason', () => {
    expect(() => normalizeDomain('gmail.com')).toThrow(/own domain/);
    expect(() => normalizeDomain('someone@yahoo.co.in')).toThrow(/own domain/);
  });

  it('rejects things that are not domains', () => {
    for (const bad of ['abc', 'abc..com', '-abc.com', 'abc.c0m', 'a b.com']) {
      expect(() => normalizeDomain(bad)).toThrow(/like yourcompany.com/);
    }
  });
});

describe('connecting a domain', () => {
  it('returns every DNS record the company needs to add', async () => {
    const { cookie } = await signup(app);
    const res = await api(app, cookie).post('/api/domains', { domain: 'www.abcholidays.com' });
    expect(res.statusCode).toBe(201);
    const d = res.json().domain;
    expect(d).toMatchObject({ domain: 'abcholidays.com', mailFromDomain: 'mail.abcholidays.com', status: 'pending', readyToSend: false });

    const byPurpose = (p: string) => d.records.filter((r: DnsRecord) => r.purpose === p);
    expect(byPurpose('ownership')[0]).toMatchObject({ type: 'TXT', name: '_sandesh.abcholidays.com' });
    expect(byPurpose('ownership')[0].value).toMatch(/^sandesh-verify=/);
    expect(byPurpose('dkim')).toHaveLength(3);
    expect(byPurpose('dkim')[0].value).toMatch(/\.dkim\.amazonses\.com$/);
    expect(byPurpose('mail_from_mx')[0]).toMatchObject({ type: 'MX', name: 'mail.abcholidays.com', value: 'feedback-smtp.ap-south-1.amazonses.com', priority: 10 });
    expect(byPurpose('dmarc')[0]).toMatchObject({ required: false });
  });

  it('adding the same domain again in the same company is harmless', async () => {
    const { cookie } = await signup(app);
    const a = await api(app, cookie).post('/api/domains', { domain: 'abc.in' });
    const b = await api(app, cookie).post('/api/domains', { domain: 'ABC.in' });
    expect(b.json().domain.id).toBe(a.json().domain.id);
  });

  it('becomes verified only when SES verifies AND the company proves ownership', async () => {
    const { cookie } = await signup(app);
    const c = api(app, cookie);
    const d = (await c.post('/api/domains', { domain: 'abc.in' })).json().domain;

    // SES sees DKIM, but the ownership TXT is missing → still not ready
    publish(d.records, { skip: ['ownership'] });
    ses.markVerified('abc.in');
    let checked = (await c.post(`/api/domains/${d.id}/check`)).json().domain;
    expect(checked.readyToSend).toBe(false);
    expect(checked.checks).toMatchObject({ ownership: 'PENDING', domain: 'VERIFIED', dkim: 'VERIFIED' });
    expect(checked.records.find((r: DnsRecord) => r.purpose === 'ownership').found).toBe(false);
    expect(checked.records.filter((r: DnsRecord) => r.purpose === 'dkim').every((r: DnsRecord) => r.found)).toBe(true);

    // Now the TXT record appears
    publish(d.records.filter((r: DnsRecord) => r.purpose === 'ownership'));
    checked = (await c.post(`/api/domains/${d.id}/check`)).json().domain;
    expect(checked).toMatchObject({ status: 'verified', readyToSend: true });
    expect(checked.verifiedAt).toBeTruthy();
  });

  it('respects a DMARC record the company already has', async () => {
    const { cookie } = await signup(app);
    const c = api(app, cookie);
    const d = (await c.post('/api/domains', { domain: 'abc.in' })).json().domain;
    dns.add('TXT', '_dmarc.abc.in', 'v=DMARC1; p=quarantine; rua=mailto:dmarc@abc.in');
    const checked = (await c.post(`/api/domains/${d.id}/check`)).json().domain;
    expect(checked.records.find((r: DnsRecord) => r.purpose === 'dmarc').found).toBe(true);
  });

  it('works for a domain that was already set up in SES by hand — ownership is still required', async () => {
    await ses.createDomain('kurukshetra-travels.in');
    ses.markVerified('kurukshetra-travels.in');
    const { cookie } = await signup(app);
    const c = api(app, cookie);
    const d = (await c.post('/api/domains', { domain: 'kurukshetra-travels.in' })).json().domain;
    expect(d.checks.domain).toBe('VERIFIED');
    expect(d.readyToSend).toBe(false); // SES verified, but this account hasn't proven it owns it
  });
});

describe('privacy between companies', () => {
  it('a company cannot claim a domain another company connected', async () => {
    const a = await signup(app);
    const b = await signup(app);
    expect((await api(app, a.cookie).post('/api/domains', { domain: 'abc.in' })).statusCode).toBe(201);
    const res = await api(app, b.cookie).post('/api/domains', { domain: 'abc.in' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('domain_taken');
  });

  it('a company cannot see, check or delete another company’s domain', async () => {
    const a = await signup(app);
    const b = await signup(app);
    const d = (await api(app, a.cookie).post('/api/domains', { domain: 'abc.in' })).json().domain;
    const other = api(app, b.cookie);
    expect((await other.get(`/api/domains/${d.id}`)).statusCode).toBe(404);
    expect((await other.post(`/api/domains/${d.id}/check`)).statusCode).toBe(404);
    expect((await other.del(`/api/domains/${d.id}`)).statusCode).toBe(404);
    expect((await other.get('/api/domains')).json().domains).toEqual([]);
  });
});

describe('background checks', () => {
  it('keeps checking pending domains and verifies them without anyone clicking', async () => {
    const { cookie } = await signup(app);
    const d = (await api(app, cookie).post('/api/domains', { domain: 'abc.in' })).json().domain;
    publish(d.records);
    ses.markVerified('abc.in');
    const res = await refreshPendingDomains();
    expect(res).toEqual({ checked: 1, verified: 1 });
    // Checked recently → skipped next time
    expect((await refreshPendingDomains()).checked).toBe(0);
  });
});

describe('senders', () => {
  it('creates senders only on the company’s own domain, first one is the default', async () => {
    const { cookie } = await signup(app);
    const c = api(app, cookie);
    const d = (await c.post('/api/domains', { domain: 'abc.in' })).json().domain;

    const wrong = await c.post('/api/senders', { domainId: d.id, fromName: 'ABC', fromEmail: 'offers@gmail.com' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().details.fields.fromEmail).toMatch(/@abc\.in/);

    const first = await c.post('/api/senders', { domainId: d.id, fromName: 'ABC Holidays', fromEmail: 'Offers@ABC.in', replyTo: 'bookings@abc.in' });
    expect(first.statusCode).toBe(201);
    expect(first.json().sender).toMatchObject({ fromEmail: 'offers@abc.in', isDefault: true, readyToSend: false });

    const second = await c.post('/api/senders', { domainId: d.id, fromName: 'ABC Trips', fromEmail: 'trips@abc.in', isDefault: true });
    expect(second.json().sender.isDefault).toBe(true);
    const list = (await c.get('/api/senders')).json().senders;
    expect(list.filter((s: { isDefault: boolean }) => s.isDefault)).toHaveLength(1);

    expect((await c.post('/api/senders', { domainId: d.id, fromName: 'Dup', fromEmail: 'offers@abc.in' })).statusCode).toBe(409);
  });

  it('cannot use another company’s domain for a sender', async () => {
    const a = await signup(app);
    const b = await signup(app);
    const d = (await api(app, a.cookie).post('/api/domains', { domain: 'abc.in' })).json().domain;
    const res = await api(app, b.cookie).post('/api/senders', { domainId: d.id, fromName: 'Fake', fromEmail: 'ceo@abc.in' });
    expect(res.statusCode).toBe(404);
  });

  it('a campaign cannot start until its sender’s domain is verified', async () => {
    const { cookie, json } = await signup(app);
    const c = api(app, cookie);
    const d = (await c.post('/api/domains', { domain: 'abc.in' })).json().domain;
    const sender = (await c.post('/api/senders', { domainId: d.id, fromName: 'ABC', fromEmail: 'offers@abc.in' })).json().sender;
    await makeContact(json.tenant.id);
    const [camp] = await db
      .insert(campaigns)
      .values({ tenantId: json.tenant.id, senderId: sender.id, name: 'x', subject: 'Hi', html: '<p>Hi</p>' })
      .returning();

    const err = await startCampaign(camp!.id, { enqueue: fakeQueue().enqueue }).catch((e) => e);
    expect(err).toBeInstanceOf(CampaignError);
    expect(err.code).toBe('sender_not_verified');

    publish(d.records);
    ses.markVerified('abc.in');
    await c.post(`/api/domains/${d.id}/check`);
    expect(await startCampaign(camp!.id, { enqueue: fakeQueue().enqueue })).toEqual({ recipients: 1 });
  });

  it('a domain used by a sending campaign cannot be deleted', async () => {
    const { cookie, json } = await signup(app);
    const c = api(app, cookie);
    const d = (await c.post('/api/domains', { domain: 'abc.in' })).json().domain;
    const sender = (await c.post('/api/senders', { domainId: d.id, fromName: 'ABC', fromEmail: 'offers@abc.in' })).json().sender;
    await db.insert(campaigns).values({ tenantId: json.tenant.id, senderId: sender.id, name: 'x', status: 'SENDING' });
    expect((await c.del(`/api/domains/${d.id}`)).statusCode).toBe(409);
    await db.update(campaigns).set({ status: 'SENT' });
    expect((await c.del(`/api/domains/${d.id}`)).statusCode).toBe(204);
    expect(await db.select().from(sendingDomains).where(eq(sendingDomains.id, d.id))).toHaveLength(0);
    expect(ses.domains.has('abc.in')).toBe(false);
  });
});

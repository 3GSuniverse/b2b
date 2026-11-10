import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { campaigns, mailboxConnections, messages, senders, tenants } from '../src/db/schema.js';
import { decryptSecret } from '../src/lib/crypto.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { setGoogleFetch } from '../src/modules/mailboxes/google.js';
import { buildMime, encodeHeader } from '../src/modules/mailboxes/mime.js';
import { MemoryEmailProvider } from '../src/modules/email/memory-provider.js';
import { DeferSend, processSendJob } from '../src/modules/sending/send-message.js';
import { CampaignError, startCampaign } from '../src/modules/sending/start-campaign.js';
import { api, employee, signup } from './api-helpers.js';
import { FakeGoogle, mimePart } from './fake-google.js';
import { fakeQueue, makeContact, resetDb } from './helpers.js';

const google = new FakeGoogle();
const ses = new MemoryEmailProvider(); // must never be used for Gmail senders
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  setGoogleFetch(google.fetch as typeof fetch);
  app = await buildApp({ authRateLimit: 10_000 });
});
afterAll(async () => {
  await app.close();
  await closeRedis();
  await closeDatabase();
});
beforeEach(async () => {
  await resetDb();
  google.reset();
  ses.clear();
});

/** Runs the whole "Connect Gmail" dance as a browser would. */
async function connectGmail(cookie: string, opts: { tamperState?: boolean; stateFrom?: string; denied?: boolean } = {}) {
  const start = await app.inject({ method: 'GET', url: '/api/integrations/gmail/connect', headers: { cookie } });
  expect(start.statusCode).toBe(302);
  const googleUrl = new URL(start.headers.location as string);
  const pkce = start.cookies.find((c) => c.name === 'g_pkce')!;
  let state = googleUrl.searchParams.get('state')!;
  if (opts.tamperState) state = state.slice(0, -3) + 'abc';
  if (opts.stateFrom) state = opts.stateFrom;
  const qs = opts.denied ? 'error=access_denied' : `code=auth-code&state=${encodeURIComponent(state)}`;
  const back = await app.inject({
    method: 'GET',
    url: `/api/integrations/gmail/callback?${qs}`,
    headers: { cookie: `${cookie}; g_pkce=${pkce.value}` },
  });
  return { start, googleUrl, pkce, back, backUrl: new URL(back.headers.location as string) };
}

describe('every employee connects their own Gmail', () => {
  it('employees connect and remove their own; others can’t use or remove it; the owner sees all', async () => {
    const owner = await signup(app);
    await db.update(tenants).set({ plan: 'PAID', planId: 'basic', seats: 3, paidUntil: new Date(Date.now() + 20 * 86_400_000) }).where(eq(tenants.id, owner.json.tenant.id));
    const ravi = await employee(app, owner, 'ravi');
    const priya = await employee(app, owner, 'priya');

    google.email = 'ravi.kt@gmail.com';
    expect((await connectGmail(ravi.cookie)).backUrl.searchParams.get('gmail')).toBe('connected');
    google.email = 'priya.kt@gmail.com';
    expect((await connectGmail(priya.cookie)).backUrl.searchParams.get('gmail')).toBe('connected');

    const r = api(app, ravi.cookie);
    const p = api(app, priya.cookie);
    const raviBoxes = (await r.get('/api/mailboxes')).json().mailboxes;
    expect(raviBoxes.map((m: { email: string }) => m.email)).toEqual(['ravi.kt@gmail.com']);
    expect((await r.get('/api/senders')).json().senders.map((x: { fromEmail: string }) => x.fromEmail)).toEqual(['ravi.kt@gmail.com']);
    expect((await api(app, owner.cookie).get('/api/mailboxes')).json().mailboxes).toHaveLength(2);

    // Priya can't send from, rename or remove Ravi's Gmail
    const raviSender = (await r.get('/api/senders')).json().senders[0].id;
    expect((await p.post('/api/campaigns', { name: 'x', senderId: raviSender })).statusCode).toBe(404);
    expect((await p.patch(`/api/senders/${raviSender}`, { fromName: 'Not Ravi' })).statusCode).toBe(403);
    expect((await p.del(`/api/mailboxes/${raviBoxes[0].id}`)).statusCode).toBe(404);
    // A new broadcast of Ravi's goes from his own Gmail by default
    expect((await r.post('/api/campaigns', { name: 'Goa' })).json().campaign.sender.id).toBe(raviSender);
    expect((await r.patch(`/api/senders/${raviSender}`, { fromName: 'Ravi from KT' })).json().sender.fromName).toBe('Ravi from KT');
    expect((await p.del(`/api/senders/${raviSender}`)).statusCode).toBe(403);
    expect((await r.del(`/api/senders/${raviSender}`)).statusCode).toBe(204);
    expect((await r.del(`/api/mailboxes/${raviBoxes[0].id}`)).statusCode).toBe(204);
  });
});

describe('Connect Gmail', () => {
  it('sends the user to Google asking only for send permission, with PKCE', async () => {
    const { cookie } = await signup(app);
    const { googleUrl, pkce } = await connectGmail(cookie);
    expect(googleUrl.origin + googleUrl.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const q = googleUrl.searchParams;
    expect(q.get('scope')).toContain('https://www.googleapis.com/auth/gmail.send');
    expect(q.get('scope')).not.toContain('gmail.readonly');
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('redirect_uri')).toBe('https://campaigns.example.in/api/integrations/gmail/callback');
    expect(pkce.httpOnly).toBe(true);
  });

  it('stores tokens encrypted and creates a ready Gmail sender', async () => {
    const { cookie } = await signup(app);
    const { back, backUrl } = await connectGmail(cookie);
    expect(back.statusCode).toBe(303);
    expect(backUrl.origin + backUrl.pathname).toBe('https://app.example.in/settings/senders');
    expect(backUrl.searchParams.get('gmail')).toBe('connected');

    // Google received our PKCE verifier
    expect(google.tokenRequests[0]!.get('code_verifier')).toBeTruthy();

    const [conn] = await db.select().from(mailboxConnections);
    expect(conn!.email).toBe('ravi.kt@gmail.com');
    expect(conn!.refreshTokenEnc).not.toContain('refresh-');
    expect(decryptSecret(conn!.refreshTokenEnc)).toMatch(/^refresh-/);
    expect(conn!.dailyLimit).toBe(400);

    const list = (await api(app, cookie).get('/api/senders')).json().senders;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'GMAIL', fromEmail: 'ravi.kt@gmail.com', fromName: 'Ravi Kumar', isDefault: true, readyToSend: true });

    const boxes = (await api(app, cookie).get('/api/mailboxes')).json().mailboxes;
    expect(boxes[0]).toMatchObject({ email: 'ravi.kt@gmail.com', status: 'ACTIVE', sentLast24h: 0 });
    expect(boxes[0]).not.toHaveProperty('refreshTokenEnc');
  });

  it('reconnecting the same Gmail updates it instead of duplicating', async () => {
    const { cookie } = await signup(app);
    await connectGmail(cookie);
    await connectGmail(cookie);
    expect(await db.select().from(mailboxConnections)).toHaveLength(1);
    expect(await db.select().from(senders)).toHaveLength(1);
  });

  it('rejects a tampered state, or a state started by a different user', async () => {
    const a = await signup(app);
    const b = await signup(app);
    expect((await connectGmail(a.cookie, { tamperState: true })).backUrl.searchParams.get('reason')).toBe('invalid_state');

    const aStart = await app.inject({ method: 'GET', url: '/api/integrations/gmail/connect', headers: { cookie: a.cookie } });
    const aState = new URL(aStart.headers.location as string).searchParams.get('state')!;
    expect((await connectGmail(b.cookie, { stateFrom: aState })).backUrl.searchParams.get('reason')).toBe('invalid_state');
    expect(await db.select().from(mailboxConnections)).toHaveLength(0);
  });

  it('explains when the user unticked send permission on Google’s screen', async () => {
    google.grantedScopes = ['openid', 'https://www.googleapis.com/auth/userinfo.email'];
    const { cookie } = await signup(app);
    const { backUrl } = await connectGmail(cookie);
    expect(backUrl.searchParams.get('gmail')).toBe('error');
    expect(backUrl.searchParams.get('reason')).toBe('send_permission_missing');
  });

  it('handles the user pressing Cancel on Google’s screen', async () => {
    const { cookie } = await signup(app);
    expect((await connectGmail(cookie, { denied: true })).backUrl.searchParams.get('gmail')).toBe('cancelled');
  });

  it('only admins can connect a mailbox, and another company cannot disconnect it', async () => {
    const a = await signup(app);
    const b = await signup(app);
    await connectGmail(a.cookie);
    const [conn] = await db.select().from(mailboxConnections);
    expect((await api(app, b.cookie).del(`/api/mailboxes/${conn!.id}`)).statusCode).toBe(404);
    expect((await api(app, b.cookie).get('/api/mailboxes')).json().mailboxes).toEqual([]);
  });

  it('disconnecting revokes access at Google and removes the sender', async () => {
    const { cookie } = await signup(app);
    await connectGmail(cookie);
    const [conn] = await db.select().from(mailboxConnections);
    expect((await api(app, cookie).del(`/api/mailboxes/${conn!.id}`)).statusCode).toBe(204);
    expect(google.revoked[0]).toMatch(/^refresh-/);
    expect(await db.select().from(senders)).toHaveLength(0);
  });
});

/** A tenant with a connected Gmail sender and n contacts. */
async function gmailCampaign(contacts = 1) {
  const { cookie, json } = await signup(app);
  await connectGmail(cookie);
  const [sender] = await db.select().from(senders);
  for (let i = 0; i < contacts; i++) await makeContact(json.tenant.id, { firstName: 'లక్ష్మి' });
  const [c] = await db
    .insert(campaigns)
    .values({ tenantId: json.tenant.id, senderId: sender!.id, name: 'Kashi', subject: 'Namaste {first_name}', html: '<p>Hello {first_name}</p>' })
    .returning();
  const q = fakeQueue();
  await startCampaign(c!.id, { enqueue: q.enqueue });
  return { cookie, tenantId: json.tenant.id, sender: sender!, campaign: c!, queued: q.queued };
}

describe('sending through Gmail', () => {
  it('sends a proper email through the Gmail API, not SES', async () => {
    const { queued } = await gmailCampaign();
    expect(await processSendJob(queued[0]!, ses)).toBe('sent');
    expect(ses.outbox).toHaveLength(0);
    expect(google.sent).toHaveLength(1);

    const { mime, token } = google.sent[0]!;
    expect(token).toMatch(/^access-/);
    expect(mime).toMatch(/^From: "Ravi Kumar" <ravi\.kt@gmail\.com>\r\n/m);
    expect(mime).toMatch(/^Subject: =\?UTF-8\?B\?/m); // Telugu name in the subject, properly encoded
    expect(mime).toMatch(/^List-Unsubscribe: <https:\/\/campaigns\.example\.in\/u\/.+>$/m);
    expect(mime).toMatch(/^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
    expect(mimePart(mime, 'text/html')).toContain('Hello లక్ష్మి');
    expect(mimePart(mime, 'text/plain')).toContain('Unsubscribe:');

    const msg = (await db.query.messages.findFirst({ where: eq(messages.id, queued[0]!) }))!;
    expect(msg.status).toBe('SENT');
    expect(msg.providerMessageId).toBe('gmail:gm-1');
  });

  it('refreshes an expired access token automatically', async () => {
    const { queued } = await gmailCampaign();
    await db.update(mailboxConnections).set({ accessTokenExpiresAt: new Date(Date.now() - 1000) });
    await processSendJob(queued[0]!, ses);
    expect(google.tokenRequests.some((p) => p.get('grant_type') === 'refresh_token')).toBe(true);
    expect(google.sent).toHaveLength(1);
  });

  it('marks the mailbox disconnected when the user removed access in Google, and stops new campaigns', async () => {
    const { queued, campaign, tenantId, sender } = await gmailCampaign();
    await db.update(mailboxConnections).set({ accessTokenExpiresAt: new Date(Date.now() - 1000) });
    google.refreshRevoked = true;

    expect(await processSendJob(queued[0]!, ses)).toBe('failed');
    const [conn] = await db.select().from(mailboxConnections);
    expect(conn!.status).toBe('REVOKED');
    expect(conn!.lastError).toMatch(/Reconnect/);
    expect((await db.query.campaigns.findFirst({ where: eq(campaigns.id, campaign.id) }))!.failed).toBe(1);

    const [next] = await db.insert(campaigns).values({ tenantId, senderId: sender.id, name: 'n', subject: 's', html: '<p>x</p>' }).returning();
    const err = await startCampaign(next!.id, { enqueue: fakeQueue().enqueue }).catch((e) => e);
    expect(err).toBeInstanceOf(CampaignError);
    expect(err.message).toMatch(/Reconnect/);
  });

  it('retries when Gmail is rate limiting, without failing the message', async () => {
    const { queued } = await gmailCampaign();
    google.nextSendError = { status: 429, reason: 'rateLimitExceeded' };
    await expect(processSendJob(queued[0]!, ses)).rejects.toThrow();
    expect((await db.query.messages.findFirst({ where: eq(messages.id, queued[0]!) }))!.status).toBe('QUEUED');
    expect(await processSendJob(queued[0]!, ses)).toBe('sent');
  });

  it('holds emails back once the mailbox’s daily limit is used, instead of getting the account blocked', async () => {
    const { queued } = await gmailCampaign(2);
    await db.update(mailboxConnections).set({ dailyLimit: 1 });

    expect(await processSendJob(queued[0]!, ses)).toBe('sent');
    const deferred = await processSendJob(queued[1]!, ses).catch((e) => e);
    expect(deferred).toBeInstanceOf(DeferSend);
    const hours = (deferred.until.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);

    const held = (await db.query.messages.findFirst({ where: and(eq(messages.id, queued[1]!)) }))!;
    expect(held.status).toBe('QUEUED'); // not lost — sent when the window frees up
    expect(google.sent).toHaveLength(1);
  });
});

describe('MIME', () => {
  it('encodes non-English headers and never lets a line break into a header', () => {
    expect(encodeHeader('Hello')).toBe('Hello');
    expect(encodeHeader('నమస్తే')).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    const mime = buildMime({
      from: { name: 'ABC', email: 'a@abc.in' },
      to: 'x@y.in\r\nBcc: victim@z.in',
      subject: 'Hi\r\nBcc: victim@z.in',
      html: '<p>x</p>',
      text: 'x',
      headers: { 'X-Bad\r\nName': 'v', 'List-Unsubscribe': '<https://u>\r\nBcc: v@z.in' },
      tags: {},
    });
    expect(mime).not.toMatch(/^Bcc:/m);
    expect(mime).not.toContain('X-Bad');
  });
});

describe('Google credentials file', () => {
  it('reads the client file downloaded from Google Cloud', async () => {
    const { parseGoogleOAuthFile } = await import('../src/modules/mailboxes/google.js');
    const file = parseGoogleOAuthFile(
      JSON.stringify({
        web: {
          client_id: '123-abc.apps.googleusercontent.com',
          client_secret: 'GOCSPX-secret',
          redirect_uris: ['http://localhost:4000/api/integrations/gmail/callback'],
        },
      }),
    );
    expect(file).toEqual({
      clientId: '123-abc.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-secret',
      redirectUris: ['http://localhost:4000/api/integrations/gmail/callback'],
    });
    expect(() => parseGoogleOAuthFile('{"something":"else"}')).toThrow(/web.client_id/);
    expect(() => parseGoogleOAuthFile('not json')).toThrow(/not valid JSON/);
  });
});

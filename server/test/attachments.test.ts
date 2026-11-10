import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { campaigns, messages, whatsappSessions } from '../src/db/schema.js';
import { addBooking, broadcast, createGroup } from '../src/modules/groups/service.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { saveAttachment, removeUnusedAttachments } from '../src/modules/attachments/service.js';
import { MemoryEmailProvider } from '../src/modules/email/memory-provider.js';
import { buildMime } from '../src/modules/mailboxes/mime.js';
import { processSendJob } from '../src/modules/sending/send-message.js';
import { startCampaign } from '../src/modules/sending/start-campaign.js';
import { MemoryWhatsAppGateway } from '../src/modules/whatsapp/gateway.js';
import { processWhatsAppJob } from '../src/modules/whatsapp/service.js';
import { api, signup } from './api-helpers.js';
import { fakeQueue, makeCampaign, makeContact, makeTenant, resetDb, makeLine } from './helpers.js';

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

/** A browser-like upload of one file. */
function upload(name: string, type: string, data: Buffer) {
  const boundary = `----t${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const PDF = Buffer.from('%PDF-1.4 itinerary for Kashi yatra');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

describe('uploading files', () => {
  it('stores a file for this company only and serves it back', async () => {
    const a = await signup(app);
    const b = await signup(app);
    const up = upload('Kashi itinerary.pdf', 'application/pdf', PDF);
    const res = await app.inject({ method: 'POST', url: '/api/attachments', headers: { cookie: a.cookie, ...up.headers }, payload: up.payload });
    expect(res.statusCode).toBe(201);
    const file = res.json().attachment;
    expect(file).toMatchObject({ name: 'Kashi itinerary.pdf', type: 'application/pdf', size: PDF.length });

    const got = await api(app, a.cookie).get(`/api/attachments/${file.id}`);
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.equals(PDF)).toBe(true);
    expect(got.headers['content-disposition']).toMatch(/^attachment;/); // PDFs download; only images, video and audio show inline
    expect((await api(app, b.cookie).get(`/api/attachments/${file.id}`)).statusCode).toBe(404);
  });

  it('refuses programs and empty files', async () => {
    const a = await signup(app);
    const exe = upload('setup.exe', 'application/octet-stream', Buffer.from('MZ'));
    const r1 = await app.inject({ method: 'POST', url: '/api/attachments', headers: { cookie: a.cookie, ...exe.headers }, payload: exe.payload });
    expect(r1.json().error).toBe('file_type_blocked');
    const empty = upload('a.pdf', 'application/pdf', Buffer.alloc(0));
    expect((await app.inject({ method: 'POST', url: '/api/attachments', headers: { cookie: a.cookie, ...empty.headers }, payload: empty.payload })).json().error).toBe('file_empty');
  });

  it('a campaign can only use this company’s files', async () => {
    const a = await signup(app);
    const b = await signup(app);
    const theirs = await saveAttachment(b.json.tenant.id, null, { name: 'x.pdf', type: 'application/pdf', data: PDF });
    const c = api(app, a.cookie);
    const id = (await c.post('/api/campaigns', { name: 'Offer' })).json().campaign.id;
    expect((await c.patch(`/api/campaigns/${id}`, { attachments: [theirs.id] })).json().error).toBe('attachment_not_found');
    const mine = await saveAttachment(a.json.tenant.id, null, { name: 'mine.pdf', type: 'application/pdf', data: PDF });
    expect((await c.patch(`/api/campaigns/${id}`, { attachments: [mine.id] })).json().campaign.attachments).toEqual([{ id: mine.id, name: 'mine.pdf', type: 'application/pdf', size: PDF.length }]);
  });
});

describe('emails carry their attachments', () => {
  it('builds multipart/mixed with the file, keeping a Telugu file name', () => {
    const mime = buildMime({
      from: { name: 'Guna Travels', email: 'guna@gmail.com' },
      to: 'ravi@example.com',
      subject: 'Your itinerary',
      html: '<p>Hi</p>',
      text: 'Hi',
      headers: {},
      tags: {},
      attachments: [{ name: 'యాత్ర.pdf', type: 'application/pdf', data: PDF }],
    });
    expect(mime).toMatch(/^Content-Type: multipart\/mixed; boundary="m_/m);
    expect(mime).toContain('Content-Type: multipart/alternative;');
    expect(mime).toContain(`filename*=UTF-8''${encodeURIComponent('యాత్ర.pdf')}`);
    const filePart = mime.split('Content-Disposition: attachment;')[1]!.split('\r\n\r\n')[1]!.split('\r\n--')[0]!;
    expect(Buffer.from(filePart.replace(/\r\n/g, ''), 'base64').equals(PDF)).toBe(true);
  });

  it('every copy of a broadcast has the files; too large is blocked before sending', async () => {
    const { tenant, sender } = await makeTenant();
    await makeContact(tenant.id, { email: 'lakshmi@example.com' });
    const pdf = await saveAttachment(tenant.id, null, { name: 'Kashi.pdf', type: 'application/pdf', data: PDF });
    const c = await makeCampaign(tenant.id, sender.id, { attachments: [pdf] });
    const q = fakeQueue();
    await startCampaign(c.id, { enqueue: q.enqueue });
    const provider = new MemoryEmailProvider();
    expect(await processSendJob(q.queued[0]!, provider)).toBe('sent');
    expect(provider.outbox[0]!.attachments).toEqual([{ name: 'Kashi.pdf', type: 'application/pdf', data: PDF }]);

    // 16 MB of files can't go by email
    const big = { id: 'big', name: 'video.mp4', type: 'video/mp4', size: 16 * 1024 * 1024 };
    const c2 = await makeCampaign(tenant.id, sender.id, { attachments: [big] });
    await expect(startCampaign(c2.id, { enqueue: fakeQueue().enqueue })).rejects.toThrow(/too large/);
  });
});

describe('WhatsApp carries photos and documents', () => {
  async function linked() {
    const { tenant } = await makeTenant({ whatsappWebEnabled: true });
    await makeLine(tenant.id, { status: 'CONNECTED', phone: '+919000000001', dailyLimit: 200, intervalSeconds: 0 });
    await makeContact(tenant.id, { phone: '+919000000010', whatsappStatus: 'SUBSCRIBED', firstName: 'Ravi' });
    return tenant;
  }

  it('one photo goes with the message as its caption', async () => {
    const tenant = await linked();
    const photo = await saveAttachment(tenant.id, null, { name: 'houseboat.jpg', type: 'image/jpeg', data: JPG });
    const [c] = await db.insert(campaigns).values({ tenantId: tenant.id, channel: 'WHATSAPP', name: 'Kerala', text: 'Namaste {first_name|there}', attachments: [photo] }).returning();
    const q = fakeQueue();
    await startCampaign(c!.id, { enqueue: async () => undefined, enqueueWhatsApp: q.enqueue });
    const gw = new MemoryWhatsAppGateway();
    expect(await processWhatsAppJob(q.queued[0]!, gw)).toBe('sent');
    expect(gw.sent).toHaveLength(1);
    expect(gw.sent[0]).toMatchObject({ text: 'Namaste Ravi', media: { kind: 'image', fileName: 'houseboat.jpg', size: JPG.length } });
  });

  it('several files: the message first, then each file; a file-only message works too', async () => {
    const tenant = await linked();
    const photo = await saveAttachment(tenant.id, null, { name: 'houseboat.jpg', type: 'image/jpeg', data: JPG });
    const pdf = await saveAttachment(tenant.id, null, { name: 'Itinerary.pdf', type: 'application/pdf', data: PDF });
    const [c] = await db.insert(campaigns).values({ tenantId: tenant.id, channel: 'WHATSAPP', name: 'Kerala', text: 'Details below', attachments: [photo, pdf] }).returning();
    const q = fakeQueue();
    await startCampaign(c!.id, { enqueue: async () => undefined, enqueueWhatsApp: q.enqueue });
    const gw = new MemoryWhatsAppGateway();
    await processWhatsAppJob(q.queued[0]!, gw);
    expect(gw.sent.map((s) => s.media?.kind ?? 'text')).toEqual(['text', 'image', 'document']);

    const [c2] = await db.insert(campaigns).values({ tenantId: tenant.id, channel: 'WHATSAPP', name: 'Only the PDF', text: '', attachments: [pdf] }).returning();
    const q2 = fakeQueue();
    await startCampaign(c2!.id, { enqueue: async () => undefined, enqueueWhatsApp: q2.enqueue });
    const gw2 = new MemoryWhatsAppGateway();
    expect(await processWhatsAppJob(q2.queued[0]!, gw2)).toBe('sent');
    expect(gw2.sent[0]!.media).toMatchObject({ kind: 'document', fileName: 'Itinerary.pdf' });
  });
});

describe('group messages and templates', () => {
  it('“Message everyone” sends the file to each family', async () => {
    const { tenant } = await makeTenant();
    const actor = { tenantId: tenant.id, userId: null };
    const g = await createGroup(actor, { title: 'Kashi yatra' });
    await addBooking(actor, g.id, { customer: { name: 'Ravi', email: 'ravi@example.com', whatsappOptIn: false }, adults: 2, children: 0, status: 'BOOKED' });
    const pdf = await saveAttachment(tenant.id, null, { name: 'Bus timings.pdf', type: 'application/pdf', data: PDF });
    const queued: string[] = [];
    const r = await broadcast(actor, g.id, { text: '', channel: 'EMAIL', attachments: [pdf.id] }, { email: async (ids) => void queued.push(...ids), whatsapp: async () => undefined });
    expect(r).toMatchObject({ email: 1 });
    const m = await db.query.messages.findFirst({ where: eq(messages.id, queued[0]!) });
    expect(m).toMatchObject({ attachments: [pdf], body: 'Please find the file attached.' });
    const provider = new MemoryEmailProvider();
    expect(await processSendJob(queued[0]!, provider)).toBe('sent');
    expect(provider.outbox[0]!.attachments?.[0]?.name).toBe('Bus timings.pdf');
  });

  it('a broadcast made from a template brings the template’s files', async () => {
    const { cookie, json } = await signup(app);
    const c = api(app, cookie);
    const pdf = await saveAttachment(json.tenant.id, null, { name: 'Brochure.pdf', type: 'application/pdf', data: PDF });
    const t = (await c.post('/api/templates', { name: 'Brochure', subject: 'Hi', html: '<p>Hi</p>', attachments: [pdf.id] })).json().template;
    expect(t.attachments).toHaveLength(1);
    const camp = (await c.post('/api/campaigns', { name: 'From template', templateId: t.id })).json().campaign;
    expect(camp.attachments.map((x: { id: string }) => x.id)).toEqual([pdf.id]);
  });

  it('unused uploads are cleared after a week; used ones are kept', async () => {
    const { tenant, sender } = await makeTenant();
    const used = await saveAttachment(tenant.id, null, { name: 'used.pdf', type: 'application/pdf', data: PDF });
    const unused = await saveAttachment(tenant.id, null, { name: 'unused.pdf', type: 'application/pdf', data: PDF });
    await makeCampaign(tenant.id, sender.id, { attachments: [used] });
    expect(await removeUnusedAttachments(new Date(Date.now() + 8 * 86_400_000))).toBe(1);
    const left = await db.query.attachments.findMany({ columns: { id: true } });
    expect(left.map((x) => x.id)).toEqual([used.id]);
    expect(unused.id).not.toBe(used.id);
  });
});

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { careStaff, notifications } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { api, signup } from './api-helpers.js';
import { resetDb } from './helpers.js';

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  app = await buildApp({ authRateLimit: 10_000 });
});
afterAll(async () => {
  await app.close();
  await closeRedis();
  await closeDatabase();
});
beforeEach(async () => {
  await resetDb();
  await db.delete(careStaff);
});

/** A customer care login, signed in. */
async function careLogin(name = 'Priya Sharma', role = 'AGENT') {
  const email = `${name.split(' ')[0]!.toLowerCase()}-${Math.random().toString(36).slice(2, 6)}@care.dhrona.in`;
  await db.insert(careStaff).values({ email, name, role, passwordHash: await hashPassword('care-password-1') });
  const res = await app.inject({ method: 'POST', url: '/api/care/auth/login', payload: { email, password: 'care-password-1' } });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === 'care_sid')!;
  return { c: api(app, `care_sid=${cookie.value}`), staff: res.json().staff as { id: string } };
}

const request = { category: 'whatsapp', subject: 'WhatsApp keeps logging out', body: 'Since this morning the linked number logs out every hour.', context: { page: '/whatsapp/settings' } };

describe('customer care', () => {
  it('an agency asks for help, customer care sees everything about them and replies', async () => {
    const owner = await signup(app, { companyName: 'Kurukshetra Travels' });
    const a = api(app, owner.cookie);

    expect((await a.post('/api/support/tickets', { ...request, subject: '' })).json().details.fields.subject).toBeTruthy();
    const made = await a.post('/api/support/tickets', { ...request, urgent: true });
    expect(made.statusCode).toBe(201);
    const id = made.json().ticket.id as string;
    expect(made.json().ticket.number).toBeGreaterThanOrEqual(1001);

    const { c, staff } = await careLogin();
    const summary = (await c.get('/api/care/summary')).json();
    expect(summary).toMatchObject({ needsReply: 1, urgent: 1, unassigned: 1 });

    const queue = (await c.get('/api/care/tickets')).json().tickets;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ id, agencyName: 'Kurukshetra Travels', priority: 'HIGH', unread: true, planLabel: 'Free trial', requester: owner.body.name });
    expect((await c.get('/api/care/tickets?q=kuruk')).json().tickets).toHaveLength(1);
    expect((await c.get('/api/care/tickets?q=nothing-like-it')).json().tickets).toHaveLength(0);

    const open = (await c.get(`/api/care/tickets/${id}`)).json();
    expect(open.ticket.context.page).toBe('/whatsapp/settings');
    expect(open.requester).toMatchObject({ name: owner.body.name, role: 'OWNER', email: owner.body.email });
    expect(open.messages[0].body).toContain('logs out every hour');

    const profile = (await c.get(`/api/care/agencies/${open.ticket.tenantId}`)).json();
    expect(profile.agency).toMatchObject({ name: 'Kurukshetra Travels', owner: { email: owner.body.email } });
    expect(profile.plan.name).toBe('Free trial');
    expect(profile.people[0]).toMatchObject({ role: 'OWNER', signedInOn: 1 });
    expect(profile.tickets).toHaveLength(1);
    expect((await c.get(`/api/care/agencies?q=${encodeURIComponent(owner.body.email)}`)).json().agencies[0]).toMatchObject({ name: 'Kurukshetra Travels', openRequests: 1 });

    // A private note the agency never sees, then a reply it does
    await c.post(`/api/care/tickets/${id}/messages`, { body: 'Checked: their number was linked on 3 phones.', internal: true });
    await c.post(`/api/care/tickets/${id}/messages`, { body: 'Please unlink the old phones under Linked devices, then link again.' });
    const after = (await c.get(`/api/care/tickets/${id}`)).json();
    expect(after.ticket).toMatchObject({ status: 'WAITING', assigneeId: staff.id });
    expect(after.ticket.firstResponseAt).toBeTruthy();

    expect((await a.get('/api/support/unread')).json().unread).toBe(1);
    const seen = (await a.get(`/api/support/tickets/${id}`)).json();
    expect(seen.messages.map((m: { author: string }) => m.author)).toEqual(['AGENCY', 'CARE']);
    expect(seen.messages[1].name).toBe('Priya'); // first name only
    expect(JSON.stringify(seen)).not.toContain('linked on 3 phones');
    expect((await a.get('/api/support/unread')).json().unread).toBe(0);
    const [note] = await db.select().from(notifications).where(eq(notifications.type, 'support.reply'));
    expect(note).toMatchObject({ link: `/help/${id}` });

    // The agency answers: back in the queue
    await a.post(`/api/support/tickets/${id}/messages`, { body: 'Done, it stays linked now.' });
    expect((await c.get('/api/care/summary')).json().needsReply).toBe(1);

    // Solved, and rated
    await c.post(`/api/care/tickets/${id}/messages`, { body: 'Great, closing this.', resolve: true });
    expect((await a.get(`/api/support/tickets/${id}`)).json().ticket.status).toBe('RESOLVED');
    expect((await a.post(`/api/support/tickets/${id}/rating`, { rating: 5, note: 'Quick help' })).statusCode).toBe(200);
    expect((await c.get('/api/care/tickets?view=resolved')).json().tickets[0].rating).toBe(5);

    // Replying to a solved request opens it again
    await a.post(`/api/support/tickets/${id}/messages`, { body: 'It happened again.' });
    expect((await a.get(`/api/support/tickets/${id}`)).json().ticket.status).toBe('OPEN');
  });

  it('keeps the two sides apart', async () => {
    const owner = await signup(app);
    const a = api(app, owner.cookie);
    const { c } = await careLogin();
    // An agency login can't open customer care, and customer care can't act as an agency
    expect((await a.get('/api/care/tickets')).statusCode).toBe(401);
    expect((await a.get(`/api/care/agencies/${owner.json.tenant.id}`)).statusCode).toBe(401);
    expect((await c.get('/api/support/tickets')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/care/auth/login', payload: { email: owner.body.email, password: owner.body.password } })).statusCode).toBe(401);
  });

  it('employees see their own requests; the owner sees the whole agency’s; other agencies see nothing', async () => {
    const owner = await signup(app);
    const a = api(app, owner.cookie);
    await a.post('/api/agency/employees', { name: 'Anil', username: 'anil', password: 'password-1' });
    const loginCode = (await a.get('/api/auth/me')).json().tenant.loginCode;
    const emp = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { agency: loginCode, username: 'anil', password: 'password-1' } });
    const e = api(app, `sid=${emp.cookies.find((x) => x.name === 'sid')!.value}`);

    const mine = (await e.post('/api/support/tickets', { ...request, subject: 'Anil’s question' })).json().ticket.id;
    await a.post('/api/support/tickets', { ...request, subject: 'Owner’s question' });
    expect((await e.get('/api/support/tickets')).json().tickets.map((t: { subject: string }) => t.subject)).toEqual(['Anil’s question']);
    expect((await a.get('/api/support/tickets')).json().tickets).toHaveLength(2);

    const other = api(app, (await signup(app)).cookie);
    expect((await other.get(`/api/support/tickets/${mine}`)).statusCode).toBe(404);
    expect((await other.post(`/api/support/tickets/${mine}/messages`, { body: 'hi' })).statusCode).toBe(404);
  });

  it('only a team lead moves someone else’s request', async () => {
    const owner = await signup(app);
    const id = (await api(app, owner.cookie).post('/api/support/tickets', request)).json().ticket.id;
    const priya = await careLogin('Priya Sharma');
    const ravi = await careLogin('Ravi Kumar');
    const lead = await careLogin('Lata Rao', 'LEAD');
    await priya.c.patch(`/api/care/tickets/${id}`, { assigneeId: priya.staff.id });
    expect((await ravi.c.patch(`/api/care/tickets/${id}`, { assigneeId: ravi.staff.id })).statusCode).toBe(403);
    expect((await lead.c.patch(`/api/care/tickets/${id}`, { assigneeId: ravi.staff.id, priority: 'URGENT' })).statusCode).toBe(200);
    const t = (await ravi.c.get(`/api/care/tickets/${id}`)).json();
    expect(t.ticket).toMatchObject({ assigneeId: ravi.staff.id, priority: 'URGENT' });
    expect(t.messages.filter((m: { internal: boolean }) => m.internal).map((m: { body: string }) => m.body)).toEqual(['Priya Sharma took this request', 'Lata Rao gave this request to Ravi Kumar', 'Lata Rao set priority to urgent']);
  });
});

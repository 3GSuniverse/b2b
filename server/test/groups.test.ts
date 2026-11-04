import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { messages, trips, tripTravellers, users } from '../src/db/schema.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { closeRedis } from '../src/lib/redis.js';
import { addBooking, autoAssign, broadcast, createGroup, getGroup } from '../src/modules/groups/service.js';
import { api, signup } from './api-helpers.js';
import { makeTenant, resetDb } from './helpers.js';

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

async function yatra(capacity = 10) {
  const s = await signup(app);
  const c = api(app, s.cookie);
  const group = (await c.post('/api/groups', { title: 'Char Dham Yatra, May 2027', destination: 'Uttarakhand', startDate: '2027-05-10', endDate: '2027-05-20', capacity, perPersonPrice: '45,000' })).json().group;
  return { ...s, c, group };
}

describe('group departures', () => {
  it('each family is an ordinary booking inside the group, priced per person; seats are counted', async () => {
    const { c, group } = await yatra();
    const r = await c.post(`/api/groups/${group.id}/bookings`, { customer: { name: 'Kavya Kumar', phone: '9000000001' }, adults: 3, children: 1 });
    expect(r.statusCode).toBe(201);
    const booking = r.json().trip;
    expect(booking).toMatchObject({ status: 'BOOKED', title: 'Char Dham Yatra, May 2027', startDate: '2027-05-10', price: 18_000_000 });
    const g = (await c.get(`/api/groups/${group.id}`)).json().group;
    expect(g).toMatchObject({ seatsTaken: 4, capacity: 10, families: 1, expected: 18_000_000, collected: 0 });
    expect(g.bookings[0]).toMatchObject({ seats: 4, detailsMissing: 4 });
    // The booking knows its group; the group itself stays off the board and out of the numbers
    expect((await c.get(`/api/trips/${booking.id}`)).json().trip.group).toMatchObject({ id: group.id });
    expect((await c.get('/api/trips')).json().trips.map((t: { id: string }) => t.id)).toEqual([booking.id]);
    expect((await c.get('/api/trips/stats')).json().stats.counts.BOOKED).toBe(1);
  });

  it('a full departure says how many seats are left', async () => {
    const { c, group } = await yatra(5);
    await c.post(`/api/groups/${group.id}/bookings`, { customer: { name: 'A', phone: '9000000001' }, adults: 4 });
    const r = await c.post(`/api/groups/${group.id}/bookings`, { customer: { name: 'B', phone: '9000000002' }, adults: 2 });
    expect(r.statusCode).toBe(409);
    expect(r.json().message).toBe('Only 1 seat left on this departure.');
  });

  it('moving the dates moves every family’s booking', async () => {
    const { c, group } = await yatra();
    const b = (await c.post(`/api/groups/${group.id}/bookings`, { customer: { name: 'A', phone: '9000000001' }, adults: 2 })).json().trip;
    await c.patch(`/api/groups/${group.id}`, { startDate: '2027-05-12', endDate: '2027-05-22' });
    expect((await c.get(`/api/trips/${b.id}`)).json().trip).toMatchObject({ startDate: '2027-05-12', endDate: '2027-05-22' });
  });
});

describe('travellers', () => {
  it('ID numbers are stored encrypted, shown as the last 4; Aadhaar must have 12 digits', async () => {
    const { c, group, json } = await yatra();
    const b = (await c.post(`/api/groups/${group.id}/bookings`, { customer: { name: 'A', phone: '9000000001' }, adults: 2 })).json().trip;
    // Another company can't see or change them
    const other = api(app, (await signup(app)).cookie);
    expect((await other.put(`/api/trips/${b.id}/travellers`, { travellers: [] })).statusCode).toBe(404);
    let r = await c.put(`/api/trips/${b.id}/travellers`, { travellers: [{ name: 'Ravi Kumar', age: 64, idType: 'AADHAAR', idNumber: '1234 5678' }] });
    expect(r.json().details.fields['0.idNumber']).toBe('Aadhaar numbers have 12 digits');
    r = await c.put(`/api/trips/${b.id}/travellers`, { travellers: [{ name: 'Ravi Kumar', age: 64, gender: 'M', idType: 'AADHAAR', idNumber: '1234 5678 9012', food: 'VEG' }, { name: 'Sita Kumar', age: 60 }] });
    expect(r.statusCode).toBe(200);
    expect(r.json().travellers[0]).toMatchObject({ name: 'Ravi Kumar', idLast4: '9012' });
    expect(JSON.stringify(r.json())).not.toContain('123456789012');
    const row = await db.query.tripTravellers.findFirst({ where: eq(tripTravellers.name, 'Ravi Kumar') });
    expect(row!.idNumberEnc).not.toContain('1234');
    // The full number, for the manifest: admins only (the owner here)
    const ids = (await c.post(`/api/groups/${group.id}/ids`, {})).json().ids;
    expect(ids.find((x: { id: string }) => x.id === row!.id).idNumber).toBe('123456789012');
    await db.update(users).set({ role: 'MEMBER' }).where(eq(users.id, json.user.id));
    expect((await c.post(`/api/groups/${group.id}/ids`, {})).statusCode).toBe(403);
  });

  it('the family fills in their own details from the trip page link; they can’t pick rooms', async () => {
    const { c, group } = await yatra();
    const b = (await c.post(`/api/groups/${group.id}/bookings`, { customer: { name: 'A', phone: '9000000001' }, adults: 2 })).json().trip;
    const token = (await db.query.trips.findFirst({ where: eq(trips.id, b.id) }))!.publicToken;
    const form = await app.inject({ method: 'GET', url: `/p/${token}/travellers` });
    expect(form.statusCode).toBe(200);
    expect(form.body).toContain('Traveller 2');
    const r = await app.inject({
      method: 'POST',
      url: `/p/${token}/travellers`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 't0_name=Ravi+Kumar&t0_age=64&t0_idType=PASSPORT&t0_idNumber=Z1234567&t0_emergencyPhone=9848012345&t0_room=Suite&t1_name=Sita+Kumar&t1_age=60',
    });
    expect(r.statusCode).toBe(303);
    const list = (await c.get(`/api/trips/${b.id}/travellers`)).json().travellers;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ name: 'Ravi Kumar', idLast4: '4567', emergencyPhone: '+919848012345', room: null });
    expect((await app.inject({ method: 'GET', url: `/p/${token}/travellers` })).body).toContain('ending 4567');

    const bad = await app.inject({ method: 'POST', url: `/p/${token}/travellers`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 't0_name=Ravi&t0_idType=AADHAAR&t0_idNumber=12' });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain('Traveller 1: Aadhaar numbers have 12 digits');
  });

  it('rooms two to a room within a family (three share one), seats in order, without touching what’s set', async () => {
    const { tenant } = await makeTenant();
    const a = { tenantId: tenant.id, userId: null };
    const g = await createGroup(a, { title: 'Kedarnath', capacity: 20 });
    const fam3 = await addBooking(a, g.id, { customer: { name: 'Three', phone: '9000000003', whatsappOptIn: false }, adults: 3, children: 0, status: 'BOOKED' });
    const fam4 = await addBooking(a, g.id, { customer: { name: 'Four', phone: '9000000004', whatsappOptIn: false }, adults: 4, children: 0, status: 'BOOKED' });
    const add = (tripId: string, names: string[], room?: string) =>
      db.insert(tripTravellers).values(names.map((name, i) => ({ tenantId: tenant.id, tripId, name, position: i, room: i === 0 ? room : null })));
    await add(fam3.id, ['A1', 'A2', 'A3']);
    await add(fam4.id, ['B1', 'B2', 'B3', 'B4'], 'Room 9');
    const out = await autoAssign(a, g.id);
    const rooms = (t: { travellers: { name: string; room: string | null; seat: string | null }[] }) => t.travellers.map((x) => `${x.name}:${x.room}:${x.seat}`);
    expect(rooms(out.bookings[0]!)).toEqual(['A1:Room 1:Seat 1', 'A2:Room 1:Seat 2', 'A3:Room 1:Seat 3']);
    expect(rooms(out.bookings[1]!)).toEqual(['B1:Room 9:Seat 4', 'B2:Room 2:Seat 5', 'B3:Room 2:Seat 6', 'B4:Room 2:Seat 7']);
  });
});

describe('message the whole group', () => {
  it('one message per family, to the person who booked, as a booking message', async () => {
    const { tenant } = await makeTenant();
    const a = { tenantId: tenant.id, userId: null };
    const g = await createGroup(a, { title: 'Char Dham' });
    await addBooking(a, g.id, { customer: { name: 'Has email', email: 'a@example.com', whatsappOptIn: false }, adults: 2, children: 0, status: 'BOOKED' });
    await addBooking(a, g.id, { customer: { name: 'Phone only', phone: '9000000009', whatsappOptIn: false }, adults: 2, children: 0, status: 'BOOKED' });
    const queued: string[] = [];
    const r = await broadcast(a, g.id, { text: 'Bus leaves 5:30 AM from Secunderabad station, gate 2.', channel: 'AUTO' }, { email: async (ids) => void queued.push(...ids), whatsapp: async () => undefined });
    expect(r).toEqual({ whatsapp: 0, email: 1, skipped: ['Phone only'] });
    const m = await db.query.messages.findFirst({ where: eq(messages.id, queued[0]!) });
    expect(m).toMatchObject({ service: true, subject: 'Char Dham: an update', body: 'Bus leaves 5:30 AM from Secunderabad station, gate 2.' });
    expect((await getGroup(tenant.id, g.id)).bookings).toHaveLength(2);
  });
});

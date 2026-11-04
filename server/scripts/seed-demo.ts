/**
 * Fills a demo company with realistic data so the dashboard can be shown to a client.
 *
 *   npm run seed:demo            → creates demo@hayate.test / demo-password-123
 *   npm run seed:demo -- --reset → deletes and recreates that company first
 *
 * Never run this against production: it refuses unless NODE_ENV is development or test.
 */
import { eq } from 'drizzle-orm';
import {
  automations,
  campaigns,
  contacts,
  customFields,
  listMemberships,
  lists,
  messages,
  notifications,
  senders,
  sendingDomains,
  templates,
  tenants,
  trackedLinks,
  auditLogs,
  tripDues,
  tripPayments,
  trips,
  users,
} from '../src/db/schema.js';
import { env } from '../src/config/env.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { STARTERS } from '../src/modules/templates/starters.js';

if (env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

const EMAIL = 'demo@hayate.test';
const PASSWORD = 'demo-password-123';
const DOMAIN = 'kurukshetra-travels.in';

// Deterministic randomness, so every reset looks the same
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)]!;

const FIRST = ['Priya', 'Arjun', 'Sneha', 'Rahul', 'Ananya', 'Vikram', 'Divya', 'Karthik', 'Meera', 'Rohan', 'Lakshmi', 'Aditya', 'Kavya', 'Suresh', 'Nisha', 'Harish', 'Pooja', 'Manoj', 'Swathi', 'Gopal', 'Deepa', 'Ravi', 'Asha', 'Naveen', 'Bhavana', 'Sanjay', 'Keerthi', 'Mohan', 'Revathi', 'Ajay'];
const LAST = ['Nair', 'Mehta', 'Rao', 'Reddy', 'Sharma', 'Iyer', 'Kumar', 'Menon', 'Pillai', 'Gupta', 'Shetty', 'Varma', 'Naidu', 'Joshi', 'Krishnan', 'Das'];
const CITIES = ['Hyderabad', 'Bengaluru', 'Chennai', 'Vijayawada', 'Visakhapatnam', 'Pune', 'Mumbai', 'Kochi'];
const TRIPS = ['Goa beaches', 'Kerala backwaters', 'Kashmir valley', 'Rajasthan forts', 'Andaman islands', 'Char Dham yatra', 'Sikkim and Darjeeling'];
const MAIL = ['gmail.com', 'yahoo.co.in', 'outlook.com', 'rediffmail.com', 'gmail.com', 'gmail.com'];

const daysAgo = (d: number, h = 10) => {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() - d);
  t.setUTCHours(h - 5, 30, 0, 0); // IST-ish
  return t;
};
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Starter designs with their [PLACEHOLDERS] filled in, so the demo looks like real sent mail. */
function fill(html: string, trip = 'Goa beaches') {
  const values: Record<string, string> = {
    'HERO IMAGE': '',
    'TRIP NAME': trip,
    PRICE: '₹18,500',
    DATES: '12–15 Dec',
    DATE: '12 Dec',
    LINK: 'https://kurukshetra-travels.in/trips',
    PHONE: '+91 98480 22338',
    SEASON: 'Winter',
    OFFER: '10% off for returning travellers',
    'YOUR NAME': 'GunaSekhar',
  };
  return html
    .replace(/\[ONE OR TWO SENTENCES[^\]]*\]/g, `Four days of ${trip}: hotel by the beach, a sunset cruise and all breakfasts included.`)
    .replace(/\[WRITE AS YOU WOULD[^\]]*\]/g, 'We have a few seats left on our winter tours and wanted you to hear about them first.')
    .replace(/\[A LINE ABOUT THE SEASON[^\]]*\]/g, 'The best weather of the year is here.')
    .replace(/\[ANYTHING ELSE[^\]]*\]/g, 'A light jacket for the evenings.')
    .replace(/\[OPTIONAL: ([^\[\]]*)\[OFFER\]([^\]]*)\]/g, `$1${values.OFFER}$2`)
    .replace(/\[PACKAGE (\d+)\]/g, (_m, i) => ['Goa', 'Kerala', 'Kashmir', 'Rajasthan'][Number(i) - 1] ?? 'Andaman')
    .replace(/\[([A-Z][A-Z ]+)\]/g, (m, k: string) => values[k] ?? m);
}

async function main() {
  const reset = process.argv.includes('--reset');
  const existing = await db.query.users.findFirst({ where: eq(users.email, EMAIL) });
  if (existing) {
    if (!reset) {
      console.log(`Demo account already exists. Sign in as ${EMAIL} / ${PASSWORD} (or pass --reset).`);
      return;
    }
    await db.delete(tenants).where(eq(tenants.id, existing.tenantId));
  }

  const [tenant] = await db
    .insert(tenants)
    .values({ name: 'Kurukshetra Travels', slug: `kurukshetra-demo-${Date.now().toString(36)}`, plan: 'PAID', monthlyQuota: 5000, postalAddress: 'Road No. 12, Banjara Hills, Hyderabad 500034', paymentSettings: { upiId: 'kurukshetra@okhdfcbank', contactPhone: '+919848022338' } })
    .returning();
  const tenantId = tenant!.id;
  const [user] = await db.insert(users).values({ tenantId, email: EMAIL, name: 'GunaSekhar', passwordHash: await hashPassword(PASSWORD), role: 'OWNER' }).returning();

  const [domain] = await db
    .insert(sendingDomains)
    .values({
      tenantId,
      domain: `demo-${Date.now().toString(36)}.${DOMAIN}`,
      mailFromDomain: `mail.${DOMAIN}`,
      ownershipStatus: 'VERIFIED',
      identityStatus: 'VERIFIED',
      dkimStatus: 'VERIFIED',
      mailFromStatus: 'VERIFIED',
      verifiedAt: daysAgo(40),
      lastCheckedAt: new Date(),
    })
    .returning();
  const [sender] = await db
    .insert(senders)
    .values({ tenantId, kind: 'DOMAIN', domainId: domain!.id, fromName: 'Kurukshetra Travels', fromEmail: `trips@${DOMAIN}`, replyTo: `bookings@${DOMAIN}`, isDefault: true })
    .returning();

  // Custom fields used by automations
  const [tripField] = await db
    .insert(customFields)
    .values([
      { tenantId, key: 'trip_date', label: 'Trip date', type: 'DATE' },
      { tenantId, key: 'birthday', label: 'Birthday', type: 'DATE' },
      { tenantId, key: 'city', label: 'City', type: 'TEXT' },
      { tenantId, key: 'destination', label: 'Destination', type: 'TEXT' },
    ])
    .returning();
  const birthdayField = (await db.query.customFields.findMany({ where: eq(customFields.tenantId, tenantId) })).find((f) => f.key === 'birthday')!;

  // Contacts
  const rows = [] as (typeof contacts.$inferInsert)[];
  const used = new Set<string>();
  for (let i = 0; i < 312; i++) {
    const first = pick(FIRST);
    const last = pick(LAST);
    let email = `${first}.${last}${Math.floor(rand() * 90 + 10)}@${pick(MAIL)}`.toLowerCase();
    while (used.has(email)) email = email.replace('@', `${Math.floor(rand() * 9)}@`);
    used.add(email);
    const r = rand();
    const status = r < 0.03 ? 'BOUNCED' : r < 0.07 ? 'UNSUBSCRIBED' : r < 0.075 ? 'COMPLAINED' : 'SUBSCRIBED';
    const trip = rand() < 0.35 ? isoDay(daysAgo(-Math.floor(rand() * 60) - 1)) : undefined;
    const bm = Math.floor(rand() * 12) + 1;
    const bd = Math.floor(rand() * 28) + 1;
    rows.push({
      tenantId,
      email,
      phone: `+91${Math.floor(rand() * 4 + 6)}${String(Math.floor(rand() * 1e9)).padStart(9, '0')}`,
      firstName: first,
      lastName: last,
      emailStatus: status,
      whatsappStatus: rand() < 0.45 ? 'SUBSCRIBED' : 'UNSUBSCRIBED',
      attributes: {
        city: pick(CITIES),
        ...(trip ? { trip_date: trip, destination: pick(TRIPS) } : {}),
        ...(rand() < 0.6 ? { birthday: `19${Math.floor(rand() * 40 + 60)}-${String(bm).padStart(2, '0')}-${String(bd).padStart(2, '0')}` } : {}),
      },
      consentSource: rand() < 0.7 ? 'Booking form' : 'Office walk-in',
      consentAt: daysAgo(Math.floor(rand() * 400) + 20),
      createdAt: daysAgo(Math.floor(rand() * 120) + 1),
    });
  }
  const inserted = await db.insert(contacts).values(rows).returning({ id: contacts.id, email: contacts.email, status: contacts.emailStatus, attributes: contacts.attributes });

  const listRows = await db
    .insert(lists)
    .values([
      { tenantId, name: 'Past travellers', description: 'Booked at least one trip with us' },
      { tenantId, name: 'Newsletter', description: 'Asked for offers by email' },
      { tenantId, name: 'Pilgrimage interest', description: 'Asked about yatra packages' },
    ])
    .returning();
  const memberships = [] as (typeof listMemberships.$inferInsert)[];
  for (const c of inserted) {
    if (rand() < 0.55) memberships.push({ listId: listRows[0]!.id, contactId: c.id });
    if (rand() < 0.8) memberships.push({ listId: listRows[1]!.id, contactId: c.id });
    if (rand() < 0.2) memberships.push({ listId: listRows[2]!.id, contactId: c.id });
  }
  await db.insert(listMemberships).values(memberships);

  // Templates from the starters
  const tpl = await db
    .insert(templates)
    .values(STARTERS.map((s) => ({ tenantId, name: s.name, subject: s.subject, previewText: s.previewText, html: s.html })))
    .returning();
  const byStarter = (id: string) => tpl[STARTERS.findIndex((s) => s.id === id)]!;

  // Sent campaigns spread across the last month, plus one scheduled and one draft
  const subscribed = inserted.filter((c) => c.status === 'SUBSCRIBED');
  const plan = [
    { name: 'Diwali getaways 2026', ago: 26, share: 0.92, open: 0.48, click: 0.11 },
    { name: 'Kashmir in November', ago: 19, share: 0.55, open: 0.41, click: 0.08 },
    { name: 'Weekend in Goa: 3 seats left', ago: 12, share: 0.7, open: 0.52, click: 0.14 },
    { name: 'Char Dham yatra 2027 dates', ago: 5, share: 0.25, open: 0.6, click: 0.19 },
    { name: 'Andaman winter offer', ago: 1, share: 0.85, open: 0.38, click: 0.07 },
  ];
  for (const p of plan) {
    const start = daysAgo(p.ago);
    const audience = subscribed.filter(() => rand() < p.share);
    const [c] = await db
      .insert(campaigns)
      .values({
        tenantId,
        name: p.name,
        status: 'SENT',
        templateId: byStarter('offer-spotlight').id,
        senderId: sender!.id,
        subject: `{first_name|Hello}, ${p.name.toLowerCase()}`,
        previewText: 'Limited seats',
        html: fill(byStarter('offer-spotlight').html, p.name.split(':')[0]),
        audience: { listIds: [listRows[1]!.id] },
        startedAt: start,
        completedAt: new Date(start.getTime() + 25 * 60_000),
        createdById: user!.id,
        createdAt: daysAgo(p.ago + 2),
      })
      .returning();
    let delivered = 0, bounced = 0, opened = 0, clicked = 0;
    const msgs = audience.map((a) => {
      // Most opens and clicks land on the send day; a tail follows over the next days
      const lag = Math.floor(rand() < 0.7 ? 0 : rand() * 4) * 86_400_000;
      const sentAt = new Date(start.getTime() + rand() * 20 * 60_000);
      const isBounce = rand() < 0.012;
      const isOpen = !isBounce && rand() < p.open;
      const isClick = isOpen && rand() < p.click / p.open;
      if (isBounce) bounced++; else delivered++;
      if (isOpen) opened++;
      if (isClick) clicked++;
      return {
        tenantId,
        campaignId: c!.id,
        contactId: a.id,
        senderId: sender!.id,
        toAddress: a.email!,
        status: (isBounce ? 'BOUNCED' : 'DELIVERED') as 'BOUNCED' | 'DELIVERED',
        queuedAt: start,
        sentAt,
        deliveredAt: isBounce ? null : new Date(sentAt.getTime() + 4000),
        firstOpenedAt: isOpen ? new Date(sentAt.getTime() + lag + 3_600_000) : null,
        firstClickedAt: isClick ? new Date(sentAt.getTime() + lag + 3_700_000) : null,
      };
    });
    if (msgs.length) await db.insert(messages).values(msgs);
    if (clicked) {
      const main = Math.round(clicked * 0.7);
      await db.insert(trackedLinks).values([
        { campaignId: c!.id, url: 'https://kurukshetra-travels.in/trips', clicks: main },
        { campaignId: c!.id, url: 'https://wa.me/919848022338', clicks: clicked - main },
      ]);
    }
    const unsub = Math.round(delivered * 0.004);
    await db
      .update(campaigns)
      .set({ recipients: msgs.length, sent: msgs.length, delivered, bounced, opened, clicked, unsubscribed: unsub })
      .where(eq(campaigns.id, c!.id));
    await db.insert(notifications).values({
      tenantId,
      type: 'campaign.completed',
      level: 'SUCCESS',
      title: `“${p.name}” finished sending`,
      body: `${delivered.toLocaleString('en-IN')} delivered, ${bounced} bounced.`,
      link: `/campaigns/${c!.id}`,
      dedupeKey: `campaign.completed:${c!.id}`,
      createdAt: new Date(start.getTime() + 25 * 60_000),
      readAt: p.ago > 3 ? new Date() : null,
    });
  }

  await db.insert(campaigns).values([
    {
      tenantId,
      name: 'Sankranti family packages',
      status: 'SCHEDULED',
      templateId: byStarter('package-grid').id,
      senderId: sender!.id,
      subject: '{first_name|Hello}, plan Sankranti with family',
      previewText: 'Four packages under ₹25,000',
      html: fill(byStarter('package-grid').html),
      audience: { listIds: [listRows[0]!.id] },
      scheduledAt: daysAgo(-4, 9),
      createdById: user!.id,
    },
    {
      tenantId,
      name: 'Winter Rajasthan tour',
      status: 'DRAFT',
      templateId: byStarter('plain-letter').id,
      senderId: sender!.id,
      subject: 'Rajasthan in winter, the way it should be seen',
      html: byStarter('plain-letter').html,
      audience: { listIds: [listRows[1]!.id] },
      createdById: user!.id,
    },
  ]);

  await db.insert(automations).values([
    {
      tenantId,
      name: 'Trip reminder, 3 days before',
      status: 'ACTIVE',
      dateFieldId: tripField!.id,
      offsetDays: -3,
      sendTime: '09:00',
      repeat: 'ONCE',
      templateId: byStarter('trip-reminder').id,
      senderId: sender!.id,
      activatedAt: daysAgo(30),
      sent: 64,
      delivered: 63,
      clicked: 21,
    },
    {
      tenantId,
      name: 'Birthday wishes',
      status: 'ACTIVE',
      dateFieldId: birthdayField.id,
      offsetDays: 0,
      sendTime: '08:30',
      repeat: 'YEARLY',
      templateId: byStarter('birthday').id,
      senderId: sender!.id,
      activatedAt: daysAgo(30),
      sent: 22,
      delivered: 22,
      clicked: 5,
    },
  ]);

  // ---- Trips: a believable week at a travel desk
  const people = (await db.query.contacts.findMany({ where: eq(contacts.tenantId, tenantId), limit: 40 })).filter((c) => c.phone && c.firstName);
  const day = (offset: number) => isoDay(daysAgo(-offset));
  type Seed = {
    title: string; destination: string; start: number | null; nights: number; adults: number; children?: number; budget?: number; price?: number;
    status: 'ENQUIRY' | 'QUOTED' | 'BOOKED' | 'COMPLETED' | 'LOST' | 'CANCELLED'; source: string; age: number; notes?: string; lostReason?: string;
    dues?: { label: string; share: number; due: number }[]; paid?: { share: number; ago: number; method: 'UPI' | 'CASH' | 'BANK' | 'CARD'; ref?: string }[];
  };
  const SEED_TRIPS: Seed[] = [
    { title: 'Kashmir family trip', destination: 'Kashmir', start: 46, nights: 6, adults: 4, children: 1, budget: 120000, status: 'ENQUIRY', source: 'PHONE', age: 0, notes: 'Wants a houseboat night on Dal Lake. Grandmother travelling, needs ground-floor rooms.' },
    { title: 'Goa with friends', destination: 'Goa', start: 30, nights: 3, adults: 6, budget: 90000, status: 'ENQUIRY', source: 'WHATSAPP', age: 1 },
    { title: 'Tirupati darshan', destination: 'Tirupati', start: 12, nights: 1, adults: 3, budget: 15000, status: 'ENQUIRY', source: 'WALK_IN', age: 2, notes: 'Special entry darshan tickets needed.' },
    { title: 'Honeymoon, Andaman', destination: 'Andaman', start: 70, nights: 5, adults: 2, budget: 150000, status: 'ENQUIRY', source: 'REFERRAL', age: 3 },
    { title: 'Hampi weekend', destination: 'Hampi', start: null, nights: 2, adults: 2, status: 'ENQUIRY', source: 'WEBSITE', age: 4 },
    { title: 'Kerala backwaters', destination: 'Kerala', start: 38, nights: 4, adults: 2, budget: 50000, price: 48500, status: 'QUOTED', source: 'PHONE', age: 3, dues: [{ label: 'Advance', share: 0.25, due: 0 }, { label: 'Balance', share: 0.75, due: 23 }] },
    { title: 'Rajasthan forts tour', destination: 'Rajasthan', start: 55, nights: 7, adults: 4, price: 186000, status: 'QUOTED', source: 'EMAIL', age: 5 },
    { title: 'Sikkim and Darjeeling', destination: 'Sikkim', start: 62, nights: 6, adults: 3, children: 1, price: 124000, status: 'QUOTED', source: 'WHATSAPP', age: 6 },
    { title: 'Ooty getaway', destination: 'Ooty', start: 20, nights: 2, adults: 2, price: 22500, status: 'QUOTED', source: 'PHONE', age: 8 },
    { title: 'Char Dham yatra', destination: 'Uttarakhand', start: 4, nights: 9, adults: 6, price: 270000, status: 'BOOKED', source: 'REFERRAL', age: 34, notes: 'Group of 6 from one family. Helicopter for Kedarnath booked separately.',
      dues: [{ label: 'Advance', share: 0.3, due: -30 }, { label: '2nd instalment', share: 0.4, due: -12 }, { label: 'Balance', share: 0.3, due: -2 }], paid: [{ share: 0.3, ago: 30, method: 'BANK', ref: 'NEFT 88213' }, { share: 0.4, ago: 11, method: 'UPI', ref: '4411 2290 7613' }] },
    { title: 'Goa beaches', destination: 'Goa', start: 6, nights: 3, adults: 4, price: 62000, status: 'BOOKED', source: 'WHATSAPP', age: 20,
      dues: [{ label: 'Advance', share: 0.25, due: -18 }, { label: 'Balance', share: 0.75, due: 2 }], paid: [{ share: 0.25, ago: 18, method: 'UPI', ref: '3390 1182 0045' }] },
    { title: 'Ladakh bike trip', destination: 'Ladakh', start: 26, nights: 8, adults: 2, price: 136000, status: 'BOOKED', source: 'WEBSITE', age: 15,
      dues: [{ label: 'Advance', share: 0.25, due: -14 }, { label: 'Balance', share: 0.75, due: 11 }], paid: [{ share: 0.25, ago: 1, method: 'CARD' }] },
    { title: 'Varanasi and Prayagraj', destination: 'Varanasi', start: 17, nights: 4, adults: 2, price: 38000, status: 'BOOKED', source: 'PHONE', age: 12,
      dues: [{ label: 'Advance', share: 0.5, due: -10 }, { label: 'Balance', share: 0.5, due: -1 }], paid: [{ share: 0.5, ago: 2, method: 'CASH' }] },
    { title: 'Andaman islands', destination: 'Andaman', start: 33, nights: 5, adults: 2, price: 145000, status: 'BOOKED', source: 'REFERRAL', age: 22,
      dues: [{ label: 'Advance', share: 0.3, due: -21 }, { label: 'Balance', share: 0.7, due: 18 }], paid: [{ share: 0.3, ago: 21, method: 'BANK', ref: 'IMPS 55120' }] },
    { title: 'Coorg coffee estates', destination: 'Coorg', start: -40, nights: 3, adults: 2, price: 34000, status: 'COMPLETED', source: 'WHATSAPP', age: 70,
      dues: [{ label: 'Advance', share: 0.3, due: -66 }, { label: 'Balance', share: 0.7, due: -50 }], paid: [{ share: 0.3, ago: 66, method: 'UPI' }, { share: 0.7, ago: 50, method: 'UPI' }] },
    { title: 'Mysore Dasara', destination: 'Mysuru', start: -25, nights: 2, adults: 5, price: 41000, status: 'COMPLETED', source: 'PHONE', age: 48, paid: [{ share: 1, ago: 30, method: 'CASH' }] },
    { title: 'Araku valley', destination: 'Araku', start: -12, nights: 2, adults: 4, price: 26000, status: 'COMPLETED', source: 'WALK_IN', age: 30, paid: [{ share: 1, ago: 20, method: 'UPI' }] },
    { title: 'Dubai shopping', destination: 'Dubai', start: 40, nights: 4, adults: 2, budget: 90000, price: 112000, status: 'LOST', source: 'PHONE', age: 16, lostReason: 'Price too high' },
    { title: 'Shimla Manali', destination: 'Himachal', start: 25, nights: 6, adults: 4, price: 98000, status: 'LOST', source: 'WEBSITE', age: 19, lostReason: 'Booked with another agency' },
    { title: 'Vizag beach weekend', destination: 'Visakhapatnam', start: 9, nights: 2, adults: 3, price: 21000, status: 'CANCELLED', source: 'PHONE', age: 25, lostReason: 'Dates changed',
      dues: [{ label: 'Advance', share: 0.3, due: -20 }], paid: [{ share: 0.3, ago: 20, method: 'UPI' }] },
  ];
  let receipt = 0;
  for (const [i, t] of SEED_TRIPS.entries()) {
    const c = people[i % people.length]!;
    const price = (t.price ?? 0) * 100;
    const created = daysAgo(t.age, 11);
    const [row] = await db
      .insert(trips)
      .values({
        tenantId, number: i + 1, status: t.status, contactId: c.id, customerName: [c.firstName, c.lastName].filter(Boolean).join(' '),
        title: t.title, destination: t.destination, startDate: t.start === null ? null : day(t.start), endDate: t.start === null ? null : day(t.start + t.nights),
        adults: t.adults, children: t.children ?? 0, budget: t.budget ? t.budget * 100 : null, price, source: t.source, notes: t.notes ?? null,
        lostReason: t.lostReason ?? null, assignedToId: user!.id, createdById: user!.id, statusChangedAt: daysAgo(Math.max(0, t.age - 2)),
        bookedAt: ['BOOKED', 'COMPLETED', 'CANCELLED'].includes(t.status) ? daysAgo(Math.max(0, t.age - 2)) : null, createdAt: created, updatedAt: daysAgo(Math.max(0, t.age - 2)),
      })
      .returning();
    const logs: (typeof auditLogs.$inferInsert)[] = [{ tenantId, userId: user!.id, action: 'trip.create', entity: 'trip', entityId: row!.id, createdAt: created }];
    if (t.dues) {
      // Last instalment takes the rounding, so the schedule adds up to the price exactly
      let left = price;
      await db.insert(tripDues).values(
        t.dues.map((d, k) => {
          const amount = k === t.dues!.length - 1 ? left : Math.round((price * d.share) / 50000) * 50000;
          left -= amount;
          return { tenantId, tripId: row!.id, label: d.label, amount, dueDate: day(d.due), position: k };
        }),
      );
      logs.push({ tenantId, userId: user!.id, action: 'trip.schedule', entity: 'trip', entityId: row!.id, meta: { count: t.dues.length, total: `₹${(price / 100).toLocaleString('en-IN')}` }, createdAt: daysAgo(Math.max(0, t.age - 1)) });
    }
    for (const p of t.paid ?? []) {
      const amount = p.share === 1 ? price : Math.round((price * p.share) / 50000) * 50000;
      receipt++;
      await db.insert(tripPayments).values({ tenantId, tripId: row!.id, receiptNumber: receipt, amount, method: p.method, reference: p.ref ?? null, paidAt: daysAgo(p.ago, 15), recordedById: user!.id, createdAt: daysAgo(p.ago, 15) });
      logs.push({ tenantId, userId: user!.id, action: 'trip.payment', entity: 'trip', entityId: row!.id, meta: { receipt, amount: `₹${(amount / 100).toLocaleString('en-IN')}`, method: p.method }, createdAt: daysAgo(p.ago, 15) });
    }
    if (t.status !== 'ENQUIRY') {
      logs.push({ tenantId, userId: user!.id, action: 'trip.status', entity: 'trip', entityId: row!.id, meta: { from: 'ENQUIRY', to: t.status, reason: t.lostReason }, createdAt: daysAgo(Math.max(0, t.age - 2)) });
    }
    await db.insert(auditLogs).values(logs);
  }

  await db.insert(notifications).values({
    tenantId,
    type: 'contacts.bounced',
    level: 'WARNING',
    title: '4 addresses bounced last week',
    body: 'They were removed from future sends automatically. Check them for typos in Contacts.',
    link: '/contacts?status=BOUNCED',
    dedupeKey: 'demo.bounces',
    createdAt: daysAgo(2),
  });

  console.log(`Demo ready. Sign in as ${EMAIL} / ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());

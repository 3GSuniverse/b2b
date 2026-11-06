/**
 * Fills a demo company with realistic data so the dashboard can be shown to a client.
 *
 *   npm run seed:demo            → creates demo@drona.test / demo-password-123
 *   npm run seed:demo -- --reset → deletes and recreates that company first
 *
 * Never run this against production: it refuses unless NODE_ENV is development or test.
 */
import { and, eq, sql } from 'drizzle-orm';
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
  tripReminders,
  tripFollowups,
  quotes,
  packages,
  rateItems,
  tripTravellers,
  users,
} from '../src/db/schema.js';
import { env } from '../src/config/env.js';
import { closeDatabase, db } from '../src/lib/db.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { STARTERS } from '../src/modules/templates/starters.js';
import { addBooking, autoAssign, createGroup } from '../src/modules/groups/service.js';
import { encryptSecret } from '../src/lib/crypto.js';

if (env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

const EMAIL = 'demo@drona.test';
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
    .values({ name: 'Kurukshetra Travels', slug: `kurukshetra-demo-${Date.now().toString(36)}`, loginCode: 'kurukshetra-demo', whatsappWebEnabled: true, plan: 'PAID', planId: 'team10', paidUntil: new Date(Date.now() + 41 * 86_400_000), monthlyQuota: 30_000, postalAddress: 'Road No. 12, Banjara Hills, Hyderabad 500034', paymentSettings: { upiId: 'kurukshetra@okhdfcbank', contactPhone: '+919848022338' } })
    .returning();
  const tenantId = tenant!.id;
  const [user] = await db.insert(users).values({ tenantId, email: EMAIL, name: 'GunaSekhar', passwordHash: await hashPassword(PASSWORD), role: 'OWNER' }).returning();
  // Employees: they sign in as Employee with agency ID kurukshetra-demo and the same demo password
  const staffHash = await hashPassword(PASSWORD);
  const staff = await db
    .insert(users)
    .values([
      { tenantId, name: 'Ravi Kumar', username: 'ravi', role: 'MEMBER' as const, passwordHash: staffHash, lastLoginAt: daysAgo(0, 3) },
      { tenantId, name: 'Priya Reddy', username: 'priya', role: 'ADMIN' as const, passwordHash: staffHash, lastLoginAt: daysAgo(1, 5) },
      { tenantId, name: 'Sandeep Varma', username: 'sandeep', role: 'MEMBER' as const, passwordHash: staffHash, lastLoginAt: daysAgo(6, 2) },
    ])
    .returning();

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
  for (const [pi, p] of plan.entries()) {
    const by = [staff[0]!, staff[1]!, user!, staff[0]!, staff[2]!][pi % 5]!;
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
        createdById: by.id,
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
        sentById: by.id,
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

  const autoRows = await db.insert(automations).values([
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
    {
      tenantId,
      name: 'Birthday wishes on WhatsApp',
      channel: 'WHATSAPP' as const,
      status: 'ACTIVE' as const,
      dateFieldId: birthdayField.id,
      offsetDays: 0,
      sendTime: '09:00',
      repeat: 'YEARLY' as const,
      text: 'Happy birthday {first_name|there}! 🎂\n\nWishing you a wonderful year full of happy journeys.\n\nWarm wishes from all of us at {company_name}.',
      activatedAt: daysAgo(20),
      sent: 14,
      delivered: 14,
    },
  ]).returning({ id: automations.id, name: automations.name });

  // A WhatsApp broadcast that went out last week, and one waiting as a draft
  const waPeople = (await db.query.contacts.findMany({ where: eq(contacts.tenantId, tenantId), limit: 120 })).filter((c) => c.phone && c.whatsappStatus === 'SUBSCRIBED');
  const [waCamp] = await db
    .insert(campaigns)
    .values({
      tenantId,
      name: 'Kerala houseboat offer',
      channel: 'WHATSAPP',
      status: 'SENT',
      text: 'Namaste {first_name|there} 🙏\n\n*Kerala houseboat, 3 nights* from ₹18,500 a person. Only 6 boats left for December.\n\nReply YES and we’ll call you.',
      audience: null,
      startedAt: daysAgo(6, 11),
      completedAt: daysAgo(6, 12),
      createdById: staff[1]!.id,
      recipients: waPeople.length,
      sent: waPeople.length,
      delivered: waPeople.length,
      opened: Math.floor((waPeople.length * 2) / 3),
    })
    .returning();
  if (waPeople.length) {
    await db.insert(messages).values(
      waPeople.map((c, i) => ({ tenantId, campaignId: waCamp!.id, contactId: c.id, sentById: staff[1]!.id, channel: 'WHATSAPP' as const, toAddress: c.phone!, status: 'DELIVERED' as const, queuedAt: daysAgo(6, 11), sentAt: daysAgo(6, 11), deliveredAt: daysAgo(6, 11), firstOpenedAt: i % 3 ? daysAgo(6, 13) : null })),
    );
  }
  await db.insert(campaigns).values({ tenantId, name: 'Char Dham 2027 dates', channel: 'WHATSAPP', status: 'DRAFT', text: 'Namaste {first_name|there} 🙏\n\nChar Dham yatra 2027 dates are out.', createdById: staff[0]!.id });

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
    { title: 'Kerala backwaters', destination: 'Kerala', start: 38, nights: 4, adults: 2, budget: 50000, price: 48500, status: 'QUOTED', source: 'PHONE', age: 3 },
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

  // ---- What Dhrona sent on its own: birthday wishes, trip reminders, payment reminders and
  // pre-trip details, spread over the last month, so the Overview shows a real working desk
  {
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    const [tripAuto, bdayAuto] = autoRows;
    const auto: (typeof messages.$inferInsert)[] = [];
    // About five a day for the last 30 days: a steady stream, as at a real desk
    Array.from({ length: 150 }, (_, k) => people[k % people.length]!).forEach((c, k) => {
      const whenMin = Math.floor(k / 5) * 60 * 24 + 40 + (k % 5) * 170 + ((k * 37) % 60); // spread across each day
      const opened = k % 3 !== 0;
      const isBday = k % 2 === 0;
      const wa = k % 4 === 1;
      auto.push({
        tenantId,
        automationId: (isBday ? bdayAuto : tripAuto)!.id,
        contactId: c.id,
        channel: wa ? 'WHATSAPP' : 'EMAIL',
        toAddress: wa ? c.phone! : (c.email ?? c.phone!),
        subject: isBday ? `Happy birthday, ${c.firstName}!` : 'Your trip is in 3 days',
        status: 'DELIVERED',
        queuedAt: ago(whenMin),
        sentAt: ago(whenMin),
        deliveredAt: ago(whenMin - 1),
        firstOpenedAt: opened ? ago(whenMin - 30) : null,
      });
    });
    await db.insert(messages).values(auto);

    // Payment reminders and pre-trip details for the booked trips, on WhatsApp where possible
    const booked = await db.query.trips.findMany({ where: and(eq(trips.tenantId, tenantId), eq(trips.status, 'BOOKED')), with: { contact: true } });
    let minute = 25;
    for (const t of booked) {
      const dues = await db.query.tripDues.findMany({ where: eq(tripDues.tripId, t.id) });
      const today = isoDay(new Date());
      for (const [k, d] of dues.sort((x, y) => x.position - y.position).entries()) {
        if (d.dueDate > isoDay(daysAgo(-7))) continue; // reminders only go out close to the date
        // Earlier instalments were reminded before their date and paid; only the latest one can be late
        const overdue = k === dues.length - 1 && d.dueDate < today;
        const [m] = await db
          .insert(messages)
          .values({
            tenantId, tripId: t.id, contactId: t.contactId, service: true, channel: 'WHATSAPP', toAddress: t.contact?.phone ?? '+919800000000',
            body: `Reminder: ${d.label} for ${t.title}`, status: 'DELIVERED', queuedAt: ago(minute), sentAt: ago(minute), deliveredAt: ago(minute - 1),
            firstOpenedAt: minute % 2 ? ago(minute - 5) : null,
          })
          .returning({ id: messages.id });
        await db.insert(tripReminders).values({ tenantId, tripId: t.id, dueId: d.id, kind: overdue ? 'OVERDUE' : 'BEFORE', channel: 'WHATSAPP', messageId: m!.id, createdAt: ago(minute) });
        minute += 170;
      }
      if (t.startDate && t.startDate <= isoDay(daysAgo(-7))) {
        const [m] = await db
          .insert(messages)
          .values({
            tenantId, tripId: t.id, contactId: t.contactId, service: true, channel: 'EMAIL', toAddress: t.contact?.email ?? 'traveller@example.com',
            subject: `Your ${t.title} trip: pickup and details`, status: 'DELIVERED', queuedAt: ago(minute), sentAt: ago(minute), deliveredAt: ago(minute - 1), firstOpenedAt: ago(minute - 20),
          })
          .returning({ id: messages.id });
        await db.insert(tripFollowups).values({ tenantId, tripId: t.id, kind: 'PRE_TRIP', channel: 'EMAIL', messageId: m!.id, createdAt: ago(minute) });
        minute += 90;
      }
    }
    // WhatsApp messages each employee sent by hand this month (quotes, replies), so the agency console has numbers
    const phones = (await db.query.contacts.findMany({ where: eq(contacts.tenantId, tenantId), columns: { id: true, phone: true }, limit: 80 })).filter((c) => c.phone);
    const handSent = phones.flatMap((c, i) => {
      const by = [staff[0]!, staff[0]!, staff[1]!, staff[2]!, user!][i % 5]!;
      const when = ago(60 * (i % 20) + 30);
      return [{ tenantId, contactId: c.id, sentById: by.id, channel: 'WHATSAPP' as const, toAddress: c.phone!, body: 'Sharing the package details', status: 'DELIVERED' as const, queuedAt: when, sentAt: when, deliveredAt: when }];
    });
    if (handSent.length) await db.insert(messages).values(handSent);
    // Three quotes drafted with AI this month
    await db.insert(auditLogs).values([1, 3, 6].map((d) => ({ tenantId, userId: user!.id, action: 'ai.draft', entity: 'quote', createdAt: daysAgo(d) })));
  }

  // ---- Packages, and which trips were sold as which
  const P = (name: string, destination: string, nights: number, adult: number, child: number | null, cost: number, summary: string, days: [string, string][], inclusions: string[]) => ({
    tenantId, name, destination, nights, summary, pricePerAdult: adult * 100, pricePerChild: child === null ? null : child * 100, costPerPerson: cost * 100,
    days: days.map(([title, description]) => ({ title, description })), inclusions, exclusions: ['Flights or trains unless listed', 'Entry tickets and personal expenses'],
  });
  const pk = await db
    .insert(packages)
    .values([
      P('Kerala 4N/5D', 'Kerala', 4, 24500, 12000, 18000, 'Munnar hills, a night on an Alleppey houseboat, and Kochi', [['Arrive in Kochi, drive to Munnar', 'Pickup at the airport; a scenic drive past waterfalls and spice gardens.'], ['Munnar tea gardens', 'Tea museum, Mattupetty Dam, Echo Point.'], ['Alleppey houseboat', 'Board by noon; lunch, dinner and the night on the backwaters.'], ['Fort Kochi', 'Chinese fishing nets and a Kathakali show.'], ['Departure', 'Drop at Kochi airport.']], ['Hotels and houseboat with breakfast', 'All meals on the houseboat', 'Private car with driver']),
      P('Kashmir 6N/7D', 'Kashmir', 6, 32000, 16000, 24500, 'Srinagar houseboat, Gulmarg, Pahalgam and Sonamarg', [['Arrive in Srinagar', 'Shikara ride on Dal Lake; night on a houseboat.'], ['Gulmarg', 'Gondola rides and snow.'], ['Gulmarg to Pahalgam', 'Betaab and Aru valleys.'], ['Pahalgam', 'At leisure; pony rides optional.'], ['Sonamarg', 'Thajiwas glacier.'], ['Srinagar gardens', 'Mughal gardens and shopping.'], ['Departure', 'Drop at Srinagar airport.']], ['Hotels and houseboat with breakfast and dinner', 'Private car with driver']),
      P('Goa beach break 3N/4D', 'Goa', 3, 15500, 8000, 11500, 'North Goa beaches and Old Goa', [['Arrive in Goa', 'Check in near Calangute.'], ['North Goa', 'Baga, Anjuna, Fort Aguada.'], ['Old Goa and Panjim', 'Churches and a river cruise.'], ['Departure', 'Airport drop.']], ['Beach resort with breakfast', 'Airport transfers', 'Sightseeing by car']),
      P('Char Dham Yatra 11N/12D', 'Uttarakhand', 11, 42000, 30000, 33500, 'Yamunotri, Gangotri, Kedarnath and Badrinath from Haridwar', [], ['Hotels with veg meals', 'AC bus throughout', 'Darshan arrangements']),
      P('Tirupati darshan 1N/2D', 'Tirupati', 1, 4800, 3000, 3600, 'Special entry darshan with a night in Tirupati', [], ['Hotel', 'Darshan tickets', 'Car from Tirupati station']),
    ])
    .returning();
  const byDest = new Map(pk.map((x) => [x.destination, x.id]));
  for (const [dest, pid] of byDest) {
    await db.update(trips).set({ packageId: pid }).where(and(eq(trips.tenantId, tenantId), eq(trips.destination, dest!)));
  }

  // ---- Price list and a sent quote
  const R = (kind: 'HOTEL' | 'TRANSPORT' | 'ACTIVITY' | 'TRAVEL' | 'OTHER', name: string, destination: string | null, unit: 'PER_NIGHT' | 'PER_DAY' | 'PER_PERSON' | 'PER_GROUP', price: number, cost: number) => ({ tenantId, kind, name, destination, unit, price: price * 100, cost: cost * 100 });
  const rates = await db
    .insert(rateItems)
    .values([
      R('HOTEL', 'Munnar hill resort, deluxe room', 'Kerala', 'PER_NIGHT', 6500, 5000),
      R('HOTEL', 'Alleppey houseboat, deluxe (with meals)', 'Kerala', 'PER_NIGHT', 9500, 7000),
      R('HOTEL', 'Kochi heritage hotel', 'Kerala', 'PER_NIGHT', 4800, 3600),
      R('TRANSPORT', 'Innova Crysta with driver', 'Kerala', 'PER_DAY', 4200, 3000),
      R('ACTIVITY', 'Kathakali show', 'Kerala', 'PER_PERSON', 500, 350),
      R('ACTIVITY', 'Tea museum and plantation walk', 'Kerala', 'PER_PERSON', 300, 200),
      R('HOTEL', 'Srinagar houseboat, Dal Lake', 'Kashmir', 'PER_NIGHT', 7500, 5500),
      R('HOTEL', 'Gulmarg hotel, valley view', 'Kashmir', 'PER_NIGHT', 8200, 6200),
      R('TRANSPORT', 'Tempo Traveller 12-seater', 'Kashmir', 'PER_DAY', 6000, 4500),
      R('ACTIVITY', 'Gulmarg gondola, phase 1 and 2', 'Kashmir', 'PER_PERSON', 2700, 2700),
      R('HOTEL', 'Calangute beach resort', 'Goa', 'PER_NIGHT', 5500, 4200),
      R('TRANSPORT', 'Airport transfers, both ways', 'Goa', 'PER_GROUP', 3000, 2200),
      R('TRAVEL', 'Flights, Hyderabad return', null, 'PER_PERSON', 9800, 9200),
      R('OTHER', 'Travel insurance', null, 'PER_PERSON', 650, 400),
    ])
    .returning();
  const rate = (name: string) => rates.find((r) => r.name === name)!;
  const kerala = await db.query.trips.findFirst({ where: (t, { and, eq }) => and(eq(t.tenantId, tenantId), eq(t.title, 'Kerala backwaters')) });
  if (kerala) {
    const line = (name: string, quantity: number, times: number) => {
      const r = rate(name);
      return { label: r.name, kind: r.kind, unit: r.unit, quantity, times, unitPrice: r.price, unitCost: r.cost, rateItemId: r.id };
    };
    const lines = [line('Munnar hill resort, deluxe room', 1, 2), line('Alleppey houseboat, deluxe (with meals)', 1, 1), line('Kochi heritage hotel', 1, 1), line('Innova Crysta with driver', 1, 5), line('Kathakali show', 2, 1)];
    const total = lines.reduce((a, l) => a + l.quantity * l.times * l.unitPrice, 0);
    await db.insert(quotes).values({
      tenantId, tripId: kerala.id, version: 1, status: 'SENT', total,
      intro: 'Thank you for choosing Kurukshetra Travels. Here is a relaxed plan for your Kerala trip: hills, backwaters and a night on a houseboat.',
      days: [
        { title: 'Arrive in Kochi, drive to Munnar', description: 'Pickup at Kochi airport. A scenic 4-hour drive past waterfalls and spice gardens to Munnar. Evening at leisure.' },
        { title: 'Munnar tea gardens', description: 'Tea museum and plantation walk, Mattupetty Dam and Echo Point. Back to the resort by evening.' },
        { title: 'Munnar to Alleppey houseboat', description: 'Drive down to Alleppey and board your private houseboat by noon. Lunch, dinner and the night on the backwaters.' },
        { title: 'Kochi heritage walk', description: 'Check out after breakfast and drive to Kochi. Fort Kochi, the Chinese fishing nets and a Kathakali show in the evening.' },
        { title: 'Departure', description: 'Breakfast, then drop at Kochi airport.' },
      ],
      lines,
      inclusions: ['All hotels and the houseboat as listed, with breakfast', 'All meals on the houseboat', 'Private Innova Crysta for 5 days with driver', 'Kathakali show tickets'],
      exclusions: ['Flights', 'Lunch and dinner except on the houseboat', 'Entry tickets not listed'],
      terms: 'A 25% advance confirms the booking; the balance is due 15 days before departure.',
      validUntil: day(4), sentAt: daysAgo(2, 12), viewedAt: daysAgo(1, 19), createdById: user!.id,
    });
    await db.update(trips).set({ price: total }).where(eq(trips.id, kerala.id));
  }

  // ---- A group yatra: four families, some details and payments in
  {
    const actor = { tenantId, userId: user!.id };
    const g = await createGroup(actor, { packageId: pk.find((x) => x.destination === 'Uttarakhand')!.id, title: 'Char Dham Yatra, May 2027', destination: 'Uttarakhand', startDate: '2027-05-10', endDate: '2027-05-21', capacity: 30, perPersonPrice: 4_200_000, notes: 'AC bus from Secunderabad. Helicopter for Kedarnath booked separately.' });
    const fams = [
      { name: 'Venkata Ramana', phone: '9848011111', adults: 4, people: [['Venkata Ramana', 66, 'M', 'VEG', 'Knee trouble: lower berth please'], ['Saraswathi Ramana', 61, 'F', 'VEG', null], ['Srinivas Ramana', 38, 'M', 'VEG', null], ['Padma Srinivas', 35, 'F', 'VEG', null]], paid: 1 },
      { name: 'Lalitha Devi', phone: '9848022222', adults: 3, people: [['Lalitha Devi', 58, 'F', 'JAIN', null], ['Ramesh Babu', 62, 'M', 'VEG', 'Diabetic'], ['Anusha Babu', 29, 'F', 'VEG', null]], paid: 0.3 },
      { name: 'Prakash Rao', phone: '9848033333', adults: 2, people: [], paid: 0.3 },
      { name: 'Sunitha Reddy', phone: '9848044444', adults: 5, people: [], paid: 0 },
    ];
    let rn = (await db.select({ n: sql<number>`coalesce(max(receipt_number), 0)::int` }).from(tripPayments).where(eq(tripPayments.tenantId, tenantId)))[0]!.n;
    for (const [fi, f] of fams.entries()) {
      const b = await addBooking(actor, g.id, { customer: { name: f.name, phone: f.phone, whatsappOptIn: true }, adults: f.adults, children: 0, status: 'BOOKED' });
      const price = b.price;
      const adv = Math.round(price * 0.3);
      await db.insert(tripDues).values([
        { tenantId, tripId: b.id, label: 'Advance', amount: adv, dueDate: day(-20 + fi), position: 0 },
        { tenantId, tripId: b.id, label: 'Balance', amount: price - adv, dueDate: '2027-04-20', position: 1 },
      ]);
      if (f.paid) {
        rn++;
        await db.insert(tripPayments).values({ tenantId, tripId: b.id, receiptNumber: rn, amount: f.paid === 1 ? price : adv, method: 'UPI', paidAt: daysAgo(15 - fi, 14), recordedById: user!.id });
      }
      if (f.people.length) {
        await db.insert(tripTravellers).values(
          f.people.map(([name, age, gender, food, needs], i) => ({
            tenantId, tripId: b.id, position: i, name: name as string, age: age as number, gender: gender as string, food: food as string, needs: needs as string | null,
            idType: 'AADHAAR', idNumberEnc: encryptSecret(`5123456789${String(fi)}${String(i)}`), idLast4: `89${fi}${i}`,
            ...(i === 0 ? { emergencyName: 'Family at home', emergencyPhone: `+91984805555${fi}` } : {}),
          })),
        );
      }
    }
    await autoAssign(actor, g.id);
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

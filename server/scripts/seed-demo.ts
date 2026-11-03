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
    .values({ name: 'Kurukshetra Travels', slug: `kurukshetra-demo-${Date.now().toString(36)}`, monthlyQuota: 5000, postalAddress: 'Road No. 12, Banjara Hills, Hyderabad 500034' })
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

// =====================================================================
//  Sandesh — database schema (Drizzle ORM, PostgreSQL)
//  Multi-tenant from day one: every business row carries tenantId.
//  TS names are camelCase; columns are snake_case (casing set in db client).
// =====================================================================
import { createId } from '@paralleldrive/cuid2';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  type AnyPgColumn,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------

const id = () => text().primaryKey().$defaultFn(() => createId());
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const tenantRef = () =>
  text()
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });
const ts = () => timestamp({ withTimezone: true });

// ---------------------------------------------------------------------
//  Enums
// ---------------------------------------------------------------------

export const tenantStatus = pgEnum('tenant_status', ['ACTIVE', 'PAUSED', 'SUSPENDED']);
export const tenantPlan = pgEnum('tenant_plan', ['TRIAL', 'PAID']);
export const userRole = pgEnum('user_role', ['OWNER', 'ADMIN', 'MEMBER']);
export const channel = pgEnum('channel', ['EMAIL', 'WHATSAPP']);
export const verificationStatus = pgEnum('verification_status', ['PENDING', 'VERIFIED', 'FAILED']);
export const subscriptionStatus = pgEnum('subscription_status', [
  'SUBSCRIBED',
  'UNSUBSCRIBED',
  'BOUNCED', // hard bounce — never send again
  'COMPLAINED', // marked as spam — never send again
]);
export const campaignStatus = pgEnum('campaign_status', [
  'DRAFT',
  'SCHEDULED',
  'SENDING',
  'PAUSED',
  'SENT',
  'CANCELLED',
  'FAILED',
]);
export const messageStatus = pgEnum('message_status', [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'BOUNCED',
  'COMPLAINED',
  'FAILED',
  'SUPPRESSED', // skipped: address on suppression list or not subscribed
]);
export const eventType = pgEnum('event_type', [
  'SEND',
  'DELIVERY',
  'BOUNCE',
  'COMPLAINT',
  'OPEN',
  'CLICK',
  'UNSUBSCRIBE',
  'REJECT',
]);
export const suppressionReason = pgEnum('suppression_reason', [
  'HARD_BOUNCE',
  'COMPLAINT',
  'UNSUBSCRIBE',
  'MANUAL',
]);
export const fieldType = pgEnum('field_type', ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN']);
export const automationStatus = pgEnum('automation_status', ['DRAFT', 'ACTIVE', 'PAUSED']);
export const dateRepeat = pgEnum('date_repeat', ['ONCE', 'YEARLY']);
export const automationSendStatus = pgEnum('automation_send_status', [
  'PENDING',
  'SENT',
  'SKIPPED',
  'FAILED',
]);
export const senderKind = pgEnum('sender_kind', [
  'DOMAIN', // company's own domain, sent through Amazon SES
  'GMAIL', // a connected Gmail / Google Workspace mailbox
  'OUTLOOK', // a connected Outlook / Microsoft 365 mailbox
]);
export const mailboxProvider = pgEnum('mailbox_provider', ['GOOGLE', 'MICROSOFT']);
export const connectionStatus = pgEnum('connection_status', [
  'ACTIVE',
  'REVOKED', // the user removed access in their Google/Microsoft account
  'ERROR',
]);
export const importStatus = pgEnum('import_status', ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']);

// ---------------------------------------------------------------------
//  Tenancy & access
// ---------------------------------------------------------------------

export const tenants = pgTable('tenants', {
  id: id(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  status: tenantStatus().notNull().default('ACTIVE'),
  timezone: text().notNull().default('Asia/Kolkata'),
  monthlyQuota: integer().notNull().default(1000),
  pausedReason: text(),
  // Shown in every email footer — required by anti-spam law
  postalAddress: text(),
  // Free trial: new companies start here; the operator switches them to PAID
  plan: tenantPlan().notNull().default('TRIAL'),
  trialEndsAt: ts(),
  trialEndedAt: ts(), // set once the end-of-trial clean-up has run
  // Unofficial WhatsApp Web sending: on during an active trial. This flag is an operator override for testing.
  whatsappWebEnabled: boolean().notNull().default(false),
  // How customers pay and get reminded (UPI ID, reminder timing and wording, Razorpay keys)
  paymentSettings: jsonb().$type<PaymentSettings>().notNull().default({}),
  // Messages around a trip: before it starts, a review request, "where next?"
  tripMessageSettings: jsonb().$type<TripMessageSettings>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type ReminderChannel = 'AUTO' | 'WHATSAPP' | 'EMAIL';
export interface TripMessageSettings {
  channel?: ReminderChannel;
  preTrip?: { enabled?: boolean; days?: number; text?: string };
  review?: { enabled?: boolean; days?: number; text?: string; url?: string };
  whereNext?: { enabled?: boolean; days?: number; text?: string };
}
export interface PaymentSettings {
  upiId?: string; // where customers pay: name@bank
  upiName?: string; // the name UPI apps show
  contactPhone?: string; // E.164, for "send us the payment screenshot"
  remindersEnabled?: boolean; // default on
  daysBefore?: number; // reminder this many days before a due date (default 3)
  overdueReminder?: boolean; // one reminder the day after a missed date (default on)
  channel?: ReminderChannel; // AUTO: WhatsApp when linked, else email
  beforeText?: string;
  overdueText?: string;
  razorpayKeyId?: string;
  razorpayKeySecretEnc?: string; // AES-GCM, never sent to the browser
  razorpayWebhookSecretEnc?: string;
}

export const users = pgTable(
  'users',
  {
    id: id(),
    tenantId: tenantRef(),
    email: text().notNull(),
    name: text().notNull(),
    passwordHash: text().notNull(),
    role: userRole().notNull().default('MEMBER'),
    lastLoginAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // One email = one login. Stored lower-cased.
  (t) => [uniqueIndex().on(t.email), index().on(t.tenantId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    // sha256 of the cookie token — a database leak never exposes live sessions
    tokenHash: text().notNull().unique(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: tenantRef(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    userAgent: text(),
    ip: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId), index().on(t.expiresAt)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    tenantId: tenantRef(),
    userId: text().references(() => users.id, { onDelete: 'set null' }),
    action: text().notNull(), // "campaign.send", "contact.import"
    entity: text(),
    entityId: text(),
    meta: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.createdAt)],
);

// ---------------------------------------------------------------------
//  Sending identity
// ---------------------------------------------------------------------

export const sendingDomains = pgTable(
  'sending_domains',
  {
    id: id(),
    tenantId: tenantRef(),
    domain: text().notNull(),
    mailFromDomain: text(),
    // Tenant-specific TXT record proving THIS company controls the domain.
    // Without it, a company could "claim" a domain someone else already verified in SES.
    ownershipToken: text()
      .notNull()
      .$defaultFn(() => `sandesh-verify=${createId()}`),
    ownershipStatus: verificationStatus().notNull().default('PENDING'),
    identityStatus: verificationStatus().notNull().default('PENDING'),
    dkimStatus: verificationStatus().notNull().default('PENDING'),
    mailFromStatus: verificationStatus().notNull().default('PENDING'),
    dnsRecords: jsonb(),
    verifiedAt: ts(),
    lastCheckedAt: ts(),
    createdAt: createdAt(),
  },
  // A domain belongs to exactly one company on the platform
  (t) => [uniqueIndex().on(t.domain), index().on(t.tenantId)],
);

// A Gmail/Outlook mailbox a company connected with "Sign in with Google/Microsoft".
// Tokens are encrypted at rest (AES-256-GCM); a database leak alone can't send mail.
export const mailboxConnections = pgTable(
  'mailbox_connections',
  {
    id: id(),
    tenantId: tenantRef(),
    provider: mailboxProvider().notNull(),
    email: text().notNull(), // lower-cased
    displayName: text(),
    refreshTokenEnc: text().notNull(),
    accessTokenEnc: text(),
    accessTokenExpiresAt: ts(),
    scopes: text().notNull(),
    // Gmail allows ~500/day on personal accounts, ~2000 on Workspace; we stay under it
    dailyLimit: integer().notNull().default(400),
    status: connectionStatus().notNull().default('ACTIVE'),
    lastError: text(),
    connectedById: text().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.provider, t.email)],
);

export const senders = pgTable(
  'senders',
  {
    id: id(),
    tenantId: tenantRef(),
    kind: senderKind().notNull().default('DOMAIN'),
    // DOMAIN senders point at a verified domain; GMAIL/OUTLOOK senders at a connected mailbox
    domainId: text().references(() => sendingDomains.id, { onDelete: 'cascade' }),
    connectionId: text().references(() => mailboxConnections.id, { onDelete: 'cascade' }),
    fromName: text().notNull(),
    fromEmail: text().notNull(),
    replyTo: text(),
    isDefault: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex().on(t.tenantId, t.fromEmail),
    // Every sender points at exactly what it sends through
    check(
      'sender_target',
      sql`(${t.kind} = 'DOMAIN' and ${t.domainId} is not null) or (${t.kind} <> 'DOMAIN' and ${t.connectionId} is not null)`,
    ),
  ],
);

// ---------------------------------------------------------------------
//  Audience
// ---------------------------------------------------------------------

export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    tenantId: tenantRef(),
    email: text(), // stored lower-cased
    phone: text(), // E.164, ready for WhatsApp
    firstName: text(),
    lastName: text(),
    attributes: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    emailStatus: subscriptionStatus().notNull().default('SUBSCRIBED'),
    whatsappStatus: subscriptionStatus().notNull().default('UNSUBSCRIBED'), // separate consent
    consentSource: text(),
    consentAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex().on(t.tenantId, t.email),
    uniqueIndex().on(t.tenantId, t.phone),
    index().on(t.tenantId, t.emailStatus),
  ],
);

// Typed definitions for keys in contacts.attributes ("trip_date" is a real DATE)
export const customFields = pgTable(
  'custom_fields',
  {
    id: id(),
    tenantId: tenantRef(),
    key: text().notNull(),
    label: text().notNull(),
    type: fieldType().notNull().default('TEXT'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.key)],
);

export const lists = pgTable(
  'lists',
  {
    id: id(),
    tenantId: tenantRef(),
    name: text().notNull(),
    description: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.name)],
);

export const listMemberships = pgTable(
  'list_memberships',
  {
    listId: text()
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    contactId: text()
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    addedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.contactId] }), index().on(t.contactId)],
);

export type ImportOptions = {
  updateExisting: boolean;
  /** CSV header → contact field ("email", "firstName", "attr:city", or "skip") */
  mapping?: Record<string, string>;
};

export const importJobs = pgTable('import_jobs', {
  id: id(),
  tenantId: tenantRef(),
  fileName: text().notNull(),
  listId: text().references(() => lists.id, { onDelete: 'set null' }),
  createdById: text().references(() => users.id, { onDelete: 'set null' }),
  // Raw file, kept only until the import finishes, then cleared
  sourceCsv: text(),
  options: jsonb().$type<ImportOptions>(),
  status: importStatus().notNull().default('PENDING'),
  totalRows: integer().notNull().default(0),
  imported: integer().notNull().default(0),
  updated: integer().notNull().default(0),
  skipped: integer().notNull().default(0),
  errors: jsonb().$type<{ row: number; reason: string }[]>(),
  createdAt: createdAt(),
  completedAt: ts(),
});

// ---------------------------------------------------------------------
//  Content & campaigns
// ---------------------------------------------------------------------

export const templates = pgTable('templates', {
  id: id(),
  tenantId: tenantRef(),
  channel: channel().notNull().default('EMAIL'),
  name: text().notNull(),
  subject: text(),
  previewText: text(),
  html: text(),
  text: text(),
  design: jsonb(), // editor state, so templates can be re-edited visually
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Audience beyond whole lists. Same shape for campaigns and automations. */
export type AudienceFilter = {
  field: string; // "city" or a core field like "firstName"
  op: 'eq' | 'neq' | 'contains' | 'exists';
  value?: string;
};
export type Audience = {
  listIds?: string[];
  contactIds?: string[];
  filters?: AudienceFilter[];
};

export const campaigns = pgTable(
  'campaigns',
  {
    id: id(),
    tenantId: tenantRef(),
    channel: channel().notNull().default('EMAIL'),
    name: text().notNull(),
    status: campaignStatus().notNull().default('DRAFT'),
    templateId: text().references(() => templates.id, { onDelete: 'set null' }),
    senderId: text().references(() => senders.id, { onDelete: 'set null' }),
    // Snapshots taken at send time — editing a template never changes a sent campaign
    subject: text(),
    previewText: text(),
    html: text(),
    text: text(),
    audience: jsonb().$type<Audience>(),
    scheduledAt: ts(),
    startedAt: ts(),
    completedAt: ts(),
    createdById: text().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // Denormalised counters for a fast dashboard
    recipients: integer().notNull().default(0),
    sent: integer().notNull().default(0),
    delivered: integer().notNull().default(0),
    bounced: integer().notNull().default(0),
    complained: integer().notNull().default(0),
    opened: integer().notNull().default(0),
    clicked: integer().notNull().default(0),
    unsubscribed: integer().notNull().default(0),
    suppressed: integer().notNull().default(0),
    failed: integer().notNull().default(0),
    lastError: text(), // why a scheduled campaign could not start (quota, paused tenant…)
  },
  (t) => [index().on(t.tenantId, t.status), index().on(t.status, t.scheduledAt)],
);

// ---------------------------------------------------------------------
//  Automations — each contact gets the email on THEIR own date
// ---------------------------------------------------------------------

export const automations = pgTable(
  'automations',
  {
    id: id(),
    tenantId: tenantRef(),
    name: text().notNull(),
    status: automationStatus().notNull().default('DRAFT'),
    channel: channel().notNull().default('EMAIL'),
    dateFieldId: text()
      .notNull()
      .references(() => customFields.id, { onDelete: 'restrict' }),
    offsetDays: integer().notNull().default(0), // -3 = 3 days before
    sendTime: text().notNull().default('09:00'), // HH:mm in tenant timezone
    repeat: dateRepeat().notNull().default('ONCE'),
    audience: jsonb().$type<Audience>(),
    templateId: text().references(() => templates.id, { onDelete: 'set null' }),
    senderId: text().references(() => senders.id, { onDelete: 'set null' }),
    activatedAt: ts(), // dates before activation are never back-filled
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    sent: integer().notNull().default(0),
    delivered: integer().notNull().default(0),
    clicked: integer().notNull().default(0),
  },
  (t) => [index().on(t.tenantId, t.status)],
);

// ---------------------------------------------------------------------
//  Delivery & tracking
// ---------------------------------------------------------------------

export const messages = pgTable(
  'messages',
  {
    id: id(),
    tenantId: tenantRef(),
    campaignId: text().references(() => campaigns.id, { onDelete: 'cascade' }), // null for automations
    automationId: text().references(() => automations.id, { onDelete: 'cascade' }),
    // Service messages about a trip (payment reminders): content is stored on the message itself
    tripId: text().references((): AnyPgColumn => trips.id, { onDelete: 'set null' }),
    subject: text(),
    body: text(),
    // About the customer's own booking (payment reminder, trip starting): sent even if they opted out of offers
    service: boolean().notNull().default(false),
    contactId: text().references(() => contacts.id, { onDelete: 'set null' }),
    senderId: text().references(() => senders.id, { onDelete: 'set null' }), // which mailbox/domain sent it
    channel: channel().notNull().default('EMAIL'),
    toAddress: text().notNull(),
    status: messageStatus().notNull().default('QUEUED'),
    providerMessageId: text().unique(), // SES MessageId — joins webhook events
    error: text(),
    attempts: integer().notNull().default(0),
    queuedAt: createdAt(),
    sentAt: ts(),
    deliveredAt: ts(),
    firstOpenedAt: ts(),
    firstClickedAt: ts(),
  },
  (t) => [
    // one message per recipient per campaign — safe retries, never a double send
    uniqueIndex().on(t.campaignId, t.toAddress),
    index().on(t.tenantId, t.status),
    index().on(t.senderId, t.sentAt), // rolling 24h count per mailbox
  ],
);

export const automationSends = pgTable(
  'automation_sends',
  {
    id: id(),
    automationId: text()
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    contactId: text()
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    occurrenceDate: date().notNull(), // the contact's date this send is for
    dueAt: timestamp({ withTimezone: true }).notNull(),
    status: automationSendStatus().notNull().default('PENDING'),
    messageId: text()
      .unique()
      .references(() => messages.id, { onDelete: 'set null' }),
    skipReason: text(),
    createdAt: createdAt(),
    sentAt: ts(),
  },
  (t) => [
    // idempotent scheduler: a restart or rerun can never double-send
    uniqueIndex().on(t.automationId, t.contactId, t.occurrenceDate),
    index().on(t.status, t.dueAt),
  ],
);

export const messageEvents = pgTable(
  'message_events',
  {
    id: id(),
    messageId: text()
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    type: eventType().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    detail: jsonb(),
    // SNS message id — the same notification delivered twice is stored once
    providerEventId: text().unique(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.messageId), index().on(t.type, t.occurredAt)],
);

export const trackedLinks = pgTable(
  'tracked_links',
  {
    id: id(),
    campaignId: text()
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    url: text().notNull(),
    clicks: integer().notNull().default(0),
  },
  (t) => [uniqueIndex().on(t.campaignId, t.url)],
);

export const suppressions = pgTable(
  'suppressions',
  {
    id: id(),
    tenantId: tenantRef(),
    channel: channel().notNull().default('EMAIL'),
    address: text().notNull(), // lower-cased email or E.164 phone
    reason: suppressionReason().notNull(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.channel, t.address)],
);

// ---------------------------------------------------------------------
//  WhatsApp Web session (unofficial, interim). One linked number per company.
// ---------------------------------------------------------------------

export const whatsappSessionStatus = pgEnum('whatsapp_session_status', [
  'DISCONNECTED', // never linked, or unlinked by the company
  'CONNECTING', // waiting for the QR code to be scanned
  'CONNECTED',
  'LOGGED_OUT', // unlinked from the phone (Linked devices → Log out)
  'BLOCKED', // WhatsApp refused the number
]);

export const whatsappSessions = pgTable('whatsapp_sessions', {
  id: id(),
  tenantId: tenantRef().unique(),
  status: whatsappSessionStatus().notNull().default('DISCONNECTED'),
  phone: text(), // E.164 of the linked number
  displayName: text(),
  dailyLimit: integer().notNull().default(200),
  intervalSeconds: integer().notNull().default(10),
  lastError: text(),
  connectedAt: ts(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Every number that has been linked during a trial — one free trial per WhatsApp number
export const whatsappTrialNumbers = pgTable('whatsapp_trial_numbers', {
  phone: text().primaryKey(),
  tenantId: text().references(() => tenants.id, { onDelete: 'set null' }),
  firstLinkedAt: createdAt(),
});

// Login keys for the linked session, encrypted at rest (AES-256-GCM). Deleted on unlink.
export const whatsappAuth = pgTable(
  'whatsapp_auth',
  {
    tenantId: tenantRef(),
    key: text().notNull(),
    valueEnc: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

// ---------------------------------------------------------------------
//  Notifications — what the company should know about (shown in the dashboard)
// ---------------------------------------------------------------------

export const notificationLevel = pgEnum('notification_level', ['INFO', 'SUCCESS', 'WARNING', 'ERROR']);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    tenantId: tenantRef(),
    type: text().notNull(), // campaign.completed, tenant.paused, mailbox.disconnected, domain.verified…
    level: notificationLevel().notNull().default('INFO'),
    title: text().notNull(),
    body: text(),
    link: text(), // dashboard path, e.g. /campaigns/abc
    // Same key = same event; prevents duplicates when a check runs twice
    dedupeKey: text(),
    readAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId, t.createdAt), uniqueIndex().on(t.tenantId, t.dedupeKey)],
);

// ---------------------------------------------------------------------
//  Trips — the agency's work: an enquiry that becomes a booking, then a trip.
//  Money is stored in paise (integers), never floats.
// ---------------------------------------------------------------------

export const tripStatus = pgEnum('trip_status', [
  'ENQUIRY', // someone asked
  'QUOTED', // a price was sent
  'BOOKED', // confirmed (advance paid or agreed)
  'COMPLETED', // back home
  'LOST', // went elsewhere / didn't travel
  'CANCELLED', // booked, then cancelled
]);
export const tripKind = pgEnum('trip_kind', ['PRIVATE', 'GROUP']);
export const paymentMethod = pgEnum('payment_method', ['UPI', 'CASH', 'BANK', 'CARD', 'ONLINE', 'OTHER']);

export const trips = pgTable(
  'trips',
  {
    id: id(),
    tenantId: tenantRef(),
    number: integer().notNull(), // per company: shown as #12
    kind: tripKind().notNull().default('PRIVATE'),
    status: tripStatus().notNull().default('ENQUIRY'),
    // The customer. Kept nullable so erasing a contact doesn't erase the money history.
    contactId: text().references(() => contacts.id, { onDelete: 'set null' }),
    customerName: text().notNull(), // snapshot, for receipts and after erasure
    title: text().notNull(),
    destination: text(),
    startDate: date({ mode: 'string' }),
    endDate: date({ mode: 'string' }),
    adults: integer().notNull().default(1),
    children: integer().notNull().default(0),
    budget: integer(), // paise, what the customer said
    price: integer().notNull().default(0), // paise, the agreed total
    source: text(), // PHONE, WHATSAPP, WALK_IN, WEBSITE, REFERRAL, CALL_AGENT, OTHER
    notes: text(),
    lostReason: text(),
    assignedToId: text().references(() => users.id, { onDelete: 'set null' }),
    createdById: text().references(() => users.id, { onDelete: 'set null' }),
    statusChangedAt: ts(),
    bookedAt: ts(),
    // Set by outside systems (the AI call agent's call id), so a retried request doesn't add the enquiry twice
    externalRef: text(),
    // The customer's page for this trip (what's due, pay by UPI, receipts). Unguessable.
    publicToken: text()
      .notNull()
      .unique()
      .$defaultFn(() => createId() + createId()),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex().on(t.tenantId, t.number),
    uniqueIndex().on(t.tenantId, t.externalRef),
    index().on(t.tenantId, t.status),
    index().on(t.contactId),
    index().on(t.tenantId, t.startDate),
  ],
);

// What the customer owes and when: Advance, 2nd instalment, Balance…
export const tripDues = pgTable(
  'trip_dues',
  {
    id: id(),
    tenantId: tenantRef(),
    tripId: text()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    label: text().notNull(),
    amount: integer().notNull(), // paise
    dueDate: date({ mode: 'string' }).notNull(),
    position: integer().notNull().default(0),
    remindedAt: ts(), // last reminder sent for this due
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tripId), index().on(t.tenantId, t.dueDate)],
);

// Money received. Applied to dues oldest-first. Corrections are voided, never deleted.
export const tripPayments = pgTable(
  'trip_payments',
  {
    id: id(),
    tenantId: tenantRef(),
    tripId: text()
      .notNull()
      .references(() => trips.id, { onDelete: 'no action' }), // a trip with payments can't be deleted
    receiptNumber: integer().notNull(), // per company, never reused
    amount: integer().notNull(), // paise
    method: paymentMethod().notNull(),
    reference: text(), // UPI ref / cheque no / bank txn id
    note: text(),
    paidAt: timestamp({ withTimezone: true }).notNull(),
    // Online payments: the provider's id, so a webhook delivered twice records once
    providerPaymentId: text().unique(),
    // Customers can open their receipt without signing in
    publicToken: text()
      .notNull()
      .unique()
      .$defaultFn(() => createId() + createId()),
    recordedById: text().references(() => users.id, { onDelete: 'set null' }),
    voidedAt: ts(),
    voidReason: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.receiptNumber), index().on(t.tripId), index().on(t.tenantId, t.paidAt)],
);

export const reminderKind = pgEnum('reminder_kind', ['BEFORE', 'OVERDUE']);

// One row per reminder sent: each due gets each kind at most once, whatever reruns
export const tripReminders = pgTable(
  'trip_reminders',
  {
    id: id(),
    tenantId: tenantRef(),
    tripId: text()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    dueId: text()
      .notNull()
      .references(() => tripDues.id, { onDelete: 'cascade' }),
    kind: reminderKind().notNull(),
    channel: channel(), // null when nothing could be sent (no phone/email/sender)
    messageId: text().references(() => messages.id, { onDelete: 'set null' }),
    skipReason: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.dueId, t.kind), index().on(t.tripId)],
);

// Keys other systems (the AI call agent, a website form) use to add enquiries. Only a hash is stored.
export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    tenantId: tenantRef(),
    name: text().notNull(),
    prefix: text().notNull(), // first characters, so people can tell keys apart
    keyHash: text().notNull().unique(), // sha256 of the full key
    createdById: text().references(() => users.id, { onDelete: 'set null' }),
    lastUsedAt: ts(),
    revokedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId)],
);

export const followupKind = pgEnum('followup_kind', ['PRE_TRIP', 'REVIEW', 'WHERE_NEXT']);

// One row per trip message sent: each trip gets each kind at most once
export const tripFollowups = pgTable(
  'trip_followups',
  {
    id: id(),
    tenantId: tenantRef(),
    tripId: text()
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    kind: followupKind().notNull(),
    channel: channel(),
    messageId: text().references(() => messages.id, { onDelete: 'set null' }),
    skipReason: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.tripId, t.kind)],
);

// ---------------------------------------------------------------------
//  Relations (for the relational query API)
// ---------------------------------------------------------------------

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  contacts: many(contacts),
  campaigns: many(campaigns),
  senders: many(senders),
}));

export const usersRelations = relations(users, ({ one }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [sessions.tenantId], references: [tenants.id] }),
}));

export const sendingDomainsRelations = relations(sendingDomains, ({ one, many }) => ({
  tenant: one(tenants, { fields: [sendingDomains.tenantId], references: [tenants.id] }),
  senders: many(senders),
}));

export const sendersRelations = relations(senders, ({ one }) => ({
  tenant: one(tenants, { fields: [senders.tenantId], references: [tenants.id] }),
  domain: one(sendingDomains, { fields: [senders.domainId], references: [sendingDomains.id] }),
  connection: one(mailboxConnections, { fields: [senders.connectionId], references: [mailboxConnections.id] }),
}));

export const mailboxConnectionsRelations = relations(mailboxConnections, ({ one, many }) => ({
  tenant: one(tenants, { fields: [mailboxConnections.tenantId], references: [tenants.id] }),
  senders: many(senders),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  tenant: one(tenants, { fields: [contacts.tenantId], references: [tenants.id] }),
  lists: many(listMemberships),
  messages: many(messages),
}));

export const listsRelations = relations(lists, ({ many }) => ({
  members: many(listMemberships),
}));

export const listMembershipsRelations = relations(listMemberships, ({ one }) => ({
  list: one(lists, { fields: [listMemberships.listId], references: [lists.id] }),
  contact: one(contacts, { fields: [listMemberships.contactId], references: [contacts.id] }),
}));

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  tenant: one(tenants, { fields: [campaigns.tenantId], references: [tenants.id] }),
  sender: one(senders, { fields: [campaigns.senderId], references: [senders.id] }),
  template: one(templates, { fields: [campaigns.templateId], references: [templates.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  tenant: one(tenants, { fields: [messages.tenantId], references: [tenants.id] }),
  trip: one(trips, { fields: [messages.tripId], references: [trips.id] }),
  sender: one(senders, { fields: [messages.senderId], references: [senders.id] }),
  campaign: one(campaigns, { fields: [messages.campaignId], references: [campaigns.id] }),
  automation: one(automations, { fields: [messages.automationId], references: [automations.id] }),
  contact: one(contacts, { fields: [messages.contactId], references: [contacts.id] }),
  events: many(messageEvents),
}));

export const automationsRelations = relations(automations, ({ one }) => ({
  tenant: one(tenants, { fields: [automations.tenantId], references: [tenants.id] }),
  dateField: one(customFields, { fields: [automations.dateFieldId], references: [customFields.id] }),
  sender: one(senders, { fields: [automations.senderId], references: [senders.id] }),
  template: one(templates, { fields: [automations.templateId], references: [templates.id] }),
}));

export const tripsRelations = relations(trips, ({ one, many }) => ({
  tenant: one(tenants, { fields: [trips.tenantId], references: [tenants.id] }),
  contact: one(contacts, { fields: [trips.contactId], references: [contacts.id] }),
  assignedTo: one(users, { fields: [trips.assignedToId], references: [users.id] }),
  dues: many(tripDues),
  payments: many(tripPayments),
}));

export const tripDuesRelations = relations(tripDues, ({ one }) => ({
  trip: one(trips, { fields: [tripDues.tripId], references: [trips.id] }),
}));

export const tripPaymentsRelations = relations(tripPayments, ({ one }) => ({
  trip: one(trips, { fields: [tripPayments.tripId], references: [trips.id] }),
  tenant: one(tenants, { fields: [tripPayments.tenantId], references: [tenants.id] }),
}));

export type Trip = typeof trips.$inferSelect;
export type TripDue = typeof tripDues.$inferSelect;
export type TripPayment = typeof tripPayments.$inferSelect;
export type Tenant = typeof tenants.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Sender = typeof senders.$inferSelect;
export type User = typeof users.$inferSelect;
export type SendingDomain = typeof sendingDomains.$inferSelect;
export type MailboxConnection = typeof mailboxConnections.$inferSelect;

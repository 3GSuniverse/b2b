// Shapes returned by the API (see server/src/modules/*).

export interface Me {
  user: { id: string; name: string; email: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' };
  tenant: { id: string; name: string; slug: string; status: 'ACTIVE' | 'PAUSED' | 'SUSPENDED'; timezone: string; monthlyQuota: number; pausedReason: string | null;
    features?: { whatsapp: boolean };
    plan?: { plan: 'TRIAL' | 'PAID'; trialEndsAt: string | null; trialEnded: boolean; daysLeft: number | null; whatsapp: { perDay: number; sentToday: number } | null; emailLimit: number | null };
  };
}

export interface CampaignStats {
  recipients: number;
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  suppressed: number;
  failed: number;
}
export interface CampaignRates {
  delivery: number;
  open: number;
  click: number;
  bounce: number;
  unsubscribe: number;
}
export type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'PAUSED' | 'SENT' | 'CANCELLED' | 'FAILED';

export interface AudienceFilter {
  field: string;
  op: 'eq' | 'neq' | 'contains' | 'exists';
  value?: string;
}
export interface Audience {
  listIds?: string[];
  contactIds?: string[];
  filters?: AudienceFilter[];
}

export type Channel = 'EMAIL' | 'WHATSAPP';
export interface Campaign {
  id: string;
  name: string;
  channel: Channel;
  status: CampaignStatus;
  sender: { id: string; fromName: string; fromEmail: string; kind: string } | null;
  templateId: string | null;
  subject: string | null;
  previewText: string | null;
  html: string | null;
  text: string | null;
  audience: Audience | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  stats: CampaignStats;
  rates: CampaignRates;
  createdAt: string;
  updatedAt: string;
}

export interface Check {
  id: string;
  level: 'ok' | 'warning' | 'error';
  title: string;
  note?: string;
}

export interface Overview {
  greeting: string;
  account: { name: string; status: string; pausedReason: string | null; timezone: string };
  quota: { used: number; limit: number; resetsOn: string };
  thisMonth: {
    sent: number;
    sentChange: number | null;
    delivered: number;
    deliveryRate: number;
    clicked: number;
    clickRate: number;
    clickRateChange: number | null;
    opened: number;
    unsubscribed: number;
    unsubscribeRate: number;
  };
  last30Days: { day: string; sent: number; delivered: number; clicked: number; campaigns: { id: string; name: string }[] }[];
  health: { sample: number; bounceRate: number; complaintRate: number; bounceLimit: number; complaintLimit: number; status: 'good' | 'at_risk' };
  sending: { domains: { id: string; domain: string; readyToSend: boolean }[]; sendersReady: number; defaultSender: string | null };
  recentCampaigns: { id: string; name: string; status: CampaignStatus; scheduledAt: string | null; startedAt: string | null; updatedAt: string; stats: CampaignStats; rates: CampaignRates }[];
  upcoming: { id: string; name: string; scheduledAt: string; recipients: number } | null;
  audience: { total: number; subscribed: number; suppressed: number };
  unreadNotifications: number;
  communication: Communication;
  whatsappReachable: number;
}

export type MessageSource = 'automation' | 'payment_reminder' | 'trip_message' | 'broadcast' | 'direct';
export interface Communication {
  thisMonth: {
    sent: number;
    sentChange: number | null;
    email: number;
    whatsapp: number;
    automatic: number;
    automaticShare: number;
    delivered: number;
    deliveryRate: number;
    opened: number;
    openRate: number;
    aiDrafts: number;
  };
  last30Days: { day: string; automatic: number; broadcast: number; direct: number }[];
  activity: {
    id: string;
    source: MessageSource;
    title: string;
    to: string;
    channel: 'EMAIL' | 'WHATSAPP';
    status: string;
    opened: boolean;
    at: string;
    trip: { id: string; title: string | null } | null;
  }[];
  comingUp: { departingThisWeek: number; dueThisWeek: number; overdue: number; overdueTrips: number; newEnquiries: number };
}

export interface Notification {
  id: string;
  type: string;
  level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export type SubscriptionStatus = 'SUBSCRIBED' | 'UNSUBSCRIBED' | 'BOUNCED' | 'COMPLAINED';
export interface Contact {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  attributes: Record<string, string | number | boolean>;
  emailStatus: SubscriptionStatus;
  whatsappStatus: SubscriptionStatus;
  consentSource: string | null;
  consentAt: string | null;
  lists: { id: string; name: string }[];
  createdAt: string;
  updatedAt: string;
}
export interface ContactList {
  id: string;
  name: string;
  description: string | null;
  members: number;
  subscribed: number;
  createdAt: string;
}
export interface CustomField {
  id: string;
  key: string;
  label: string;
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN';
}

export interface DnsRecord {
  purpose: 'ownership' | 'dkim' | 'mail_from_mx' | 'mail_from_spf' | 'dmarc';
  type: 'TXT' | 'CNAME' | 'MX';
  name: string;
  value: string;
  priority?: number;
  required: boolean;
  found?: boolean;
}
export interface Domain {
  id: string;
  domain: string;
  mailFromDomain: string | null;
  status: 'verified' | 'pending' | 'failed';
  readyToSend: boolean;
  checks: { ownership: string; domain: string; dkim: string; mailFrom: string };
  records: DnsRecord[];
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
}
export interface Sender {
  id: string;
  kind: 'DOMAIN' | 'GMAIL' | 'OUTLOOK';
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  isDefault: boolean;
  domain: { id: string; domain: string } | null;
  mailbox: { id: string; status: string; dailyLimit: number } | null;
  readyToSend: boolean;
}
export interface Mailbox {
  id: string;
  provider: 'GOOGLE' | 'MICROSOFT';
  email: string;
  displayName: string | null;
  status: 'ACTIVE' | 'REVOKED' | 'ERROR';
  lastError: string | null;
  dailyLimit: number;
  sentLast24h: number;
}

export interface Template {
  id: string;
  name: string;
  subject: string | null;
  previewText: string | null;
  html?: string | null;
  updatedAt: string;
}

export interface Automation {
  id: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  rule: string;
  dateField: { id: string; key: string; label: string };
  offsetDays: number;
  sendTime: string;
  repeat: 'ONCE' | 'YEARLY';
  timezone: string;
  audience: Audience | null;
  template: { id: string; name: string; subject: string | null } | null;
  sender: { id: string; fromName: string; fromEmail: string } | null;
  activatedAt: string | null;
  stats: { sent: number; delivered: number; clicked: number; clickRate: number };
}

export interface Starter {
  id: string;
  name: string;
  description: string;
  subject: string;
  previewText: string;
  html: string;
}

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

export interface CampaignPreview {
  previewAs: { id: string; email: string | null; firstName: string | null; phone?: string | null } | null;
  rendered: Rendered | null;
  checks: Check[];
  canSend: boolean;
  recipients: number;
}

export interface CampaignReport {
  campaign: Campaign;
  pending: number;
  cancelled: number;
  topLinks: { url: string; clicks: number }[];
  problems: { email: string; at: string; detail: Record<string, unknown> | null }[];
}

export interface WhatsAppStatus {
  status: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'LOGGED_OUT' | 'BLOCKED';
  phone: string | null;
  displayName: string | null;
  dailyLimit: number;
  trialPerDay: number | null;
  intervalSeconds: number;
  sentLast24h: number;
  lastError: string | null;
  connectedAt: string | null;
  qr: string | null; // data: URL while linking
}

// ---------------------------------------------------------------- Trips

export type TripStatus = 'ENQUIRY' | 'QUOTED' | 'BOOKED' | 'COMPLETED' | 'LOST' | 'CANCELLED';
export type TripSource = 'PHONE' | 'WHATSAPP' | 'WALK_IN' | 'WEBSITE' | 'REFERRAL' | 'CALL_AGENT' | 'EMAIL' | 'OTHER';
export type DueState = 'PAID' | 'PART_PAID' | 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING';
export type PaymentMethod = 'UPI' | 'CASH' | 'BANK' | 'CARD' | 'ONLINE' | 'OTHER';

export interface TripSummary {
  id: string;
  number: number;
  kind: 'PRIVATE' | 'GROUP';
  status: TripStatus;
  title: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  adults: number;
  children: number;
  budget: number | null; // paise
  price: number; // paise
  source: TripSource | null;
  customer: { id: string | null; name: string; phone: string | null; email: string | null; whatsappStatus: SubscriptionStatus | null };
  assignedTo: { id: string; name: string } | null;
  package: { id: string; name: string } | null;
  money: { paid: number; balance: number; overdue: number; nextDue: { label: string; amount: number; dueDate: string; state: DueState } | null };
  statusChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TripDue {
  id: string;
  label: string;
  amount: number;
  dueDate: string;
  paid: number;
  remaining: number;
  state: DueState;
  remindedAt: string | null;
}

export interface TripPayment {
  id: string;
  receiptNumber: number;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  paidAt: string;
  recordedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  receiptUrl: string;
}

export interface TripDetail extends Omit<TripSummary, 'money'> {
  notes: string | null;
  lostReason: string | null;
  bookedAt: string | null;
  money: TripSummary['money'] & { price: number; scheduled: number; unscheduled: number; dues: TripDue[] };
  payments: TripPayment[];
  suggestedSchedule: { label: string; amount: number; dueDate: string }[] | null;
  payPageUrl: string;
  travellersUrl: string;
  group: { id: string; title: string; number: number } | null;
  reminders: { id: string; dueId: string; dueLabel: string | null; kind: 'BEFORE' | 'OVERDUE'; channel: Channel | null; skipReason: string | null; createdAt: string; status: string | null }[];
  activity: { id: string; action: string; meta: Record<string, unknown> | null; by: string | null; createdAt: string }[];
}

export interface TripStats {
  counts: Record<TripStatus, number>;
  pipelineValue: number;
  collectedThisMonth: number;
  overdue: number;
  overdueTrips: number;
  dueThisWeek: number;
  departingThisWeek: number;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
}

// ---------------------------------------------------------------- Quotes

export type RateKind = 'HOTEL' | 'TRANSPORT' | 'ACTIVITY' | 'TRAVEL' | 'OTHER';
export type RateUnit = 'PER_NIGHT' | 'PER_DAY' | 'PER_PERSON' | 'PER_GROUP';

export interface RateItem {
  id: string;
  kind: RateKind;
  name: string;
  destination: string | null;
  unit: RateUnit;
  price: number; // paise
  cost: number | null;
  notes: string | null;
}

export interface QuoteLine {
  label: string;
  kind: RateKind;
  unit: RateUnit;
  quantity: number;
  times: number;
  unitPrice: number;
  unitCost?: number | null;
  rateItemId?: string | null;
  total?: number;
  needsPrice?: boolean;
}

export interface Quote {
  id: string;
  tripId: string;
  version: number;
  status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED';
  intro: string | null;
  days: { title: string; description: string }[];
  lines: QuoteLine[];
  inclusions: string[];
  exclusions: string[];
  terms: string | null;
  validUntil: string | null;
  totals: { subtotal: number; discount: number; total: number; perPerson: number | null; margin: number | null };
  url: string;
  sentAt: string | null;
  viewedAt: string | null;
  respondedAt: string | null;
  responseNote: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------- Groups

export interface Traveller {
  id: string;
  tripId: string;
  position: number;
  name: string;
  age: number | null;
  gender: 'F' | 'M' | 'O' | null;
  phone: string | null;
  idType: string | null;
  idLast4: string | null;
  food: string | null;
  needs: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  room: string | null;
  seat: string | null;
}

export interface GroupSummary {
  id: string;
  number: number;
  status: TripStatus;
  title: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  capacity: number | null;
  perPersonPrice: number | null;
  packageId: string | null;
  seatsTaken: number;
  families: number;
  expected: number;
  collected: number;
  overdue: number;
}

export interface GroupDetail extends GroupSummary {
  notes: string | null;
  bookings: {
    id: string;
    number: number;
    status: TripStatus;
    customer: { name: string; phone: string | null; email: string | null };
    seats: number;
    adults: number;
    children: number;
    price: number;
    paid: number;
    balance: number;
    overdue: number;
    nextDue: { amount: number; dueDate: string; state: DueState } | null;
    travellers: Traveller[];
    detailsMissing: number;
  }[];
}

// ---------------------------------------------------------------- Packages

export interface PackageStats {
  bookings: number;
  enquiries: number;
  travellers: number;
  value: number;
  received: number;
  cost: number | null;
  margin: number | null;
}

export interface Package {
  id: string;
  name: string;
  destination: string | null;
  nights: number;
  summary: string | null;
  pricePerAdult: number;
  pricePerChild: number | null;
  costPerPerson: number | null;
  marginPerPerson: number | null;
  days: { title: string; description: string }[];
  inclusions: string[];
  exclusions: string[];
  archived: boolean;
  stats: PackageStats;
}

export interface PackageDetail extends Package {
  trips: {
    id: string;
    number: number;
    status: TripStatus;
    customer: string;
    phone: string | null;
    startDate: string | null;
    endDate: string | null;
    adults: number;
    children: number;
    price: number;
    paid: number;
    balance: number;
    overdue: number;
    groupId: string | null;
  }[];
}

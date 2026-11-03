// Shapes returned by the API (see server/src/modules/*).

export interface Me {
  user: { id: string; name: string; email: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' };
  tenant: { id: string; name: string; slug: string; status: 'ACTIVE' | 'PAUSED' | 'SUSPENDED'; timezone: string; monthlyQuota: number; pausedReason: string | null };
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

export interface Campaign {
  id: string;
  name: string;
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

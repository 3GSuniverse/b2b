import { Bug, CreditCard, KeyRound, Lightbulb, Mail, MessageCircle, MoreHorizontal, Plane, Users, type LucideIcon } from 'lucide-react';
import type { Attachment } from './types';

/** What a request is about. Same list as CATEGORIES on the server. */
export type Category = 'billing' | 'whatsapp' | 'email' | 'customers' | 'trips' | 'account' | 'bug' | 'idea' | 'other';
export type TicketStatus = 'OPEN' | 'WAITING' | 'RESOLVED';
export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export const CATEGORIES: { id: Category; label: string; hint: string; icon: LucideIcon; tone: string; solid: string }[] = [
  { id: 'whatsapp', label: 'WhatsApp', hint: 'Linking, sending, broadcasts', icon: MessageCircle, tone: 'bg-success-soft text-success', solid: '#0e9466' },
  { id: 'email', label: 'Email sending', hint: 'Domains, Gmail, bounces', icon: Mail, tone: 'bg-accent-soft text-accent', solid: '#4a3fd1' },
  { id: 'billing', label: 'Plan and payments', hint: 'Bills, GST, upgrades', icon: CreditCard, tone: 'bg-highlight-soft text-warm', solid: '#ff8a1f' },
  { id: 'customers', label: 'Customers and imports', hint: 'Adding, Excel files', icon: Users, tone: 'bg-blue-soft text-blue-ink', solid: '#1b5a93' },
  { id: 'trips', label: 'Trips and quotes', hint: 'Bookings, dues, receipts', icon: Plane, tone: 'bg-plum-soft text-plum-ink', solid: '#7a2b6b' },
  { id: 'account', label: 'Logins and team', hint: 'Passwords, employees', icon: KeyRound, tone: 'bg-line-soft text-ink-2', solid: '#5e5d86' },
  { id: 'bug', label: 'Something broke', hint: 'An error, a page not working', icon: Bug, tone: 'bg-danger-soft text-danger', solid: '#c0283a' },
  { id: 'idea', label: 'An idea', hint: 'Something you wish it did', icon: Lightbulb, tone: 'bg-[#fff6d6] text-[#8a6100]', solid: '#d9a300' },
  { id: 'other', label: 'Something else', hint: 'Anything at all', icon: MoreHorizontal, tone: 'bg-line-soft text-ink-2', solid: '#8b8aaf' },
];
export const categoryOf = (id: string) => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1]!;

export type SupportMessage = {
  id: string;
  author: 'AGENCY' | 'CARE' | 'SYSTEM';
  name: string;
  body: string;
  attachments: Attachment[];
  internal: boolean;
  createdAt: string;
};

/** A request, as the agency sees it in its list. */
export type MyTicket = {
  id: string;
  number: number;
  subject: string;
  category: Category;
  status: TicketStatus;
  priority: Priority;
  unread: boolean;
  lastMessageAt: string;
  createdAt: string;
  rating: number | null;
  byName: string | null;
  last: { body: string; author: string } | null;
};

// ---------------------------------------------------------------- the customer care dashboard

export type CareStaff = { id: string; name: string; email: string };
export type CareView = 'needs_reply' | 'waiting' | 'mine' | 'unassigned' | 'resolved' | 'all';

export type CareSummary = {
  needsReply: number;
  urgent: number;
  unassigned: number;
  waiting: number;
  mine: number;
  resolvedToday: number;
  all: number;
  firstReplyMinutes: number | null;
  rating: number | null;
  oldestOpen: string | null;
};

export type QueueTicket = {
  id: string;
  number: number;
  subject: string;
  category: Category;
  priority: Priority;
  status: TicketStatus;
  unread: boolean;
  lastMessageAt: string;
  createdAt: string;
  firstResponseAt: string | null;
  rating: number | null;
  assigneeId: string | null;
  assigneeName: string | null;
  agencyId: string;
  agencyName: string;
  agencyStatus: 'ACTIVE' | 'PAUSED' | 'SUSPENDED';
  planLabel: string;
  priorityPlan: boolean;
  requester: string | null;
  requesterRole: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
  last: { body: string; author: string } | null;
};

export type CareTicket = {
  ticket: {
    id: string;
    number: number;
    tenantId: string;
    subject: string;
    category: Category;
    priority: Priority;
    status: TicketStatus;
    assigneeId: string | null;
    assignee: { id: string; name: string } | null;
    context: { page?: string; userAgent?: string; screen?: string };
    device: string;
    createdAt: string;
    lastMessageAt: string;
    firstResponseAt: string | null;
    resolvedAt: string | null;
    rating: number | null;
    ratingNote: string | null;
  };
  requester: { id: string; name: string; role: 'OWNER' | 'ADMIN' | 'MEMBER'; email: string | null; username: string | null; lastLoginAt: string | null; disabled: boolean; createdAt: string } | null;
  messages: SupportMessage[];
};

type Verify = 'PENDING' | 'VERIFIED' | 'FAILED';
export type AgencyProfile = {
  agency: { id: string; name: string; loginCode: string; businessType: string; status: 'ACTIVE' | 'PAUSED' | 'SUSPENDED'; pausedReason: string | null; timezone: string; postalAddress: string | null; supportAccess: boolean; createdAt: string; owner: { name: string; email: string | null; lastLoginAt: string | null } | null };
  plan: {
    plan: 'TRIAL' | 'PAID';
    planId: string | null;
    name: string;
    seats: number;
    source: 'trial' | 'paid' | 'operator';
    paidUntil: string | null;
    trialEndsAt: string | null;
    trialEnded: boolean;
    daysLeft: number | null;
    monthlyQuota: number;
    domains: number;
    features: { automations: boolean; groups: boolean; ai: boolean; leadApi: boolean; prioritySupport: boolean };
  };
  people: {
    id: string;
    name: string;
    role: 'OWNER' | 'ADMIN' | 'MEMBER';
    email: string | null;
    username: string | null;
    disabled: boolean;
    lastLoginAt: string | null;
    createdAt: string;
    lastSeenAt: string | null;
    signedInOn: number;
    devices: { device: string; ip: string | null; lastSeenAt: string; since: string }[];
  }[];
  usage: {
    emailsThisMonth: number;
    emailsLast24h: number;
    emailsPerDay: number | null;
    whatsappLast24h: number;
    whatsappPerDay: number | null;
    contacts: { total: number; emailOk: number; whatsappOk: number; bounced: number };
    trips: { total: number; booked: number; thisMonth: number };
    week: Record<'email' | 'whatsapp', { total: number; delivered: number; sent: number; failed: number; bounced: number; queued: number }>;
    topErrors: { channel: 'EMAIL' | 'WHATSAPP'; error: string; n: number; last: string }[];
  };
  channels: {
    whatsapp: { status: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'LOGGED_OUT' | 'BLOCKED'; phone: string | null; displayName: string | null; lastError: string | null; connectedAt: string | null; ownDailyLimit: number | null } | null;
    domains: { id: string; domain: string; ownership: Verify; identity: Verify; dkim: Verify; mailFrom: Verify; verifiedAt: string | null; lastCheckedAt: string | null }[];
    senders: { id: string; kind: 'DOMAIN' | 'GMAIL' | 'OUTLOOK'; fromName: string; fromEmail: string; isDefault: boolean }[];
    mailboxes: { id: string; provider: 'GOOGLE' | 'MICROSOFT'; email: string; status: 'ACTIVE' | 'REVOKED' | 'ERROR'; lastError: string | null; dailyLimit: number; createdAt: string }[];
  };
  campaigns: { id: string; name: string; channel: 'EMAIL' | 'WHATSAPP'; status: string; recipients: number; sent: number; delivered: number; bounced: number; failed: number; opened: number; lastError: string | null; createdAt: string; startedAt: string | null }[];
  payments: { id: string; planId: string; seats: number; period: string; kind: string; amount: number; status: 'CREATED' | 'PAID' | 'FAILED'; createdAt: string; paidAt: string | null; periodStart: string | null; periodEnd: string | null; razorpayPaymentId: string | null }[];
  activity: { id: string; action: string; entity: string | null; meta: unknown; createdAt: string; userName: string | null }[];
  alerts: { id: string; level: 'WARNING' | 'ERROR'; title: string; body: string | null; createdAt: string }[];
  tickets: { id: string; number: number; subject: string; status: TicketStatus; category: Category; createdAt: string; rating: number | null }[];
};

export type AgencyRow = {
  id: string;
  name: string;
  loginCode: string;
  businessType: string;
  status: 'ACTIVE' | 'PAUSED' | 'SUSPENDED';
  planLabel: string;
  trial: boolean;
  paidUntil: string | null;
  trialEndsAt: string | null;
  createdAt: string;
  ownerName: string | null;
  ownerEmail: string | null;
  logins: number;
  openRequests: number;
};

/** How a request's state reads to customer care. */
export const CARE_STATUS: Record<TicketStatus, { label: string; tone: 'orange' | 'blue' | 'green' }> = {
  OPEN: { label: 'Needs reply', tone: 'orange' },
  WAITING: { label: 'Waiting on agency', tone: 'blue' },
  RESOLVED: { label: 'Solved', tone: 'green' },
};
export const PRIORITY: Record<Priority, { label: string; cls: string; dot: string }> = {
  URGENT: { label: 'Urgent', cls: 'bg-danger text-white', dot: 'bg-danger' },
  HIGH: { label: 'High', cls: 'bg-warm-soft text-warm-strong', dot: 'bg-highlight' },
  NORMAL: { label: 'Normal', cls: 'bg-line-soft text-ink-2', dot: 'bg-faint' },
  LOW: { label: 'Low', cls: 'bg-sunken text-muted', dot: 'bg-line' },
};

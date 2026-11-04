import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditLogs, tenants, type PaymentSettings, type Tenant } from '../../db/schema.js';
import { encryptSecret } from '../../lib/crypto.js';
import { db } from '../../lib/db.js';
import { AppError, parseBody } from '../../lib/http.js';
import { requireAuth, requireRole, tenantOf } from '../auth/guard.js';
import { normalizePhone } from '../contacts/normalize.js';
import { findUnknownTags } from '../email/render.js';

export const DEFAULT_BEFORE_TEXT =
  'Hi {first_name}, a gentle reminder from {company_name}: the {due_label} of {amount} for your {trip} is due on {due_date}.\n\nSee the details and pay here: {pay_link}\n\nIf you’ve already paid, please ignore this. Thank you!';
export const DEFAULT_OVERDUE_TEXT =
  'Hi {first_name}, the {due_label} of {amount} for your {trip} was due on {due_date} and we haven’t received it yet.\n\nYou can pay here: {pay_link}\n\nIf you’ve already paid, please send us the payment reference so we can update your booking. Thank you!';

/** Tags a reminder can use, filled in for each customer and instalment. */
export const REMINDER_TAGS = ['first_name', 'full_name', 'amount', 'due_label', 'due_date', 'trip', 'trip_number', 'balance', 'pay_link', 'company_name'] as const;

export function resolvedSettings(t: Pick<Tenant, 'paymentSettings'>) {
  const s = (t.paymentSettings ?? {}) as PaymentSettings;
  return {
    upiId: s.upiId ?? null,
    upiName: s.upiName ?? null,
    contactPhone: s.contactPhone ?? null,
    remindersEnabled: s.remindersEnabled ?? true,
    daysBefore: s.daysBefore ?? 3,
    overdueReminder: s.overdueReminder ?? true,
    channel: s.channel ?? 'AUTO',
    beforeText: s.beforeText ?? DEFAULT_BEFORE_TEXT,
    overdueText: s.overdueText ?? DEFAULT_OVERDUE_TEXT,
    razorpayKeyId: s.razorpayKeyId ?? null,
    razorpaySecretEnc: s.razorpayKeySecretEnc ?? null,
    razorpayWebhookSecretEnc: s.razorpayWebhookSecretEnc ?? null,
  };
}

/** What the dashboard sees: never the secrets themselves. */
export function paymentSettingsDto(t: Pick<Tenant, 'paymentSettings'>) {
  const r = resolvedSettings(t);
  return {
    upiId: r.upiId,
    upiName: r.upiName,
    contactPhone: r.contactPhone,
    remindersEnabled: r.remindersEnabled,
    daysBefore: r.daysBefore,
    overdueReminder: r.overdueReminder,
    channel: r.channel,
    beforeText: r.beforeText,
    overdueText: r.overdueText,
    defaults: { beforeText: DEFAULT_BEFORE_TEXT, overdueText: DEFAULT_OVERDUE_TEXT },
    tags: REMINDER_TAGS,
    razorpay: { connected: !!(r.razorpayKeyId && r.razorpaySecretEnc), keyId: r.razorpayKeyId, webhookSet: !!r.razorpayWebhookSecretEnc },
  };
}

// name@bank: what every UPI app accepts
const UPI_ID = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;

const reminderText = z
  .string()
  .trim()
  .min(20, 'Write a little more')
  .max(1000, 'Keep it under 1,000 characters')
  .superRefine((v, ctx) => {
    const unknown = findUnknownTags(v, REMINDER_TAGS);
    if (unknown.length) ctx.addIssue({ code: 'custom', message: `Unknown tag${unknown.length > 1 ? 's' : ''}: ${unknown.map((u) => `{${u}}`).join(', ')}` });
    if (!v.includes('{pay_link}') && !v.includes('{amount}')) ctx.addIssue({ code: 'custom', message: 'Include {amount} or {pay_link}, so the customer knows what to pay' });
  });

export const settingsBody = z.object({
  upiId: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === '' || UPI_ID.test(v), 'Enter a UPI ID like kurukshetra@okhdfcbank')
    .nullable()
    .optional(),
  upiName: z.string().trim().max(60).nullable().optional(),
  contactPhone: z.string().trim().max(30).nullable().optional(),
  remindersEnabled: z.boolean().optional(),
  daysBefore: z.coerce.number().int().min(1, 'At least 1 day').max(15, 'At most 15 days').optional(),
  overdueReminder: z.boolean().optional(),
  channel: z.enum(['AUTO', 'WHATSAPP', 'EMAIL']).optional(),
  beforeText: reminderText.nullable().optional(), // null: back to our wording
  overdueText: reminderText.nullable().optional(),
  razorpayKeyId: z
    .string()
    .trim()
    .regex(/^rzp_(live|test)_[A-Za-z0-9]{8,32}$/, 'Key IDs start with rzp_live_ or rzp_test_')
    .nullable()
    .optional(),
  razorpayKeySecret: z.string().trim().min(10).max(100).optional(),
  razorpayWebhookSecret: z.string().trim().min(8).max(200).optional(),
});

export async function updatePaymentSettings(tenantId: string, userId: string, input: z.infer<typeof settingsBody>) {
  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!t) throw new AppError(404, 'not_found', 'Company not found');
  const next: PaymentSettings = { ...((t.paymentSettings ?? {}) as PaymentSettings) };
  const setOrClear = <K extends keyof PaymentSettings>(k: K, v: PaymentSettings[K] | null | undefined) => {
    if (v === undefined) return;
    if (v === null || v === '') delete next[k];
    else next[k] = v;
  };
  setOrClear('upiId', input.upiId?.toLowerCase());
  setOrClear('upiName', input.upiName);
  if (input.contactPhone !== undefined) {
    const phone = input.contactPhone ? normalizePhone(input.contactPhone) : null;
    if (input.contactPhone && !phone) throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: { contactPhone: 'Enter a valid phone number' } });
    setOrClear('contactPhone', phone);
  }
  setOrClear('remindersEnabled', input.remindersEnabled);
  setOrClear('daysBefore', input.daysBefore);
  setOrClear('overdueReminder', input.overdueReminder);
  setOrClear('channel', input.channel);
  setOrClear('beforeText', input.beforeText === DEFAULT_BEFORE_TEXT ? null : input.beforeText);
  setOrClear('overdueText', input.overdueText === DEFAULT_OVERDUE_TEXT ? null : input.overdueText);
  if (input.razorpayKeyId === null) {
    // Disconnect Razorpay entirely
    delete next.razorpayKeyId;
    delete next.razorpayKeySecretEnc;
    delete next.razorpayWebhookSecretEnc;
  } else {
    setOrClear('razorpayKeyId', input.razorpayKeyId);
    if (input.razorpayKeySecret) next.razorpayKeySecretEnc = encryptSecret(input.razorpayKeySecret);
    if (input.razorpayWebhookSecret) next.razorpayWebhookSecretEnc = encryptSecret(input.razorpayWebhookSecret);
    if (next.razorpayKeyId && !next.razorpayKeySecretEnc) {
      throw new AppError(400, 'validation_failed', 'Some fields need attention', { fields: { razorpayKeySecret: 'Enter the key secret too' } });
    }
  }
  const [row] = await db.update(tenants).set({ paymentSettings: next }).where(eq(tenants.id, tenantId)).returning();
  await db.insert(auditLogs).values({
    tenantId,
    userId,
    action: 'payments.settings',
    entity: 'tenant',
    entityId: tenantId,
    meta: { fields: Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined).map((k) => (k.toLowerCase().includes('secret') ? `${k} (changed)` : k)) },
  });
  return paymentSettingsDto(row!);
}

export async function paymentSettingsRoutes(app: FastifyInstance) {
  app.get('/api/payments/settings', { preHandler: requireAuth }, async (req) => {
    const t = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantOf(req)) });
    return { settings: paymentSettingsDto(t!) };
  });
  app.patch('/api/payments/settings', { preHandler: requireRole('ADMIN') }, async (req) => ({
    settings: await updatePaymentSettings(tenantOf(req), req.auth!.userId, parseBody(settingsBody, req.body)),
  }));
}

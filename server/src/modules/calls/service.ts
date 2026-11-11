import { and, desc, eq, gte, lt, sql, sum } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { auditLogs, callOptouts, calls, callSettings, callViolations, callWalletEntries, sessions, tenants, users } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import type { Viewer } from '../auth/guard.js';
import { notify } from '../notifications/service.js';
import { hasFeature } from '../plans/entitlements.js';
import { checkInstructions, indianNumber, isSevere, type Violation } from './safety.js';
import { voiceEnabled } from './voice.js';
import { aiEnabled } from '../ai/quote-draft.js';

export type CallSettings = typeof callSettings.$inferSelect;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:00');
export const settingsBody = z.object({
  enabled: z.boolean(),
  agentName: z.string().trim().min(2).max(30),
  language: z.enum(['en', 'te', 'hi']),
  purpose: z.enum(['SALES', 'SUPPORT', 'BOTH']),
  greeting: z.string().trim().max(300).nullable(),
  instructions: z.string().trim().max(2000).nullable(),
  hoursFrom: time,
  hoursTo: time,
});

export async function settingsOf(tenantId: string): Promise<CallSettings> {
  const s = await db.query.callSettings.findFirst({ where: eq(callSettings.tenantId, tenantId) });
  if (s) return s;
  const [created] = await db.insert(callSettings).values({ tenantId }).onConflictDoNothing().returning();
  return created ?? (await db.query.callSettings.findFirst({ where: eq(callSettings.tenantId, tenantId) }))!;
}

/** Minutes left in the agency's calling wallet. */
export async function balance(tenantId: string) {
  const [r] = await db.select({ m: sum(callWalletEntries.minutes) }).from(callWalletEntries).where(eq(callWalletEntries.tenantId, tenantId));
  return Number(r?.m ?? 0);
}

/** Everything the AI Caller page shows. */
export async function overview(v: Viewer) {
  const t = (await db.query.tenants.findFirst({ where: eq(tenants.id, v.tenantId) }))!;
  const s = await settingsOf(v.tenantId);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      answered: sql<number>`count(*) filter (where ${calls.status} = 'COMPLETED')::int`,
      interested: sql<number>`count(*) filter (where ${calls.outcome} = 'INTERESTED')::int`,
      needsHuman: sql<number>`count(*) filter (where ${calls.outcome} in ('NEEDS_HUMAN', 'CALLBACK'))::int`,
      minutes: sql<number>`coalesce(sum(${calls.minutesBilled}), 0)::int`,
    })
    .from(calls)
    .where(and(eq(calls.tenantId, v.tenantId), gte(calls.createdAt, since)));
  return {
    allowed: hasFeature(t, 'calls'),
    ready: { voice: voiceEnabled(), ai: aiEnabled(), line: !!env.CALL_STREAM_TOKEN },
    settings: publicSettings(s),
    minutes: await balance(v.tenantId),
    last30: stats ?? { total: 0, answered: 0, interested: 0, needsHuman: 0, minutes: 0 },
  };
}

const publicSettings = (s: CallSettings) => ({
  enabled: s.enabled,
  agentName: s.agentName,
  language: s.language,
  purpose: s.purpose,
  greeting: s.greeting,
  instructions: s.instructions,
  callFrom: s.callFrom,
  hoursFrom: s.hoursFrom,
  hoursTo: s.hoursTo,
  suspended: s.suspendedAt ? { at: s.suspendedAt, reason: s.suspendedReason } : null,
});

/**
 * Saves the caller's settings. What the agency wrote is checked first: a severe misuse (OTP
 * collection, pretending to be a bank or the police, threats, hiding that it's an AI) switches
 * calling off for the agency at once, switches off the manager login that wrote it, and tells
 * the owner. Milder problems just aren't saved, with the reason shown.
 */
export async function saveSettings(v: Viewer, input: z.infer<typeof settingsBody>) {
  const current = await settingsOf(v.tenantId);
  if (current.suspendedAt) throw suspendedError(current);
  const problems = checkInstructions(input.agentName, input.greeting, input.instructions);
  if (isSevere(problems)) {
    await blockForMisuse(v, problems);
    throw new AppError(403, 'call_misuse', 'AI Caller has been switched off for your agency: these instructions could be used to cheat people on the phone. The Drona team will look into it.', { problems: problems.map((p) => p.why) });
  }
  if (problems.length) {
    throw new AppError(422, 'call_instructions', `Please change this: ${problems[0]!.why.toLowerCase()} isn’t allowed on calls.`, { problems: problems.map((p) => p.why) });
  }
  if (input.enabled) {
    const t = (await db.query.tenants.findFirst({ where: eq(tenants.id, v.tenantId) }))!;
    if (!hasFeature(t, 'calls')) throw new AppError(403, 'plan_upgrade', 'AI Caller comes with the Professional plan. Choose Professional for your next billing cycle in Plan & billing.', { feature: 'calls', plan: 'professional' });
  }
  const [saved] = await db
    .update(callSettings)
    .set({ ...input, greeting: input.greeting || null, instructions: input.instructions || null })
    .where(eq(callSettings.tenantId, v.tenantId))
    .returning();
  await db.insert(auditLogs).values({ tenantId: v.tenantId, userId: v.userId, action: 'calls.settings', entity: 'call_settings', entityId: v.tenantId, meta: { enabled: input.enabled } });
  return publicSettings(saved!);
}

const suspendedError = (s: CallSettings) =>
  new AppError(403, 'calls_suspended', `AI Caller is switched off for your agency${s.suspendedReason ? ` (${s.suspendedReason.toLowerCase()})` : ''}. Contact Drona customer care.`);

async function blockForMisuse(v: Viewer, problems: Violation[]) {
  const severe = problems.filter((p) => p.severity === 'SEVERE');
  const reason = severe[0]!.why;
  await db.transaction(async (tx) => {
    await tx.insert(callViolations).values(severe.map((p) => ({ tenantId: v.tenantId, userId: v.userId, kind: p.kind, severity: p.severity, detail: p.match })));
    await tx.update(callSettings).set({ enabled: false, suspendedAt: new Date(), suspendedReason: reason }).where(eq(callSettings.tenantId, v.tenantId));
    // A manager who tried it loses their login right away (the owner's account stays, calling doesn't)
    if (v.role !== 'OWNER') {
      await tx.update(users).set({ disabledAt: new Date() }).where(and(eq(users.id, v.userId), eq(users.tenantId, v.tenantId)));
      await tx.delete(sessions).where(eq(sessions.userId, v.userId));
    }
    await tx.insert(auditLogs).values({ tenantId: v.tenantId, userId: v.userId, action: 'calls.misuse_blocked', entity: 'call_settings', entityId: v.tenantId, meta: { problems: severe } });
  });
  const who = await db.query.users.findFirst({ where: eq(users.id, v.userId), columns: { name: true } });
  await notify(v.tenantId, {
    type: 'calls.suspended',
    level: 'ERROR',
    title: 'AI Caller switched off for safety',
    body: `${who?.name ?? 'Someone'} wrote caller instructions that could cheat people (${reason.toLowerCase()}).${v.role !== 'OWNER' ? ' Their login has been switched off.' : ''} The Drona team will review it.`,
    link: '/calls',
  });
  console.warn(`[calls] misuse blocked for tenant ${v.tenantId} by user ${v.userId}: ${severe.map((p) => p.kind).join(', ')}`);
}

export const listQuery = z.object({
  outcome: z.enum(['ALL', 'INTERESTED', 'NEEDS_HUMAN', 'NOT_INTERESTED', 'ANSWERED']).default('ALL'),
  before: z.string().datetime().optional(),
});

/** Recent calls, newest first (40 at a time). */
export async function listCalls(v: Viewer, q: z.infer<typeof listQuery>) {
  const where = [eq(calls.tenantId, v.tenantId)];
  if (q.outcome === 'NEEDS_HUMAN') where.push(sql`${calls.outcome} in ('NEEDS_HUMAN', 'CALLBACK')`);
  else if (q.outcome !== 'ALL') where.push(eq(calls.outcome, q.outcome));
  if (q.before) where.push(lt(calls.createdAt, new Date(q.before)));
  const rows = await db
    .select({ id: calls.id, direction: calls.direction, phone: calls.phone, status: calls.status, outcome: calls.outcome, summary: calls.summary, seconds: calls.seconds, createdAt: calls.createdAt })
    .from(calls)
    .where(and(...where))
    .orderBy(desc(calls.createdAt))
    .limit(40);
  return { calls: rows };
}

export async function getCall(v: Viewer, id: string) {
  const c = await db.query.calls.findFirst({ where: and(eq(calls.id, id), eq(calls.tenantId, v.tenantId)) });
  if (!c) throw new AppError(404, 'not_found', 'Call not found');
  return { call: c };
}

export const optoutBody = z.object({ phone: z.string().trim().min(8).max(20), reason: z.string().trim().max(200).optional() });

export async function listOptouts(tenantId: string) {
  return { numbers: await db.select().from(callOptouts).where(eq(callOptouts.tenantId, tenantId)).orderBy(desc(callOptouts.createdAt)).limit(500) };
}
export async function addOptout(tenantId: string, rawPhone: string, reason?: string) {
  const phone = indianNumber(rawPhone);
  if (!phone) throw new AppError(422, 'bad_phone', 'That doesn’t look like a phone number', { fields: { phone: 'Enter a 10-digit mobile number' } });
  await db.insert(callOptouts).values({ tenantId, phone, reason: reason ?? null }).onConflictDoNothing();
  return { ok: true, phone };
}
export async function removeOptout(tenantId: string, id: string) {
  await db.delete(callOptouts).where(and(eq(callOptouts.id, id), eq(callOptouts.tenantId, tenantId)));
  return { ok: true };
}

// ---------------------------------------------------------------------
//  The live side: used while a call is on
// ---------------------------------------------------------------------

/** Why a call can't be taken right now, or null when it can. */
/** Why a call can't be taken, or null. A practice call from the website skips the on/off switch and the minutes. */
export async function refusal(tenantId: string, s: CallSettings, practice = false) {
  if (!practice && !s.enabled) return 'switched_off';
  if (s.suspendedAt) return 'suspended';
  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!t || t.status !== 'ACTIVE') return 'agency_inactive';
  if (!hasFeature(t, 'calls')) return 'plan';
  if (!practice && (await balance(tenantId)) <= 0) return 'no_minutes';
  return null;
}

/** The agency whose Dhrona calling number was dialled. */
export async function agencyForNumber(dialled: string) {
  const phone = indianNumber(dialled);
  if (!phone) return null;
  const s = await db.query.callSettings.findFirst({ where: eq(callSettings.callFrom, phone) });
  if (!s) return null;
  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, s.tenantId) });
  return t ? { tenant: t, settings: s } : null;
}

export async function startCall(tenantId: string, input: { direction: 'IN' | 'OUT'; phone: string; purpose: CallSettings['purpose']; providerCallId?: string }) {
  const [c] = await db.insert(calls).values({ tenantId, direction: input.direction, phone: input.phone, purpose: input.purpose, status: 'IN_PROGRESS', providerCallId: input.providerCallId ?? null }).returning();
  return c!;
}

/** Saves how the call went and takes its minutes from the wallet (every started minute counts). */
export async function finishCall(
  tenantId: string,
  callId: string,
  r: { seconds: number; transcript: { from: 'agent' | 'customer'; text: string }[]; outcome: NonNullable<(typeof calls.$inferSelect)['outcome']> | null; summary: string | null; failed?: boolean; free?: boolean },
) {
  const minutes = r.seconds > 0 ? Math.ceil(r.seconds / 60) : 0;
  const status = r.failed ? 'FAILED' : r.transcript.some((t) => t.from === 'customer') ? 'COMPLETED' : 'NO_ANSWER';
  const [c] = await db
    .update(calls)
    .set({ status, seconds: r.seconds, minutesBilled: minutes, transcript: r.transcript, outcome: r.outcome, summary: r.summary, endedAt: new Date() })
    .where(and(eq(calls.id, callId), eq(calls.tenantId, tenantId)))
    .returning();
  if (minutes && !r.free) await db.insert(callWalletEntries).values({ tenantId, minutes: -minutes, reason: 'call', callId });
  if (c && (r.outcome === 'INTERESTED' || r.outcome === 'NEEDS_HUMAN' || r.outcome === 'CALLBACK')) {
    const hot = r.outcome === 'INTERESTED';
    await notify(tenantId, {
      type: hot ? 'calls.interested' : 'calls.needs_human',
      level: hot ? 'SUCCESS' : 'WARNING',
      title: hot ? `Interested caller: ${c.phone}` : `Call back ${c.phone}`,
      body: r.summary ?? undefined,
      link: `/calls?call=${c.id}`,
      dedupeKey: `call:${c.id}`,
    });
  }
  return c;
}

export async function isOptedOut(tenantId: string, phone: string) {
  return !!(await db.query.callOptouts.findFirst({ where: and(eq(callOptouts.tenantId, tenantId), eq(callOptouts.phone, phone)), columns: { id: true } }));
}

/**
 * Operator controls for the AI Caller.
 *
 *   drona calls number <owner email> <Exotel number>   the agency's Dhrona calling number
 *   drona calls minutes <owner email> <minutes> [note]  add calling minutes (negative takes back)
 *   drona calls unsuspend <owner email>                 switch calling back on after a safety review
 *   drona calls status <owner email>                    number, minutes, safety alerts
 *
 * Calling numbers are set only here, never by agencies, so nobody can take over a number that isn't theirs.
 */
import { desc, eq } from 'drizzle-orm';
import { auditLogs, callSettings, callViolations, callWalletEntries, tenants, users } from '../db/schema.js';
import { closeDatabase, db } from '../lib/db.js';
import { indianNumber } from '../modules/calls/safety.js';
import { balance, settingsOf } from '../modules/calls/service.js';

const USAGE = 'Usage: drona calls number|minutes|unsuspend|status <owner email or company slug> [value]';

async function main() {
  const [action, who, value, ...rest] = process.argv.slice(2);
  if (!action || !who) return fail(USAGE);
  const tenant = who.includes('@')
    ? await db.query.users.findFirst({ where: eq(users.email, who.toLowerCase()), with: { tenant: true } }).then((u) => u?.tenant)
    : await db.query.tenants.findFirst({ where: eq(tenants.slug, who) });
  if (!tenant) return fail(`No company found for "${who}"`);
  const s = await settingsOf(tenant.id);
  const log = (what: string, meta: object) => db.insert(auditLogs).values({ tenantId: tenant.id, action: `calls.${what}`, entity: 'call_settings', entityId: tenant.id, meta: { by: 'operator-cli', ...meta } });

  if (action === 'number') {
    const phone = value === 'none' ? null : indianNumber(value);
    if (value !== 'none' && !phone) return fail('Give the number like 08046801234 or +918046801234, or "none" to remove it');
    await db.update(callSettings).set({ callFrom: phone }).where(eq(callSettings.tenantId, tenant.id));
    await log('number', { phone });
    console.log(phone ? `${tenant.name} now answers calls on ${phone}` : `${tenant.name} has no calling number now`);
  } else if (action === 'minutes') {
    const minutes = Number(value);
    if (!Number.isInteger(minutes) || minutes === 0) return fail('Give a whole number of minutes, e.g. 300');
    await db.insert(callWalletEntries).values({ tenantId: tenant.id, minutes, reason: minutes > 0 ? 'grant' : 'adjust', note: rest.join(' ') || 'operator' });
    await log('minutes', { minutes });
    console.log(`${tenant.name}: ${minutes > 0 ? 'added' : 'took back'} ${Math.abs(minutes)} minutes. Balance: ${await balance(tenant.id)} minutes`);
  } else if (action === 'unsuspend') {
    await db.update(callSettings).set({ suspendedAt: null, suspendedReason: null }).where(eq(callSettings.tenantId, tenant.id));
    await log('unsuspend', {});
    console.log(`AI Caller can be switched on again by ${tenant.name}. (Logins switched off for misuse stay off; turn them on from the agency's Team page if that was a mistake.)`);
  } else if (action === 'status') {
    const v = await db.select().from(callViolations).where(eq(callViolations.tenantId, tenant.id)).orderBy(desc(callViolations.createdAt)).limit(10);
    console.log(`${tenant.name}
  calling number: ${s.callFrom ?? '(none)'}
  switched on:    ${s.enabled ? 'yes' : 'no'}${s.suspendedAt ? `  (SUSPENDED ${s.suspendedAt.toISOString()}: ${s.suspendedReason})` : ''}
  minutes left:   ${await balance(tenant.id)}
  safety alerts:  ${v.length ? '' : 'none'}`);
    for (const x of v) console.log(`    ${x.createdAt.toISOString().slice(0, 16)} ${x.severity} ${x.kind}: "${x.detail}"`);
  } else return fail(USAGE);
}

function fail(msg: string) {
  console.error(msg);
  process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());

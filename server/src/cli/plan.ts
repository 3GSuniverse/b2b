/**
 * Operator command for plans (for agencies that pay offline, or to fix something by hand).
 *
 *   drona plan <company slug or owner email> basic|professional|ultra <logins> [days]   (paid for days, default 30)
 *   drona plan <company slug or owner email> paid [monthly email limit]                 (everything, no end date)
 *   drona plan <company slug or owner email> trial <days>                               (extend or restart a trial)
 *   drona plan <company slug or owner email>                                            (show)
 */
import { eq } from 'drizzle-orm';
import { auditLogs, tenants, users } from '../db/schema.js';
import { closeDatabase, db } from '../lib/db.js';
import { BILLING_PLANS, emailsFor, isPlanId, validSeats } from '../modules/billing/plans.js';

async function main() {
  const [who, action, arg] = process.argv.slice(2);
  if (!who) {
    console.error('Usage: drona plan <company slug or owner email> [basic|professional|ultra <logins> [days] | paid [emails] | trial <days>]');
    process.exitCode = 1;
    return;
  }
  const tenant = who.includes('@')
    ? await db.query.users.findFirst({ where: eq(users.email, who.toLowerCase()), with: { tenant: true } }).then((u) => u?.tenant)
    : await db.query.tenants.findFirst({ where: eq(tenants.slug, who) });
  if (!tenant) {
    console.error(`No company found for "${who}"`);
    process.exitCode = 1;
    return;
  }
  if (isPlanId(action)) {
    const seats = Number(arg);
    const days = Number(process.argv[5] ?? 30);
    if (!validSeats(seats) || !Number.isInteger(days) || days < 1 || days > 400) {
      console.error('Give the number of employee logins (1 to 50) and, optionally, the days paid for (default 30)');
      process.exitCode = 1;
      return;
    }
    const paidUntil = new Date(Date.now() + days * 86_400_000);
    await db
      .update(tenants)
      .set({ plan: 'PAID', planId: action, seats, paidUntil, monthlyQuota: emailsFor(action, seats), trialEndedAt: null })
      .where(eq(tenants.id, tenant.id));
    await db.insert(auditLogs).values({ tenantId: tenant.id, action: 'plan.set', entity: 'tenant', entityId: tenant.id, meta: { plan: action, seats, days, by: 'operator-cli' } });
    console.log(`${tenant.name}: ${BILLING_PLANS[action].name}, ${seats} logins, paid until ${paidUntil.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  } else if (action === 'paid') {
    const quota = Number(arg ?? 5000);
    await db.update(tenants).set({ plan: 'PAID', planId: null, seats: null, paidUntil: null, monthlyQuota: quota, trialEndedAt: null }).where(eq(tenants.id, tenant.id));
    await db.insert(auditLogs).values({ tenantId: tenant.id, action: 'plan.paid', entity: 'tenant', entityId: tenant.id, meta: { quota, by: 'operator-cli' } });
    console.log(`${tenant.name} is now on the paid plan (${quota.toLocaleString('en-IN')} emails a month). WhatsApp Web is no longer offered to them.`);
  } else if (action === 'trial') {
    const days = Number(arg);
    if (!Number.isInteger(days) || days < 1 || days > 60) {
      console.error('Give the number of days, 1 to 60');
      process.exitCode = 1;
      return;
    }
    const ends = new Date(Date.now() + days * 86_400_000);
    await db.update(tenants).set({ plan: 'TRIAL', trialEndsAt: ends, trialEndedAt: null }).where(eq(tenants.id, tenant.id));
    await db.insert(auditLogs).values({ tenantId: tenant.id, action: 'plan.trial', entity: 'tenant', entityId: tenant.id, meta: { days, by: 'operator-cli' } });
    console.log(`${tenant.name}'s trial now ends ${ends.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  } else {
    const paid = isPlanId(tenant.planId) ? `${BILLING_PLANS[tenant.planId].name}, ${tenant.seats} logins, paid until ${tenant.paidUntil?.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` : 'everything (set by hand)';
    console.log(`${tenant.name}: ${tenant.plan === 'TRIAL' ? `trial, ends ${tenant.trialEndsAt?.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) ?? 'not set'}` : paid}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());

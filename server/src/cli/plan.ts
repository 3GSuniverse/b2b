/**
 * Operator command for plans, until online payments exist.
 *
 *   drona plan <company slug or owner email> paid [monthly email limit]
 *   drona plan <company slug or owner email> trial <days>       (extend or restart a trial)
 *   drona plan <company slug or owner email>                   (show)
 */
import { eq } from 'drizzle-orm';
import { auditLogs, tenants, users } from '../db/schema.js';
import { closeDatabase, db } from '../lib/db.js';

async function main() {
  const [who, action, arg] = process.argv.slice(2);
  if (!who) {
    console.error('Usage: drona plan <company slug or owner email> [paid [emails] | trial <days>]');
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
  if (action === 'paid') {
    const quota = Number(arg ?? 5000);
    await db.update(tenants).set({ plan: 'PAID', monthlyQuota: quota, trialEndedAt: null }).where(eq(tenants.id, tenant.id));
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
    console.log(`${tenant.name}: ${tenant.plan}${tenant.plan === 'TRIAL' ? `, ends ${tenant.trialEndsAt?.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) ?? 'not set'}` : ''}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());

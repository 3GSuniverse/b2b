/**
 * Operator switch for features that aren't self-serve.
 *
 *   hayate feature whatsapp-web <company slug or owner email> on|off
 *
 * WhatsApp Web sending is unofficial: it stays off unless the operator turns it
 * on for a specific company, so it can never become part of what's sold by accident.
 */
import { eq } from 'drizzle-orm';
import { auditLogs, tenants, users } from '../db/schema.js';
import { closeDatabase, db } from '../lib/db.js';

async function main() {
  const [feature, who, state = ""] = process.argv.slice(2);
  if (feature !== 'whatsapp-web' || !who || !['on', 'off'].includes(state ?? '')) {
    console.error('Usage: hayate feature whatsapp-web <company slug or owner email> on|off');
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
  await db.update(tenants).set({ whatsappWebEnabled: state === 'on' }).where(eq(tenants.id, tenant.id));
  await db.insert(auditLogs).values({ tenantId: tenant.id, action: `feature.whatsapp_web.${state}`, entity: 'tenant', entityId: tenant.id, meta: { by: 'operator-cli' } });
  console.log(`WhatsApp Web sending is now ${state.toUpperCase()} for ${tenant.name}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());

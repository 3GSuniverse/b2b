/**
 * Customer care staff accounts. Only the operator creates them, from the server.
 *
 *   drona care add <email> "<full name>"          new account; prints a one-time password
 *   drona care password <email>                   a new password (signs them out everywhere)
 *   drona care off <email> | on <email>           switch an account off or back on
 *   drona care list
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { careSessions, careStaff } from '../db/schema.js';
import { closeDatabase, db } from '../lib/db.js';
import { hashPassword } from '../modules/auth/password.js';

const USAGE = `Usage:
  drona care add <email> "<full name>"
  drona care password <email>
  drona care off <email>
  drona care on <email>
  drona care list`;

// Easy to read out and type: no 0/O or 1/l
const newPassword = () =>
  Array.from(randomBytes(14), (b) => 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 55])
    .join('')
    .replace(/(.{5})(?=.)/g, '$1-');

async function find(email: string | undefined) {
  if (!email) throw new Error(USAGE);
  const s = await db.query.careStaff.findFirst({ where: eq(careStaff.email, email.toLowerCase()) });
  if (!s) throw new Error(`No customer care account for ${email}`);
  return s;
}

async function main() {
  const [cmd, email, name] = process.argv.slice(2);
  if (cmd === 'add') {
    if (!email?.includes('@') || !name) throw new Error(USAGE);
    const password = newPassword();
    await db.insert(careStaff).values({ email: email.toLowerCase(), name, passwordHash: await hashPassword(password) });
    console.log(`Customer care account made for ${name}.\nSign in at /care with ${email.toLowerCase()} and this password:\n\n  ${password}\n\nIt is shown only once.`);
  } else if (cmd === 'password') {
    const s = await find(email);
    const password = newPassword();
    await db.update(careStaff).set({ passwordHash: await hashPassword(password) }).where(eq(careStaff.id, s.id));
    await db.delete(careSessions).where(eq(careSessions.staffId, s.id));
    console.log(`New password for ${s.name}:\n\n  ${password}\n`);
  } else if (cmd === 'off' || cmd === 'on') {
    const s = await find(email);
    await db.update(careStaff).set({ disabledAt: cmd === 'off' ? new Date() : null }).where(eq(careStaff.id, s.id));
    if (cmd === 'off') await db.delete(careSessions).where(eq(careSessions.staffId, s.id));
    console.log(`${s.name} is now ${cmd === 'off' ? 'switched off' : 'switched back on'}.`);
  } else if (cmd === 'list') {
    const all = await db.select().from(careStaff).orderBy(careStaff.name);
    if (!all.length) console.log('No customer care accounts yet. Add one with: drona care add <email> "<full name>"');
    for (const s of all) console.log(`${s.disabledAt ? '[off] ' : ''}${s.name} <${s.email}>, last signed in ${s.lastLoginAt?.toISOString().slice(0, 16).replace('T', ' ') ?? 'never'}`);
  } else {
    throw new Error(USAGE);
  }
}

main()
  .catch((e: Error & { code?: string }) => {
    console.error(e.code === '23505' ? 'That email already has a customer care account.' : e.message);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());

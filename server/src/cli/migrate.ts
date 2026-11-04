/**
 * Applies database migrations (drizzle/*.sql) in production, without dev tools.
 * Safe to run on every deploy: already-applied migrations are skipped.
 */
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDatabase, db } from '../lib/db.js';

const folder = process.env.MIGRATIONS_DIR ?? path.join(process.cwd(), 'drizzle');
try {
  await migrate(db, { migrationsFolder: folder });
  console.log('Database is up to date');
} catch (err) {
  console.error('Migration failed:', err);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}

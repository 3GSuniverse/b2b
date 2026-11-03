import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { env } from '../config/env.js';
import * as schema from '../db/schema.js';

// One shared connection pool for the whole process.
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });

export const db = drizzle(pool, { schema, casing: 'snake_case' });
export type DB = typeof db;
/** A transaction handle — accepted anywhere `db` is, so helpers work inside transactions. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

export async function checkDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase() {
  await pool.end();
}

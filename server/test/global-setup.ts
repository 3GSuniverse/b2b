import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

// Fresh schema for every test run, built from the real migration files —
// so the tests also prove the migrations work.
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://sandesh:sandesh@localhost:5432/sandesh_test';
  const pool = new pg.Pool({ connectionString: url });
  await pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  await pool.end();
}

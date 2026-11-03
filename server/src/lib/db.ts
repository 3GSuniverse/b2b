import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

// One shared Prisma client for the whole process.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const db = new PrismaClient({ adapter });

export async function checkDatabase(): Promise<boolean> {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

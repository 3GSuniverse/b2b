import 'dotenv/config';
import { z } from 'zod';

// Every setting the server needs, validated once at startup.
// A missing or malformed value stops the process with a clear message
// instead of failing later in the middle of a send.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  PUBLIC_URL: z.string().url(),
  APP_SECRET: z.string().min(16, 'APP_SECRET must be at least 16 characters'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  AWS_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  SES_CONFIGURATION_SET: z.string().default('sandesh-events'),

  SEND_RATE_PER_SECOND: z.coerce.number().positive().default(1),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  console.error(`Invalid environment configuration:\n${problems}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

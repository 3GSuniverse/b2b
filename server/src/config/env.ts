import 'dotenv/config';
import { z } from 'zod';

// Every setting the server needs, validated once at startup.
// A missing or malformed value stops the process with a clear message
// instead of failing later in the middle of a send.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  PUBLIC_URL: z.string().url(),
  // Optional: a neutral address for the links customers get (payment, quote, receipt,
  // unsubscribe), so agencies' customers never see the platform's own domain
  LINKS_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()), // an empty line in .env means not set
  APP_SECRET: z.string().min(16, 'APP_SECRET must be at least 16 characters'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  AWS_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  SES_CONFIGURATION_SET: z.string().default('drona-events'),

  SEND_RATE_PER_SECOND: z.coerce.number().positive().default(1),
  // Free trial for new companies
  TRIAL_DAYS: z.coerce.number().int().min(1).max(60).default(5),
  TRIAL_WHATSAPP_PER_DAY: z.coerce.number().int().min(0).default(100), // per number, rolling 24 hours
  TRIAL_EMAILS: z.coerce.number().int().min(0).default(200),

  // "ses" sends for real; "log" keeps emails in memory and prints them (dev/tests)
  EMAIL_PROVIDER: z.enum(['ses', 'log']).default('log'),
  // If set, SNS notifications from any other topic are rejected
  SES_SNS_TOPIC_ARN: z.string().optional(),

  // Where the dashboard lives (users are sent back here after connecting Gmail)
  APP_URL: z.string().url().optional(),
  // 32-byte key (base64) that encrypts mailbox tokens. Falls back to one derived from APP_SECRET.
  TOKEN_ENCRYPTION_KEY: z.string().optional(),

  // "Connect Gmail" — from Google Cloud → Google Auth Platform → Clients
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  // Or: path to the client_secret JSON downloaded from Google (kept on the server, never in git)
  GOOGLE_OAUTH_JSON: z.string().optional(),

  // "Draft with AI" in quotes (Anthropic's Claude). Without a key the button is hidden.
  // Either provider works; with both keys set, AI_PROVIDER picks (Anthropic otherwise)
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  AI_PROVIDER: z.enum(['anthropic', 'openai']).optional(),
  AI_MODEL: z.string().optional(), // default: claude-sonnet-5-5 or gpt-5-mini
  AI_DRAFTS_PER_DAY: z.coerce.number().int().min(0).default(40), // per company
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

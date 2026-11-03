import { Worker } from 'bullmq';
import { env } from './config/env.js';
import { db } from './lib/db.js';
import { createRedis } from './lib/redis.js';
import { QUEUES, type EmailSendJob } from './queues/index.js';

// The worker runs as its own process, separate from the API,
// so a burst of sending never slows down the dashboard.

const emailWorker = new Worker<EmailSendJob>(
  QUEUES.emailSend,
  async (job) => {
    // Implemented in the sending step: load Message, check suppression,
    // render, send through SES, store the SES MessageId.
    console.log(`[email-send] job ${job.id} for message ${job.data.messageId} (not implemented yet)`);
  },
  {
    connection: createRedis(),
    concurrency: 5,
    // Never exceed the SES sending rate, across all concurrent jobs.
    limiter: { max: env.SEND_RATE_PER_SECOND, duration: 1000 },
  },
);

emailWorker.on('failed', (job, err) => {
  console.error(`[email-send] job ${job?.id} failed: ${err.message}`);
});

console.log(`Worker started (rate limit ${env.SEND_RATE_PER_SECOND}/s)`);

async function shutdown() {
  await emailWorker.close();
  await db.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

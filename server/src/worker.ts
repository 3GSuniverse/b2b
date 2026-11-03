import { Worker } from 'bullmq';
import { env } from './config/env.js';
import { closeDatabase } from './lib/db.js';
import { logger } from './lib/logger.js';
import { closeRedis, createRedis } from './lib/redis.js';
import { runSchedulerTick } from './modules/scheduler/tick.js';
import { markMessageFailed, processSendJob } from './modules/sending/send-message.js';
import { closeQueues, getSchedulerQueue, QUEUES, type EmailSendJob } from './queues/index.js';

// The worker runs as its own process, separate from the API,
// so a burst of sending never slows down the dashboard.

const emailWorker = new Worker<EmailSendJob>(
  QUEUES.emailSend,
  async (job) => {
    const outcome = await processSendJob(job.data.messageId);
    logger.debug({ messageId: job.data.messageId, outcome }, 'email processed');
    return outcome;
  },
  {
    connection: createRedis(),
    concurrency: 5,
    // Never exceed the SES sending rate, across all concurrent jobs
    limiter: { max: env.SEND_RATE_PER_SECOND, duration: 1000 },
  },
);

emailWorker.on('failed', (job, err) => {
  if (!job) return;
  const attempts = job.opts.attempts ?? 1;
  if (job.attemptsMade >= attempts) {
    // Out of retries — record it so the campaign can still finish
    void markMessageFailed(job.data.messageId, `gave_up_after_${attempts}_attempts: ${err.message}`.slice(0, 500));
    logger.error({ messageId: job.data.messageId, err: err.message }, 'email failed permanently');
  } else {
    logger.warn({ messageId: job.data.messageId, attempt: job.attemptsMade, err: err.message }, 'email send will retry');
  }
});

const schedulerWorker = new Worker(
  QUEUES.scheduler,
  async () => {
    const result = await runSchedulerTick();
    if (result.started.length || result.failed.length) logger.info(result, 'scheduler tick');
    return result;
  },
  { connection: createRedis(), concurrency: 1 },
);

// One repeating job, every minute. Upsert = safe to run on every boot.
await getSchedulerQueue().upsertJobScheduler('every-minute', { every: 60_000 }, { name: 'tick' });

logger.info(`Worker started (send rate ${env.SEND_RATE_PER_SECOND}/s)`);

async function shutdown() {
  await Promise.allSettled([emailWorker.close(), schedulerWorker.close()]);
  await closeQueues();
  await Promise.allSettled([closeDatabase(), closeRedis()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

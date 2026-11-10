import { DelayedError, Worker } from 'bullmq';
import { env } from './config/env.js';
import { closeDatabase } from './lib/db.js';
import { logger } from './lib/logger.js';
import { closeRedis, createRedis } from './lib/redis.js';
import { runMaintenanceTick, runSchedulerTick } from './modules/scheduler/tick.js';
import { DeferSend, markMessageFailed, processSendJob } from './modules/sending/send-message.js';
import { processImport } from './modules/imports/process.js';
import { closeQueues, getSchedulerQueue, QUEUES, type EmailSendJob, type WhatsAppJob } from './queues/index.js';
import { setWhatsAppGateway } from './modules/whatsapp/gateway.js';
import { WhatsAppManager } from './modules/whatsapp/manager.js';
import { deliverWhatsApp, processWhatsAppJob } from './modules/whatsapp/service.js';
import { loadFiles } from './modules/attachments/service.js';

// The worker runs as its own process, separate from the API,
// so a burst of sending never slows down the dashboard.

const emailWorker = new Worker<EmailSendJob>(
  QUEUES.emailSend,
  async (job, token) => {
    try {
      const outcome = await processSendJob(job.data.messageId);
      logger.debug({ messageId: job.data.messageId, outcome }, 'email processed');
      return outcome;
    } catch (err) {
      if (err instanceof DeferSend) {
        // Mailbox daily limit reached — park the job until the window frees up (doesn't use a retry)
        await job.moveToDelayed(err.until.getTime(), token);
        logger.info({ messageId: job.data.messageId, until: err.until }, err.message);
        throw new DelayedError();
      }
      throw err;
    }
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
  async (job) => {
    if (job.name === 'maintenance') {
      const m = await runMaintenanceTick();
      if (m.domains.checked) logger.info(m, 'maintenance tick');
      return m;
    }
    const result = await runSchedulerTick();
    if (result.started.length || result.failed.length || result.automations?.queued) logger.info(result, 'scheduler tick');
    return result;
  },
  { connection: createRedis(), concurrency: 1 },
);

const importWorker = new Worker<{ importId: string }>(
  QUEUES.imports,
  async (job) => {
    const r = await processImport(job.data.importId);
    logger.info({ importId: job.data.importId, imported: r.imported, updated: r.updated, skipped: r.skipped }, 'import finished');
    return { imported: r.imported, updated: r.updated, skipped: r.skipped };
  },
  { connection: createRedis(), concurrency: 1 },
);

// WhatsApp Web (unofficial, interim): the worker holds each company's linked session
const whatsapp = new WhatsAppManager();
setWhatsAppGateway(whatsapp);
await whatsapp.start();

const whatsappWorker = new Worker<WhatsAppJob>(
  QUEUES.whatsappSend,
  async (job, token) => {
    if (job.data.kind === 'test') {
      const { tenantId, sessionId, to, text, attachments } = job.data;
      await deliverWhatsApp(whatsapp, sessionId, to, text, await loadFiles(tenantId, attachments ?? []));
      return 'test_sent';
    }
    const { messageId } = job.data;
    try {
      return await processWhatsAppJob(messageId, whatsapp);
    } catch (err) {
      if (err instanceof DeferSend) {
        await job.moveToDelayed(err.until.getTime(), token);
        if (err.message !== 'pacing') logger.info({ messageId, until: err.until }, err.message);
        throw new DelayedError();
      }
      throw err;
    }
  },
  // One at a time: pacing per number is enforced in processWhatsAppJob
  { connection: createRedis(), concurrency: 1 },
);
whatsappWorker.on('failed', (job, err) => {
  if (!job || job.data.kind !== 'message') return;
  if (job.attemptsMade >= (job.opts.attempts ?? 1)) void markMessageFailed(job.data.messageId, `gave_up: ${err.message}`.slice(0, 500));
});

// One repeating job, every minute. Upsert = safe to run on every boot.
await getSchedulerQueue().upsertJobScheduler('every-minute', { every: 60_000 }, { name: 'tick' });
await getSchedulerQueue().upsertJobScheduler('every-5-minutes', { every: 5 * 60_000 }, { name: 'maintenance' });

logger.info(`Worker started (send rate ${env.SEND_RATE_PER_SECOND}/s)`);

async function shutdown() {
  await Promise.allSettled([emailWorker.close(), schedulerWorker.close(), importWorker.close(), whatsappWorker.close()]);
  await whatsapp.stop();
  await closeQueues();
  await Promise.allSettled([closeDatabase(), closeRedis()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

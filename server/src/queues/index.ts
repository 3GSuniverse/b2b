import { Queue } from 'bullmq';
import { createRedis } from '../lib/redis.js';

// Queue names in one place so the API and the worker never drift apart.
export const QUEUES = {
  // One job per email to send. Retries with backoff on temporary SES errors.
  emailSend: 'email-send',
  // Repeating job every minute: picks up due scheduled campaigns and automations.
  scheduler: 'scheduler',
} as const;

export interface EmailSendJob {
  messageId: string; // Message row to send — the row holds everything else
}

const connection = createRedis();

export const emailSendQueue = new Queue<EmailSendJob>(QUEUES.emailSend, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 24 * 3600, count: 10_000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

export const schedulerQueue = new Queue(QUEUES.scheduler, { connection });

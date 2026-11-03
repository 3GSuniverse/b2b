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
  messageId: string; // the Message row holds everything else
}

export const EMAIL_SEND_ATTEMPTS = 5;

// Created on first use, so importing this file never opens a Redis connection by itself.
let emailSendQueue: Queue<EmailSendJob> | undefined;
let schedulerQueue: Queue | undefined;

export function getEmailSendQueue(): Queue<EmailSendJob> {
  emailSendQueue ??= new Queue<EmailSendJob>(QUEUES.emailSend, {
    connection: createRedis(),
    defaultJobOptions: {
      attempts: EMAIL_SEND_ATTEMPTS,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 24 * 3600, count: 10_000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return emailSendQueue;
}

export function getSchedulerQueue(): Queue {
  schedulerQueue ??= new Queue(QUEUES.scheduler, { connection: createRedis() });
  return schedulerQueue;
}

/** Puts messages on the send queue. jobId = messageId, so the same message is never queued twice. */
export async function enqueueEmails(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  await getEmailSendQueue().addBulk(
    messageIds.map((messageId) => ({ name: 'send', data: { messageId }, opts: { jobId: messageId } })),
  );
}

export type EnqueueFn = typeof enqueueEmails;

export async function closeQueues() {
  await Promise.allSettled([emailSendQueue?.close(), schedulerQueue?.close()]);
}

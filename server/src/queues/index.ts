import { Queue } from 'bullmq';
import { createRedis } from '../lib/redis.js';
import type { AttachmentRef } from '../db/schema.js';

// Queue names in one place so the API and the worker never drift apart.
export const QUEUES = {
  // One job per email to send. Retries with backoff on temporary SES errors.
  emailSend: 'email-send',
  // Repeating job every minute: picks up due scheduled campaigns and automations.
  scheduler: 'scheduler',
  // Large CSV imports, processed in the background
  imports: 'contact-import',
  // WhatsApp Web sends: one job per message, paced per linked number
  whatsappSend: 'whatsapp-send',
  // Drona AI Autopilot: answers a chat a few seconds after the customer's last message
  autopilot: 'ai-autopilot',
} as const;

export type WhatsAppJob =
  | { kind: 'message'; messageId: string }
  | { kind: 'test'; tenantId: string; sessionId: string; to: string; text: string; attachments?: AttachmentRef[] };

export interface EmailSendJob {
  messageId: string; // the Message row holds everything else
}

export const EMAIL_SEND_ATTEMPTS = 5;

// Created on first use, so importing this file never opens a Redis connection by itself.
let emailSendQueue: Queue<EmailSendJob> | undefined;
let schedulerQueue: Queue | undefined;
let importQueue: Queue<{ importId: string }> | undefined;
let whatsappQueue: Queue<WhatsAppJob> | undefined;
let autopilotQueue: Queue<{ chatId: string; at: number }> | undefined;

/** Queues an Autopilot answer. Every new customer message adds a job; only the newest one answers. */
export async function enqueueAutopilot(chatId: string, at: Date, waitMs: number) {
  autopilotQueue ??= new Queue(QUEUES.autopilot, {
    connection: createRedis(),
    defaultJobOptions: { attempts: 2, backoff: { type: 'fixed', delay: 20_000 }, removeOnComplete: { age: 3600, count: 5000 }, removeOnFail: { age: 3 * 86_400 } },
  });
  await autopilotQueue.add('answer', { chatId, at: at.getTime() }, { jobId: `${chatId}-${at.getTime()}`, delay: waitMs });
}

export function getWhatsAppQueue(): Queue<WhatsAppJob> {
  whatsappQueue ??= new Queue<WhatsAppJob>(QUEUES.whatsappSend, {
    connection: createRedis(),
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { age: 24 * 3600, count: 10_000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return whatsappQueue;
}

/**
 * Bulk sends (broadcasts, reminders) wait behind replies to customers: BullMQ runs jobs without a
 * priority first, so replies go without one and everything else gets a low priority.
 */
export async function enqueueWhatsApp(messageIds: string[], opts: { urgent?: boolean } = {}): Promise<void> {
  if (messageIds.length === 0) return;
  await getWhatsAppQueue().addBulk(
    messageIds.map((messageId) => ({ name: 'send', data: { kind: 'message' as const, messageId }, opts: { jobId: messageId, ...(opts.urgent ? {} : { priority: 10 }) } })),
  );
}

export async function enqueueWhatsAppTest(tenantId: string, sessionId: string, to: string, text: string, attachments: AttachmentRef[] = []) {
  await getWhatsAppQueue().add('test', { kind: 'test', tenantId, sessionId, to, text, attachments }, { attempts: 1 });
}

export function getImportQueue(): Queue<{ importId: string }> {
  importQueue ??= new Queue(QUEUES.imports, {
    connection: createRedis(),
    defaultJobOptions: { attempts: 2, backoff: { type: 'fixed', delay: 10_000 }, removeOnComplete: { age: 86_400 } },
  });
  return importQueue;
}

export async function enqueueImport(importId: string) {
  await getImportQueue().add('import', { importId }, { jobId: importId });
}

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
  await Promise.allSettled([emailSendQueue?.close(), schedulerQueue?.close(), importQueue?.close(), whatsappQueue?.close(), autopilotQueue?.close()]);
}

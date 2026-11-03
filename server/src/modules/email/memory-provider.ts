import { createId } from '@paralleldrive/cuid2';
import type { EmailProvider, OutgoingEmail } from './types.js';

/**
 * Keeps sent emails in memory instead of sending them.
 * Used in development (EMAIL_PROVIDER=log) and in tests.
 */
export class MemoryEmailProvider implements EmailProvider {
  readonly name = 'memory';
  readonly outbox: (OutgoingEmail & { providerMessageId: string })[] = [];
  private failures: Error[] = [];

  constructor(private readonly log = false) {}

  /** Make the next send throw this error (tests). */
  failNext(err: Error) {
    this.failures.push(err);
  }

  async send(email: OutgoingEmail) {
    const failure = this.failures.shift();
    if (failure) throw failure;
    const providerMessageId = `mem-${createId()}`;
    this.outbox.push({ ...email, providerMessageId });
    if (this.log) {
      console.log(`[email] → ${email.to} | ${email.subject} (${providerMessageId})`);
    }
    return { providerMessageId };
  }

  clear() {
    this.outbox.length = 0;
    this.failures = [];
  }
}

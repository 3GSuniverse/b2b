export interface OutgoingEmail {
  from: { name: string; email: string };
  replyTo?: string | null;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Extra headers, e.g. List-Unsubscribe */
  headers: Record<string, string>;
  /** Echoed back in SES events — lets the webhook find the message even before we store the SES id */
  tags: Record<string, string>;
  /** Files sent with the email (brochure, itinerary, photos) */
  attachments?: { name: string; type: string; data: Buffer }[];
}

export interface EmailProvider {
  readonly name: string;
  send(email: OutgoingEmail): Promise<{ providerMessageId: string }>;
}

/**
 * A failed send.
 * - permanent: retrying will never work (bad address, unverified sender) → mark FAILED now.
 * - transient: throttling, network, 5xx → let the queue retry with backoff.
 */
export class SendError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'SendError';
  }
}

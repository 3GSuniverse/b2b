/**
 * How messages leave through a company's linked WhatsApp number.
 * The real implementation (Baileys, WhatsApp Web) lives in the worker process;
 * tests use the in-memory one.
 */
export type WhatsAppMedia = {
  kind: 'image' | 'video' | 'audio' | 'document';
  data: Buffer;
  mimeType: string;
  fileName: string;
  caption?: string;
};

export interface WhatsAppGateway {
  sendText(sessionId: string, phoneE164: string, text: string): Promise<{ id: string }>;
  /** A photo, video, audio clip or document, with an optional caption. */
  sendMedia(sessionId: string, phoneE164: string, media: WhatsAppMedia): Promise<{ id: string }>;
  /** Whether this number has a WhatsApp account. */
  exists(sessionId: string, phoneE164: string): Promise<boolean>;
}

export class WhatsAppError extends Error {
  constructor(
    message: string,
    /** Permanent errors fail the message; others are retried. */
    readonly permanent: boolean,
    readonly code = 'whatsapp_error',
  ) {
    super(message);
    this.name = 'WhatsAppError';
  }
}

let current: WhatsAppGateway | undefined;
export function setWhatsAppGateway(g: WhatsAppGateway | undefined) {
  current = g;
}
export function getWhatsAppGateway(): WhatsAppGateway {
  if (!current) throw new WhatsAppError('WhatsApp isn’t running in this process', false, 'no_gateway');
  return current;
}

/** +919848022338 → 919848022338@s.whatsapp.net */
export const toJid = (phoneE164: string) => `${phoneE164.replace(/\D/g, '')}@s.whatsapp.net`;
/** 919848022338@s.whatsapp.net (or …:12@s.whatsapp.net) → +919848022338 */
export const fromJid = (jid: string) => `+${jid.split('@')[0]!.split(':')[0]}`;

/** For tests: records what would have been sent. */
export class MemoryWhatsAppGateway implements WhatsAppGateway {
  sent: { sessionId: string; to: string; text: string; id: string; media?: Omit<WhatsAppMedia, 'data'> & { size: number } }[] = [];
  notOnWhatsApp = new Set<string>();
  failNext: WhatsAppError | null = null;
  async sendText(sessionId: string, to: string, text: string) {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    const id = `wamid-${this.sent.length + 1}-${Math.random().toString(36).slice(2, 8)}`;
    this.sent.push({ sessionId, to, text, id });
    return { id };
  }
  async sendMedia(sessionId: string, to: string, media: WhatsAppMedia) {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    const id = `wamid-${this.sent.length + 1}-${Math.random().toString(36).slice(2, 8)}`;
    const { data, ...rest } = media;
    this.sent.push({ sessionId, to, text: media.caption ?? '', id, media: { ...rest, size: data.length } });
    return { id };
  }
  async exists(_sessionId: string, phone: string) {
    return !this.notOnWhatsApp.has(phone);
  }
}

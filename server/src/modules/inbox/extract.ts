import type { proto } from 'baileys';

/** The words and the kind of attachment in a WhatsApp message, whatever wrapper it came in. */
export function extractContent(message: proto.IMessage | null | undefined): { text: string | null; mediaKind: string | null; mediaName: string | null } | null {
  let m = message ?? null;
  // Disappearing, view-once and captioned-document messages wrap the real one
  for (let i = 0; i < 4 && m; i++) {
    const inner =
      m.ephemeralMessage?.message ??
      m.viewOnceMessage?.message ??
      m.viewOnceMessageV2?.message ??
      m.viewOnceMessageV2Extension?.message ??
      m.documentWithCaptionMessage?.message ??
      m.editedMessage?.message;
    if (!inner) break;
    m = inner;
  }
  if (!m) return null;
  if (m.protocolMessage || m.reactionMessage || m.senderKeyDistributionMessage && Object.keys(m).length === 1) return null;
  if (m.conversation) return { text: m.conversation, mediaKind: null, mediaName: null };
  if (m.extendedTextMessage?.text) return { text: m.extendedTextMessage.text, mediaKind: null, mediaName: null };
  if (m.imageMessage) return { text: m.imageMessage.caption || null, mediaKind: 'image', mediaName: null };
  if (m.videoMessage) return { text: m.videoMessage.caption || null, mediaKind: 'video', mediaName: null };
  if (m.documentMessage) return { text: m.documentMessage.caption || null, mediaKind: 'document', mediaName: m.documentMessage.fileName || m.documentMessage.title || null };
  if (m.audioMessage) return { text: null, mediaKind: 'audio', mediaName: null };
  if (m.stickerMessage) return { text: null, mediaKind: 'sticker', mediaName: null };
  if (m.locationMessage || m.liveLocationMessage) {
    const l = m.locationMessage ?? m.liveLocationMessage;
    return { text: l?.degreesLatitude != null ? `https://maps.google.com/?q=${l.degreesLatitude},${l.degreesLongitude}` : null, mediaKind: 'location', mediaName: m.locationMessage?.name ?? null };
  }
  if (m.contactMessage || m.contactsArrayMessage) return { text: null, mediaKind: 'contact', mediaName: m.contactMessage?.displayName ?? null };
  if (m.buttonsResponseMessage?.selectedDisplayText) return { text: m.buttonsResponseMessage.selectedDisplayText, mediaKind: null, mediaName: null };
  if (m.listResponseMessage?.title) return { text: m.listResponseMessage.title, mediaKind: null, mediaName: null };
  return null;
}

/** WhatsApp sends timestamps in seconds, sometimes as a Long. */
export function messageTime(ts: unknown, fallback = new Date()): Date {
  const n = typeof ts === 'number' ? ts : typeof ts === 'object' && ts !== null && 'toNumber' in ts ? (ts as { toNumber(): number }).toNumber() : Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : fallback;
}

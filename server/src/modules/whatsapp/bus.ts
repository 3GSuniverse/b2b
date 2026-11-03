import { createRedis, getRedis } from '../../lib/redis.js';

// The API never holds the WhatsApp connection — the worker does. They talk through Redis:
//  - commands (connect / disconnect) go API → worker over pub/sub
//  - the current QR code goes worker → API as a short-lived key
const CHANNEL = 'whatsapp:commands';
const qrKey = (tenantId: string) => `whatsapp:qr:${tenantId}`;

export type WhatsAppCommand = { action: 'connect' | 'disconnect'; tenantId: string };

export async function publishCommand(cmd: WhatsAppCommand) {
  await getRedis().publish(CHANNEL, JSON.stringify(cmd));
}

export async function subscribeCommands(handler: (cmd: WhatsAppCommand) => void) {
  const sub = createRedis();
  await sub.subscribe(CHANNEL);
  sub.on('message', (_ch, raw) => {
    try {
      handler(JSON.parse(raw) as WhatsAppCommand);
    } catch {
      /* ignore malformed */
    }
  });
  return () => sub.quit();
}

/** WhatsApp rotates the QR about every 20 seconds; keep each one a little longer than that. */
export async function setQr(tenantId: string, qr: string | null) {
  if (qr) await getRedis().set(qrKey(tenantId), qr, 'EX', 60);
  else await getRedis().del(qrKey(tenantId));
}
export async function getQr(tenantId: string) {
  return getRedis().get(qrKey(tenantId));
}

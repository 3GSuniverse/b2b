import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { campaigns, mailboxConnections, senders, sendingDomains } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { isDomainReady } from '../domains/service.js';

export const createSenderBody = z.object({
  domainId: z.string().min(1, 'Choose a domain'),
  fromName: z
    .string()
    .trim()
    .min(1, 'Enter the name people will see')
    .max(80)
    .refine((v) => !/[\r\n<>"]/.test(v), 'The name can’t contain < > " or line breaks'),
  fromEmail: z.string().trim().toLowerCase().pipe(z.email({ message: 'Enter a valid email address' })),
  replyTo: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ message: 'Enter a valid reply-to address' }))
    .optional()
    .or(z.literal('').transform(() => undefined)),
  isDefault: z.boolean().optional(),
});

export const updateSenderBody = createSenderBody.pick({ fromName: true, replyTo: true, isDefault: true }).partial();

type SenderRow = typeof senders.$inferSelect & {
  domain: typeof sendingDomains.$inferSelect | null;
  connection: typeof mailboxConnections.$inferSelect | null;
};

function senderDto(s: SenderRow) {
  return {
    id: s.id,
    kind: s.kind,
    fromName: s.fromName,
    fromEmail: s.fromEmail,
    replyTo: s.replyTo,
    isDefault: s.isDefault,
    domain: s.domain ? { id: s.domain.id, domain: s.domain.domain } : null,
    mailbox: s.connection ? { id: s.connection.id, status: s.connection.status, dailyLimit: s.connection.dailyLimit } : null,
    // Domain senders: domain must be verified. Mailbox senders: mailbox must still be connected.
    readyToSend: s.kind === 'DOMAIN' ? !!s.domain && isDomainReady(s.domain) : s.connection?.status === 'ACTIVE',
    createdAt: s.createdAt,
  };
}

async function getOwned(tenantId: string, id: string) {
  const s = await db.query.senders.findFirst({
    where: and(eq(senders.id, id), eq(senders.tenantId, tenantId)),
    with: { domain: true, connection: true },
  });
  if (!s) throw new AppError(404, 'sender_not_found', 'Sender not found');
  return s;
}

export async function listSenders(tenantId: string) {
  const rows = await db.query.senders.findMany({
    where: eq(senders.tenantId, tenantId),
    with: { domain: true, connection: true },
    orderBy: [asc(senders.createdAt)],
  });
  return rows.map(senderDto);
}

export async function createSender(tenantId: string, input: z.infer<typeof createSenderBody>) {
  const domain = await db.query.sendingDomains.findFirst({
    where: and(eq(sendingDomains.id, input.domainId), eq(sendingDomains.tenantId, tenantId)),
  });
  if (!domain) throw new AppError(404, 'domain_not_found', 'Domain not found');

  const at = input.fromEmail.lastIndexOf('@');
  if (input.fromEmail.slice(at + 1) !== domain.domain) {
    throw new AppError(400, 'validation_failed', `The from address must end with @${domain.domain}`, {
      fields: { fromEmail: `Use an address at @${domain.domain}` },
    });
  }

  const existing = await db.query.senders.findFirst({
    where: and(eq(senders.tenantId, tenantId), eq(senders.fromEmail, input.fromEmail)),
    columns: { id: true },
  });
  if (existing) throw new AppError(409, 'sender_exists', 'This from address already exists');

  const id = await db.transaction(async (tx) => {
    const hasAny = await tx.query.senders.findFirst({ where: eq(senders.tenantId, tenantId), columns: { id: true } });
    const makeDefault = input.isDefault || !hasAny; // the first sender is the default
    if (makeDefault) await tx.update(senders).set({ isDefault: false }).where(eq(senders.tenantId, tenantId));
    const [row] = await tx
      .insert(senders)
      .values({
        tenantId,
        kind: 'DOMAIN',
        domainId: domain.id,
        fromName: input.fromName,
        fromEmail: input.fromEmail,
        replyTo: input.replyTo ?? null,
        isDefault: makeDefault,
      })
      .returning({ id: senders.id });
    return row!.id;
  });
  return senderDto(await getOwned(tenantId, id));
}

export async function updateSender(tenantId: string, id: string, input: z.infer<typeof updateSenderBody>) {
  await getOwned(tenantId, id);
  await db.transaction(async (tx) => {
    if (input.isDefault) {
      await tx.update(senders).set({ isDefault: false }).where(and(eq(senders.tenantId, tenantId), ne(senders.id, id)));
    }
    await tx
      .update(senders)
      .set({
        ...(input.fromName !== undefined ? { fromName: input.fromName } : {}),
        ...(input.replyTo !== undefined ? { replyTo: input.replyTo ?? null } : {}),
        ...(input.isDefault ? { isDefault: true } : {}),
      })
      .where(eq(senders.id, id));
  });
  return senderDto(await getOwned(tenantId, id));
}

export async function deleteSender(tenantId: string, id: string) {
  await getOwned(tenantId, id);
  const busy = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.senderId, id), inArray(campaigns.status, ['SCHEDULED', 'SENDING'])))
    .limit(1);
  if (busy.length) throw new AppError(409, 'sender_in_use', 'A scheduled or sending campaign uses this sender');
  await db.delete(senders).where(eq(senders.id, id));
}

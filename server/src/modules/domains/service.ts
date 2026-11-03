import { and, desc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import { campaigns, senders, sendingDomains, type SendingDomain } from '../../db/schema.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { buildDnsRecords, checkDnsRecords, getDnsLookup, type DnsLookup, type DnsRecord } from './dns.js';
import { getIdentityProvider, type IdentityProvider } from './identity-provider.js';
import { normalizeDomain } from './validate.js';
import { notify } from '../notifications/service.js';

interface Deps {
  identity?: IdentityProvider;
  dns?: DnsLookup;
}

/** Ready to send = this company proved ownership AND SES verified the domain AND DKIM is live. */
export function isDomainReady(d: Pick<SendingDomain, 'ownershipStatus' | 'identityStatus' | 'dkimStatus'>) {
  return d.ownershipStatus === 'VERIFIED' && d.identityStatus === 'VERIFIED' && d.dkimStatus === 'VERIFIED';
}

export function domainDto(d: SendingDomain) {
  const ready = isDomainReady(d);
  const failed = [d.dkimStatus, d.identityStatus].includes('FAILED');
  return {
    id: d.id,
    domain: d.domain,
    mailFromDomain: d.mailFromDomain,
    status: ready ? 'verified' : failed ? 'failed' : 'pending',
    readyToSend: ready,
    checks: {
      ownership: d.ownershipStatus,
      domain: d.identityStatus,
      dkim: d.dkimStatus,
      mailFrom: d.mailFromStatus,
    },
    records: (d.dnsRecords as DnsRecord[] | null) ?? [],
    verifiedAt: d.verifiedAt,
    lastCheckedAt: d.lastCheckedAt,
    createdAt: d.createdAt,
  };
}

async function getOwned(tenantId: string, id: string) {
  const d = await db.query.sendingDomains.findFirst({
    where: and(eq(sendingDomains.id, id), eq(sendingDomains.tenantId, tenantId)),
  });
  if (!d) throw new AppError(404, 'domain_not_found', 'Domain not found');
  return d;
}

export async function listDomains(tenantId: string) {
  const rows = await db
    .select()
    .from(sendingDomains)
    .where(eq(sendingDomains.tenantId, tenantId))
    .orderBy(desc(sendingDomains.createdAt));
  return rows.map(domainDto);
}

export async function getDomain(tenantId: string, id: string) {
  return domainDto(await getOwned(tenantId, id));
}

/**
 * Connects a domain to the company: registers it with SES and returns the DNS records to add.
 * Adding the same domain twice in the same company is harmless.
 */
export async function addDomain(tenantId: string, rawDomain: string, deps: Deps = {}) {
  const identity = deps.identity ?? getIdentityProvider();
  const domain = normalizeDomain(rawDomain);

  const existing = await db.query.sendingDomains.findFirst({ where: eq(sendingDomains.domain, domain) });
  if (existing) {
    if (existing.tenantId === tenantId) return domainDto(existing);
    // Never say which company has it
    throw new AppError(409, 'domain_taken', 'This domain is already connected to another account. If it’s yours, contact support.');
  }

  let row: SendingDomain;
  try {
    [row] = (await db
      .insert(sendingDomains)
      .values({ tenantId, domain, mailFromDomain: `mail.${domain}` })
      .returning()) as [SendingDomain];
  } catch (err) {
    if ((err as { cause?: { code?: string }; code?: string }).cause?.code === '23505' || (err as { code?: string }).code === '23505') {
      throw new AppError(409, 'domain_taken', 'This domain is already connected to another account. If it’s yours, contact support.');
    }
    throw err;
  }

  try {
    const state = await identity.createDomain(domain, row.mailFromDomain!);
    const records = buildDnsRecords({
      domain,
      mailFromDomain: row.mailFromDomain!,
      ownershipToken: row.ownershipToken,
      dkimTokens: state.dkimTokens,
      region: identity.region,
    });
    const [updated] = await db
      .update(sendingDomains)
      .set({
        dnsRecords: records,
        identityStatus: state.verified ? 'VERIFIED' : 'PENDING',
        dkimStatus: state.dkim,
        mailFromStatus: state.mailFrom,
      })
      .where(eq(sendingDomains.id, row.id))
      .returning();
    return domainDto(updated!);
  } catch (err) {
    // Don't leave a half-registered domain blocking a retry
    await db.delete(sendingDomains).where(eq(sendingDomains.id, row.id));
    if (err instanceof AppError) throw err;
    throw new AppError(502, 'provider_error', 'We couldn’t register this domain with our email service. Please try again in a minute.');
  }
}

/** Re-checks DNS and SES status. Called by the "Check now" button and by the background scheduler. */
export async function refreshDomain(tenantId: string, id: string, deps: Deps = {}) {
  const identity = deps.identity ?? getIdentityProvider();
  const dns = deps.dns ?? getDnsLookup();
  const d = await getOwned(tenantId, id);

  // Recreated if someone removed it from SES by hand
  const state = (await identity.getDomain(d.domain)) ?? (await identity.createDomain(d.domain, d.mailFromDomain!));
  const records = await checkDnsRecords(
    buildDnsRecords({
      domain: d.domain,
      mailFromDomain: d.mailFromDomain!,
      ownershipToken: d.ownershipToken,
      dkimTokens: state.dkimTokens,
      region: identity.region,
    }),
    dns,
  );

  const ownershipFound = records.find((r) => r.purpose === 'ownership')?.found ?? false;
  const next = {
    // Once proven, ownership stays proven (removing the TXT later shouldn't break live sending)
    ownershipStatus: d.ownershipStatus === 'VERIFIED' || ownershipFound ? ('VERIFIED' as const) : ('PENDING' as const),
    identityStatus: state.verified ? ('VERIFIED' as const) : state.dkim === 'FAILED' ? ('FAILED' as const) : ('PENDING' as const),
    dkimStatus: state.dkim,
    mailFromStatus: state.mailFrom,
  };
  const ready = isDomainReady(next);

  const [updated] = await db
    .update(sendingDomains)
    .set({
      ...next,
      dnsRecords: records,
      lastCheckedAt: new Date(),
      verifiedAt: ready ? (d.verifiedAt ?? new Date()) : d.verifiedAt,
    })
    .where(eq(sendingDomains.id, d.id))
    .returning();
  if (ready && !d.verifiedAt) {
    await notify(tenantId, {
      type: 'domain.verified',
      level: 'SUCCESS',
      title: `${d.domain} is verified`,
      body: `You can now send from any address @${d.domain}.`,
      link: '/settings/senders',
      dedupeKey: `domain.verified:${d.id}`,
    });
  }
  return domainDto(updated!);
}

/** Background: keep checking domains that are still being set up (first 7 days, every 5 minutes). */
export async function refreshPendingDomains(opts: Deps & { now?: Date; limit?: number } = {}) {
  const now = opts.now ?? new Date();
  const rows = await db
    .select({ id: sendingDomains.id, tenantId: sendingDomains.tenantId })
    .from(sendingDomains)
    .where(
      and(
        isNull(sendingDomains.verifiedAt),
        gt(sendingDomains.createdAt, new Date(now.getTime() - 7 * 86_400_000)),
        or(isNull(sendingDomains.lastCheckedAt), lt(sendingDomains.lastCheckedAt, new Date(now.getTime() - 5 * 60_000))),
      ),
    )
    .limit(opts.limit ?? 10);
  let verified = 0;
  for (const r of rows) {
    try {
      const dto = await refreshDomain(r.tenantId, r.id, opts);
      if (dto.readyToSend) verified++;
    } catch {
      // One bad domain must not stop the others; it is retried next round
    }
  }
  return { checked: rows.length, verified };
}

export async function deleteDomain(tenantId: string, id: string, deps: Deps = {}) {
  const identity = deps.identity ?? getIdentityProvider();
  const d = await getOwned(tenantId, id);

  const busy = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .innerJoin(senders, eq(campaigns.senderId, senders.id))
    .where(and(eq(senders.domainId, d.id), inArray(campaigns.status, ['SCHEDULED', 'SENDING'])))
    .limit(1);
  if (busy.length) {
    throw new AppError(409, 'domain_in_use', 'A scheduled or sending campaign uses this domain. Cancel it first.');
  }

  await identity.deleteDomain(d.domain);
  await db.delete(sendingDomains).where(eq(sendingDomains.id, d.id));
}

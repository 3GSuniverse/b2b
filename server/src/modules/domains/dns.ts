import { Resolver } from 'node:dns/promises';

export type RecordPurpose = 'ownership' | 'dkim' | 'mail_from_mx' | 'mail_from_spf' | 'dmarc';

/** One DNS record the company has to add — shown in the onboarding screen with copy buttons. */
export interface DnsRecord {
  purpose: RecordPurpose;
  type: 'TXT' | 'CNAME' | 'MX';
  name: string; // full host name, e.g. abc1._domainkey.abcholidays.com
  value: string;
  priority?: number;
  required: boolean;
  found?: boolean; // filled in by the last DNS check
}

/** The minimal DNS lookups we need — swappable in tests. */
export interface DnsLookup {
  txt(name: string): Promise<string[]>;
  cname(name: string): Promise<string[]>;
  mx(name: string): Promise<{ exchange: string; priority: number }[]>;
}

const NOT_FOUND = new Set(['ENODATA', 'ENOTFOUND', 'ESERVFAIL', 'ETIMEOUT', 'ECONNREFUSED', 'EREFUSED']);

async function safe<T>(p: Promise<T>, empty: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (NOT_FOUND.has((err as { code?: string }).code ?? '')) return empty;
    throw err;
  }
}

export function createDnsLookup(): DnsLookup {
  // Ask public resolvers directly, so a stale local cache never hides a record the user just added
  const r = new Resolver({ timeout: 4000, tries: 2 });
  r.setServers(['1.1.1.1', '8.8.8.8']);
  return {
    txt: async (n) => (await safe(r.resolveTxt(n), [] as string[][])).map((parts) => parts.join('')),
    cname: (n) => safe(r.resolveCname(n), []),
    mx: (n) => safe(r.resolveMx(n), []),
  };
}

let current: DnsLookup | undefined;
export function getDnsLookup(): DnsLookup {
  current ??= createDnsLookup();
  return current;
}
export function setDnsLookup(l: DnsLookup) {
  current = l;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\.$/, '');

export const ownershipHost = (domain: string) => `_sandesh.${domain}`;

export function buildDnsRecords(input: {
  domain: string;
  mailFromDomain: string;
  ownershipToken: string;
  dkimTokens: string[];
  region: string;
}): DnsRecord[] {
  return [
    { purpose: 'ownership', type: 'TXT', name: ownershipHost(input.domain), value: input.ownershipToken, required: true },
    ...input.dkimTokens.map(
      (t): DnsRecord => ({
        purpose: 'dkim',
        type: 'CNAME',
        name: `${t}._domainkey.${input.domain}`,
        value: `${t}.dkim.amazonses.com`,
        required: true,
      }),
    ),
    {
      purpose: 'mail_from_mx',
      type: 'MX',
      name: input.mailFromDomain,
      value: `feedback-smtp.${input.region}.amazonses.com`,
      priority: 10,
      required: true,
    },
    { purpose: 'mail_from_spf', type: 'TXT', name: input.mailFromDomain, value: 'v=spf1 include:amazonses.com ~all', required: true },
    // Recommended, not required — if the company already has a DMARC record we leave it alone
    { purpose: 'dmarc', type: 'TXT', name: `_dmarc.${input.domain}`, value: 'v=DMARC1; p=none;', required: false },
  ];
}

/** Looks up every record and marks which ones are live. */
export async function checkDnsRecords(records: DnsRecord[], dns: DnsLookup): Promise<DnsRecord[]> {
  return Promise.all(
    records.map(async (r) => {
      let found = false;
      if (r.type === 'CNAME') {
        found = (await dns.cname(r.name)).some((v) => norm(v) === norm(r.value));
      } else if (r.type === 'MX') {
        found = (await dns.mx(r.name)).some((m) => norm(m.exchange) === norm(r.value));
      } else if (r.purpose === 'dmarc') {
        found = (await dns.txt(r.name)).some((v) => v.trim().toLowerCase().startsWith('v=dmarc1')); // any DMARC counts
      } else if (r.purpose === 'mail_from_spf') {
        found = (await dns.txt(r.name)).some((v) => /^v=spf1\b/i.test(v.trim()) && /include:amazonses\.com/i.test(v));
      } else {
        found = (await dns.txt(r.name)).some((v) => v.trim() === r.value);
      }
      return { ...r, found };
    }),
  );
}

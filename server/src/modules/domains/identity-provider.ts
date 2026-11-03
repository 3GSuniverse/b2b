import {
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  GetEmailIdentityCommand,
  PutEmailIdentityMailFromAttributesCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2';
import { env } from '../../config/env.js';

export type ProviderStatus = 'PENDING' | 'VERIFIED' | 'FAILED';

export interface DomainIdentityState {
  dkimTokens: string[];
  verified: boolean; // SES says the domain can send
  dkim: ProviderStatus;
  mailFrom: ProviderStatus;
}

/** Registers sending domains with the email provider (SES) and reports their status. */
export interface IdentityProvider {
  readonly region: string;
  createDomain(domain: string, mailFromDomain: string): Promise<DomainIdentityState>;
  getDomain(domain: string): Promise<DomainIdentityState | null>;
  deleteDomain(domain: string): Promise<void>;
}

function mapStatus(s: string | undefined): ProviderStatus {
  if (s === 'SUCCESS') return 'VERIFIED';
  if (s === 'FAILED') return 'FAILED';
  return 'PENDING'; // PENDING, TEMPORARY_FAILURE, NOT_STARTED
}

export function createSesIdentityProvider(): IdentityProvider {
  const { AWS_ACCESS_KEY_ID: id, AWS_SECRET_ACCESS_KEY: secret } = env;
  const client = new SESv2Client({
    region: env.AWS_REGION,
    credentials: id && secret ? { accessKeyId: id, secretAccessKey: secret } : undefined,
  });

  const provider: IdentityProvider = {
    region: env.AWS_REGION,

    async createDomain(domain, mailFromDomain) {
      try {
        await client.send(
          new CreateEmailIdentityCommand({
            EmailIdentity: domain,
            DkimSigningAttributes: { NextSigningKeyLength: 'RSA_2048_BIT' },
            ConfigurationSetName: env.SES_CONFIGURATION_SET || undefined,
          }),
        );
      } catch (err) {
        // Already registered in our SES account (e.g. set up by hand earlier) — reuse it.
        // Ownership of the domain is still proven separately by the tenant's TXT record.
        if ((err as { name?: string }).name !== 'AlreadyExistsException') throw err;
      }
      await client.send(
        new PutEmailIdentityMailFromAttributesCommand({
          EmailIdentity: domain,
          MailFromDomain: mailFromDomain,
          BehaviorOnMxFailure: 'USE_DEFAULT_VALUE',
        }),
      );
      const state = await provider.getDomain(domain);
      if (!state) throw new Error('Domain was created but SES cannot find it');
      return state;
    },

    async getDomain(domain) {
      try {
        const out = await client.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
        return {
          dkimTokens: out.DkimAttributes?.Tokens ?? [],
          verified: !!out.VerifiedForSendingStatus,
          dkim: mapStatus(out.DkimAttributes?.Status),
          mailFrom: mapStatus(out.MailFromAttributes?.MailFromDomainStatus),
        };
      } catch (err) {
        if ((err as { name?: string }).name === 'NotFoundException') return null;
        throw err;
      }
    },

    async deleteDomain(domain) {
      try {
        await client.send(new DeleteEmailIdentityCommand({ EmailIdentity: domain }));
      } catch (err) {
        if ((err as { name?: string }).name !== 'NotFoundException') throw err;
      }
    },
  };
  return provider;
}

/** In-memory SES stand-in for development and tests. */
export class MemoryIdentityProvider implements IdentityProvider {
  readonly region = 'ap-south-1';
  readonly domains = new Map<string, DomainIdentityState>();

  async createDomain(domain: string) {
    let s = this.domains.get(domain);
    if (!s) {
      const tok = domain.replace(/[^a-z0-9]/g, '').slice(0, 10);
      s = { dkimTokens: [`${tok}dk1`, `${tok}dk2`, `${tok}dk3`], verified: false, dkim: 'PENDING', mailFrom: 'PENDING' };
      this.domains.set(domain, s);
    }
    return { ...s };
  }
  async getDomain(domain: string) {
    const s = this.domains.get(domain);
    return s ? { ...s } : null;
  }
  async deleteDomain(domain: string) {
    this.domains.delete(domain);
  }
  /** Simulate SES finding the DNS records. */
  markVerified(domain: string, mailFrom = true) {
    const s = this.domains.get(domain);
    if (s) Object.assign(s, { verified: true, dkim: 'VERIFIED', mailFrom: mailFrom ? 'VERIFIED' : 'PENDING' });
  }
}

let current: IdentityProvider | undefined;
export function getIdentityProvider(): IdentityProvider {
  current ??= env.EMAIL_PROVIDER === 'ses' ? createSesIdentityProvider() : new MemoryIdentityProvider();
  return current;
}
export function setIdentityProvider(p: IdentityProvider) {
  current = p;
}

import { env } from '../../config/env.js';
import { MemoryEmailProvider } from './memory-provider.js';
import { createSesProvider } from './ses-provider.js';
import type { EmailProvider } from './types.js';

let provider: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (!provider) {
    if (env.EMAIL_PROVIDER === 'ses') {
      const { AWS_ACCESS_KEY_ID: id, AWS_SECRET_ACCESS_KEY: secret } = env;
      provider = createSesProvider({
        region: env.AWS_REGION,
        configurationSet: env.SES_CONFIGURATION_SET || undefined,
        // Without explicit keys the SDK falls back to its normal credential chain
        credentials: id && secret ? { accessKeyId: id, secretAccessKey: secret } : undefined,
      });
    } else {
      provider = new MemoryEmailProvider(env.NODE_ENV !== 'test');
    }
  }
  return provider;
}

/** Swap the provider (tests). */
export function setEmailProvider(p: EmailProvider) {
  provider = p;
}

export * from './types.js';

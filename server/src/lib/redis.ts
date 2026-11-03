import { Redis } from 'ioredis';
import { env } from '../config/env.js';

const opened = new Set<Redis>();

// BullMQ requires maxRetriesPerRequest: null on its connections.
export function createRedis(): Redis {
  const r = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  opened.add(r);
  r.once('end', () => opened.delete(r));
  return r;
}

let shared: Redis | undefined;

/** Shared connection for simple commands (health checks, rate counters). Opened on first use. */
export function getRedis(): Redis {
  shared ??= createRedis();
  return shared;
}

export async function checkRedis(): Promise<boolean> {
  try {
    return (await getRedis().ping()) === 'PONG';
  } catch {
    return false;
  }
}

/** Closes every connection this process opened, so shutdown never hangs. */
export async function closeRedis() {
  await Promise.allSettled([...opened].map((r) => r.quit()));
  opened.clear();
  shared = undefined;
}

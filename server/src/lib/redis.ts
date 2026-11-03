import { Redis } from 'ioredis';
import { env } from '../config/env.js';

// BullMQ requires maxRetriesPerRequest: null on its connections.
export function createRedis(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export const redis = createRedis();

export async function checkRedis(): Promise<boolean> {
  try {
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}

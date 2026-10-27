import { Redis } from 'ioredis';

const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

/**
 * Creates a new Redis connection configured the way BullMQ requires.
 * `maxRetriesPerRequest: null` is mandatory for BullMQ workers and QueueEvents
 * because they use blocking commands.
 *
 * Queue, Worker and QueueEvents each get their own connection (BullMQ
 * recommendation), so this is a factory rather than a singleton.
 */
export function createRedisConnection() {
  const url = process.env.REDIS_URL || DEFAULT_REDIS_URL;

  const connection = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectTimeout: 10000,
  });

  connection.on('error', (err) => {
    console.error('[redis] error:', err.message);
  });

  return connection;
}

/**
 * Fails fast (instead of retrying forever) when Redis is unreachable at boot.
 */
export async function assertRedisReachable(connection, timeoutMs = 8000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Redis not reachable at ${process.env.REDIS_URL || DEFAULT_REDIS_URL}`)),
      timeoutMs
    );
  });

  try {
    await Promise.race([connection.ping(), timeout]);
    console.log('[redis] connected');
  } finally {
    clearTimeout(timer);
  }
}

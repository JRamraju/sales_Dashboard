import { Redis } from 'ioredis';

const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

/** While Redis stays unreachable, the console gets one reminder per this interval. */
export const REMINDER_INTERVAL_MS = 30_000;

/** The URL with its password hidden, safe to print in logs and error messages. */
export function redactedRedisUrl(raw = process.env.REDIS_URL || DEFAULT_REDIS_URL) {
  try {
    const url = new URL(raw);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return 'the configured REDIS_URL';
  }
}

const CONNECTION_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

const CONNECTION_ERROR_MESSAGE =
  /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|Connection is closed|Connection timeout|Stream isn't writeable/i;

/** True for network-level failures (the link to Redis is down), false for Redis command errors. */
export function isRedisConnectionError(err) {
  if (!err) return false;
  if (err.code && CONNECTION_ERROR_CODES.has(err.code)) return true;
  return CONNECTION_ERROR_MESSAGE.test(err.message ?? '');
}

/* -------------------------------------------------------------------------- */
/* Shared connection state                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One state for the whole app, no matter how many Redis connections it holds.
 * The queue, the queue-events listener and the worker (plus the extra blocking
 * connection BullMQ opens for it) each have their own socket, so a network
 * drop used to be reported by every one of them on every failed reconnect:
 * dozens of identical `connect ETIMEDOUT` lines for one outage.
 *
 *   state: 'connecting' (never connected yet) | 'connected' | 'reconnecting'
 *
 * Read by GET /health/ready.
 */
export const redisStatus = { state: 'connecting', since: Date.now() };

let outage = null; // { startedAt, lastLoggedAt, hidden } while state === 'reconnecting'

/** Call for every network-level Redis error. Logs the start of an outage, then a reminder every 30 s. */
export function noteRedisError(err, now = Date.now()) {
  const message = err?.message || 'connection lost';

  if (redisStatus.state !== 'reconnecting') {
    redisStatus.state = 'reconnecting';
    redisStatus.since = now;
    outage = { startedAt: now, lastLoggedAt: now, hidden: 0 };
    console.warn(`[redis] connection problem: ${message}. Reconnecting automatically...`);
    return;
  }

  outage.hidden += 1;
  if (now - outage.lastLoggedAt >= REMINDER_INTERVAL_MS) {
    const seconds = Math.round((now - outage.startedAt) / 1000);
    console.warn(
      `[redis] still reconnecting after ${seconds}s (${message}); ${outage.hidden} repeated error(s) not shown.`
    );
    outage.lastLoggedAt = now;
    outage.hidden = 0;
  }
}

/** Call when a connection is ready again. Logs once, when the outage is over. */
export function noteRedisConnected(now = Date.now()) {
  if (redisStatus.state === 'reconnecting' && outage) {
    const seconds = Math.round((now - outage.startedAt) / 1000);
    console.log(`[redis] connection restored after ${seconds}s`);
  }
  redisStatus.state = 'connected';
  redisStatus.since = now;
  outage = null;
}

/** Test helper: back to the initial state. */
export function resetRedisStatus() {
  redisStatus.state = 'connecting';
  redisStatus.since = Date.now();
  outage = null;
}

/**
 * Returns an 'error' listener for a BullMQ Queue / Worker / QueueEvents.
 * BullMQ re-emits its connection errors on those objects, so this is where the
 * old `[worker] error: connect ETIMEDOUT` lines came from. Network errors go to
 * the shared tracker above; anything else is logged as it always was.
 */
export function logBullError(scope) {
  return (err) => {
    if (isRedisConnectionError(err)) noteRedisError(err);
    else console.error(`[${scope}] error:`, err?.message ?? err);
  };
}

/* -------------------------------------------------------------------------- */
/* Connection factory                                                         */
/* -------------------------------------------------------------------------- */

const openConnections = new Set();

/**
 * Creates a new Redis connection configured the way BullMQ requires.
 * `maxRetriesPerRequest: null` is mandatory for BullMQ workers and QueueEvents
 * because they use blocking commands.
 *
 * Queue, Worker and QueueEvents each get their own connection (BullMQ
 * recommendation), so this is a factory rather than a singleton.
 *
 * `keepAlive` makes the OS send a TCP probe every 10 s on an otherwise idle
 * socket. Routers, NAT gateways and hosted-Redis load balancers silently drop
 * connections that stay quiet for a while, and a worker waiting for a job is
 * exactly that: the next reconnect then fails with `connect ETIMEDOUT`.
 *
 * @param {string} [label]  which part of the app owns the connection (for logs)
 */
export function createRedisConnection(label = 'client') {
  const connection = new Redis(process.env.REDIS_URL || DEFAULT_REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectTimeout: 10000,
    keepAlive: Number(process.env.REDIS_KEEPALIVE_MS) || 10000,
  });

  openConnections.add(connection);

  connection.on('error', logBullError(`redis:${label}`));
  // A dropped established connection emits 'reconnecting' without always emitting an error.
  connection.on('reconnecting', () => noteRedisError(new Error('connection lost')));
  connection.on('ready', () => {
    // Only call the outage over once every connection this app holds is back.
    if ([...openConnections].every((c) => c.status === 'ready')) noteRedisConnected();
  });
  connection.on('end', () => openConnections.delete(connection));

  return connection;
}

/**
 * Fails fast (instead of retrying forever) when Redis is unreachable at boot.
 */
export async function assertRedisReachable(connection, timeoutMs = 8000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Redis not reachable at ${redactedRedisUrl()}`)),
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

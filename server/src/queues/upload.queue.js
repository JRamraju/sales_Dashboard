import { Queue, QueueEvents } from 'bullmq';
import { createRedisConnection, logBullError } from '../config/redis.config.js';

export const UPLOAD_QUEUE_NAME = 'sales-upload';

/** WebSocket event names (see the API/WS spec). */
export const SOCKET_EVENTS = {
  PROGRESS: 'upload:progress',
  COMPLETED: 'upload:completed',
  FAILED: 'upload:failed',
};

/** Socket.io room for one batch; clients join it with `join:batch` (see server.js). */
export const batchRoom = (batchId) => `batch:${batchId}`;

/** How long POST /uploads waits for Redis before answering 503 instead of hanging. */
const ENQUEUE_TIMEOUT_MS = Number(process.env.ENQUEUE_TIMEOUT_MS) || 5000;

let queue = null;

/**
 * Lazily creates the BullMQ queue producer used by the upload controller.
 */
export function getUploadQueue() {
  if (!queue) {
    queue = new Queue(UPLOAD_QUEUE_NAME, {
      connection: createRedisConnection('queue'),
      defaultJobOptions: {
        // Re-running a half-finished ingest would duplicate rows, so no auto-retry.
        attempts: 1,
        removeOnComplete: { age: 60 * 60, count: 200 },
        removeOnFail: { age: 24 * 60 * 60, count: 500 },
      },
    });
    queue.on('error', logBullError('queue'));
  }
  return queue;
}

/**
 * Adds a parse + ingest job. The controller calls this and immediately returns
 * the batchId, so the HTTP request never waits for the file to be processed.
 *
 * The Redis connection is configured to retry forever (BullMQ requires that
 * for workers), so with Redis down `queue.add()` would never settle and the
 * upload request would hang. The timeout turns that into a normal rejection,
 * which the controller answers with a 503.
 */
export async function enqueueUploadJob({ batchId, filePath, originalName }) {
  const adding = getUploadQueue().add('process-upload', {
    batchId: String(batchId),
    filePath,
    originalName,
  });

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out after ${ENQUEUE_TIMEOUT_MS}ms waiting for Redis`)),
      ENQUEUE_TIMEOUT_MS
    );
  });

  try {
    return await Promise.race([adding, timeout]);
  } catch (err) {
    // If Redis comes back later the job would still be added for a batch that
    // has already been reported as failed. Take it back out.
    adding.then((job) => job?.remove()).catch(() => {});
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Forwards the worker's job events to browsers over Socket.io:
 *
 *   job progress   -> upload:progress   { batchId, progress, processedRows, totalRows }
 *   job completed  -> upload:completed  { batchId, inserted, skipped, errorLogs, ... }
 *   job failed     -> upload:failed     { batchId, reason, error }
 *
 * The worker may run in this process or in a separate `npm run worker`
 * process; either way the events flow through Redis, so the API server is the
 * one place that talks to WebSocket clients.
 *
 * By default events go to every connected browser (the client filters on
 * batchId, which is how the dashboard has always worked). Set SOCKET_ROOMS=true
 * to send them only to browsers that joined the batch's room with
 * `join:batch`. That needs a client that joins again after a reconnect, which
 * is why it is opt-in.
 */
export async function bridgeQueueEventsToSocket(io) {
  const queueEvents = new QueueEvents(UPLOAD_QUEUE_NAME, {
    connection: createRedisConnection('queue-events'),
  });

  const useRooms = process.env.SOCKET_ROOMS === 'true';
  const send = (event, payload) => {
    const target = useRooms && payload?.batchId ? io.to(batchRoom(payload.batchId)) : io;
    target.emit(event, payload);
  };

  queueEvents.on('error', logBullError('queue-events'));

  queueEvents.on('progress', ({ data }) => {
    if (data && typeof data === 'object') send(SOCKET_EVENTS.PROGRESS, data);
  });

  queueEvents.on('completed', ({ returnvalue }) => {
    if (returnvalue && typeof returnvalue === 'object') send(SOCKET_EVENTS.COMPLETED, returnvalue);
  });

  queueEvents.on('failed', async ({ jobId, failedReason }) => {
    try {
      const job = await getUploadQueue().getJob(jobId);
      // `error` is the field the dashboard client reads; `reason` is kept for
      // anything written against the original payload.
      send(SOCKET_EVENTS.FAILED, {
        batchId: job?.data?.batchId ?? null,
        reason: failedReason,
        error: failedReason,
      });
    } catch (err) {
      console.error('[queue-events] could not report failed job:', err.message);
    }
  });

  await queueEvents.waitUntilReady();
  return queueEvents;
}

export async function closeUploadQueue() {
  if (queue) {
    await queue.close();
    queue = null;
  }
}

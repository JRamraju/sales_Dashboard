import { Queue, QueueEvents } from 'bullmq';
import { createRedisConnection } from '../config/redis.config.js';

export const UPLOAD_QUEUE_NAME = 'sales-upload';

/** WebSocket event names (see the API/WS spec). */
export const SOCKET_EVENTS = {
  PROGRESS: 'upload:progress',
  COMPLETED: 'upload:completed',
  FAILED: 'upload:failed',
};

let queue = null;

/**
 * Lazily creates the BullMQ queue producer used by the upload controller.
 */
export function getUploadQueue() {
  if (!queue) {
    queue = new Queue(UPLOAD_QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        // Re-running a half-finished ingest would duplicate rows, so no auto-retry.
        attempts: 1,
        removeOnComplete: { age: 60 * 60, count: 200 },
        removeOnFail: { age: 24 * 60 * 60, count: 500 },
      },
    });
    queue.on('error', (err) => console.error('[queue] error:', err.message));
  }
  return queue;
}

/**
 * Adds a parse + ingest job. The controller calls this and immediately returns
 * the batchId, so the HTTP request never waits for the file to be processed.
 */
export async function enqueueUploadJob({ batchId, filePath, originalName }) {
  return getUploadQueue().add('process-upload', {
    batchId: String(batchId),
    filePath,
    originalName,
  });
}

/**
 * Forwards the worker's job events to browsers over Socket.io:
 *
 *   job progress   -> upload:progress   { batchId, progress, processedRows, totalRows }
 *   job completed  -> upload:completed  { batchId, inserted, skipped, errorLogs, ... }
 *   job failed     -> upload:failed     { batchId, reason }
 *
 * The worker may run in this process or in a separate `npm run worker`
 * process; either way the events flow through Redis, so the API server is the
 * one place that talks to WebSocket clients.
 */
export async function bridgeQueueEventsToSocket(io) {
  const queueEvents = new QueueEvents(UPLOAD_QUEUE_NAME, {
    connection: createRedisConnection(),
  });

  queueEvents.on('error', (err) => console.error('[queue-events] error:', err.message));

  queueEvents.on('progress', ({ data }) => {
    if (data && typeof data === 'object') io.emit(SOCKET_EVENTS.PROGRESS, data);
  });

  queueEvents.on('completed', ({ returnvalue }) => {
    if (returnvalue && typeof returnvalue === 'object') io.emit(SOCKET_EVENTS.COMPLETED, returnvalue);
  });

  queueEvents.on('failed', async ({ jobId, failedReason }) => {
    try {
      const job = await getUploadQueue().getJob(jobId);
      io.emit(SOCKET_EVENTS.FAILED, { batchId: job?.data?.batchId ?? null, reason: failedReason });
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

import 'dotenv/config'; // must stay the first import so env vars exist for the modules below
import http from 'node:http';
import { Server } from 'socket.io';
import app, { getAllowedOrigins } from './app.js';
import { connectDB, disconnectDB } from './config/db.config.js';
import { createRedisConnection, assertRedisReachable } from './config/redis.config.js';
import { bridgeQueueEventsToSocket, closeUploadQueue, batchRoom } from './queues/upload.queue.js';
import { createUploadWorker } from './workers/upload.worker.js';
import { cleanupStaleUploads } from './middlewares/upload.middleware.js';
import UploadBatch from './models/UploadBatch.model.js';
import { buildBatchSnapshot } from './utils/uploadMappers.util.js';

const PORT = Number(process.env.PORT) || 5000;
const OBJECT_ID = /^[a-f\d]{24}$/i;

/**
 * `join:batch` / `leave:batch` are what the dashboard client emits around an
 * upload. Joining also replays the batch's current outcome to that one socket:
 * a small file can finish before the browser has subscribed, and the live
 * event would then be lost, leaving the progress bar stuck.
 */
function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`[ws] client connected: ${socket.id}`);

    socket.on('join:batch', async (batchId) => {
      if (typeof batchId !== 'string' || !OBJECT_ID.test(batchId)) return;
      socket.join(batchRoom(batchId));

      try {
        const batch = await UploadBatch.findById(batchId).lean();
        const snapshot = buildBatchSnapshot(batch);
        if (snapshot) socket.emit(snapshot.event, snapshot.payload);
      } catch (err) {
        console.error('[ws] could not replay batch state:', err.message);
      }
    });

    socket.on('leave:batch', (batchId) => {
      if (typeof batchId === 'string') socket.leave(batchRoom(batchId));
    });

    socket.on('disconnect', () => console.log(`[ws] client disconnected: ${socket.id}`));
  });
}

async function start() {
  // 1. Databases: fail fast if either is unreachable.
  await connectDB();

  const redisProbe = createRedisConnection('startup-check');
  try {
    await assertRedisReachable(redisProbe);
  } finally {
    redisProbe.disconnect();
  }

  await cleanupStaleUploads();

  // 2. HTTP + Socket.io on the same server.
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: getAllowedOrigins(), methods: ['GET', 'POST'] },
  });
  registerSocketHandlers(io);

  // 3. Relay background-job progress (from Redis) to browsers.
  const queueEvents = await bridgeQueueEventsToSocket(io);

  // 4. Optionally run the BullMQ worker inside this process. For 100,000+ row
  //    files set RUN_WORKER_IN_API=false and run `npm run worker` separately.
  const worker = process.env.RUN_WORKER_IN_API === 'false' ? null : createUploadWorker();
  console.log(
    worker
      ? '[worker] running inside the API process'
      : '[worker] not started here; run `npm run worker` in a separate process'
  );

  await new Promise((resolve) => httpServer.listen(PORT, resolve));
  console.log(`[server] listening on http://localhost:${PORT}  (API: /api/v1)`);

  // 5. Graceful shutdown.
  let shuttingDown = false;
  const shutdown = async (signal, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received, shutting down`);

    const forceExit = setTimeout(() => process.exit(1), 10000);
    forceExit.unref();

    try {
      await new Promise((resolve) => io.close(resolve)); // also stops the HTTP server
      if (worker) await worker.close();
      await queueEvents.close();
      await closeUploadQueue();
      await disconnectDB();
      process.exit(exitCode);
    } catch (err) {
      console.error('[server] error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // A promise nobody awaited or an exception nobody caught used to kill the
  // process with no chance to close the worker, so a running upload was left
  // half-done. Log it and shut down cleanly instead.
  process.on('unhandledRejection', (reason) => {
    console.error('[server] unhandled promise rejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[server] uncaught exception:', err);
    shutdown('uncaughtException', 1);
  });
}

start().catch((err) => {
  console.error('[server] failed to start:', err.message);
  process.exit(1);
});

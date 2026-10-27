import 'dotenv/config'; // must stay the first import so env vars exist for the modules below
import http from 'node:http';
import { Server } from 'socket.io';
import app, { getAllowedOrigins } from './app.js';
import { connectDB, disconnectDB } from './config/db.config.js';
import { createRedisConnection, assertRedisReachable } from './config/redis.config.js';
import { bridgeQueueEventsToSocket, closeUploadQueue } from './queues/upload.queue.js';
import { createUploadWorker } from './workers/upload.worker.js';

const PORT = Number(process.env.PORT) || 5000;

async function start() {
  // 1. Databases: fail fast if either is unreachable.
  await connectDB();

  const redisProbe = createRedisConnection();
  try {
    await assertRedisReachable(redisProbe);
  } finally {
    redisProbe.disconnect();
  }

  // 2. HTTP + Socket.io on the same server.
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: getAllowedOrigins(), methods: ['GET', 'POST'] },
  });
  io.on('connection', (socket) => {
    console.log(`[ws] client connected: ${socket.id}`);
    socket.on('disconnect', () => console.log(`[ws] client disconnected: ${socket.id}`));
  });

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
  const shutdown = async (signal) => {
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
      process.exit(0);
    } catch (err) {
      console.error('[server] error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('[server] failed to start:', err.message);
  process.exit(1);
});

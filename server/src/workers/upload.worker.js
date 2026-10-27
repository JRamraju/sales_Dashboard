import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { Worker } from 'bullmq';
import { connectDB, disconnectDB } from '../config/db.config.js';
import { createRedisConnection } from '../config/redis.config.js';
import { UPLOAD_QUEUE_NAME } from '../queues/upload.queue.js';
import UploadBatch from '../models/UploadBatch.model.js';
import SalesRecord from '../models/SalesRecord.model.js';
import { parseFile, FileParseError } from '../services/fileParser.service.js';
import { validateSalesRow } from '../validators/salesRow.schema.js';

/** Valid rows are bulk-inserted in chunks of 1,000. */
export const CHUNK_SIZE = 1000;

const maxErrorLogs = () => Number(process.env.MAX_ERROR_LOGS) || 1000;
const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Inserts one chunk with `ordered: false` for throughput (a bad document does
 * not stop the rest). Returns how many documents were stored; anything the
 * database rejected is reported through `onRejected`.
 */
export async function insertChunk(docs, rowNumbers, onRejected) {
  try {
    const inserted = await SalesRecord.insertMany(docs, { ordered: false });
    return inserted.length;
  } catch (err) {
    const writeErrors = err.writeErrors ? [].concat(err.writeErrors) : [];
    if (writeErrors.length === 0) throw err;

    for (const writeError of writeErrors) {
      onRejected(rowNumbers[writeError.index], `Database rejected row: ${writeError.errmsg ?? 'write error'}`);
    }
    return docs.length - writeErrors.length;
  }
}

/**
 * BullMQ processor: parse -> sanitize -> validate (Zod) -> chunked bulk insert,
 * reporting progress after every chunk. Runs off the Express request cycle.
 *
 * Returns the validation summary, which the queue-events bridge broadcasts as
 * `upload:completed`.
 */
export async function processUploadJob(job) {
  const { batchId, filePath, originalName } = job.data;
  const batchObjectId = new mongoose.Types.ObjectId(batchId);
  const errorCap = maxErrorLogs();

  await UploadBatch.findByIdAndUpdate(batchId, { status: 'processing' });

  try {
    const rawRows = await parseFile(filePath, originalName);
    const totalRows = rawRows.length;

    let inserted = 0;
    let skipped = 0;
    const errorLogs = []; // capped; `skipped` always holds the true count

    const reject = (rowNumber, reason) => {
      skipped += 1;
      if (errorLogs.length < errorCap) errorLogs.push({ rowNumber, reason });
    };

    for (let start = 0; start < totalRows; start += CHUNK_SIZE) {
      const validDocs = [];
      const validRowNumbers = [];

      for (const { rowNumber, data } of rawRows.slice(start, start + CHUNK_SIZE)) {
        const result = validateSalesRow(data);
        if (result.ok) {
          validDocs.push({ ...result.data, batchId: batchObjectId });
          validRowNumbers.push(rowNumber);
        } else {
          reject(rowNumber, result.reason); // quarantined: logged, never inserted
        }
      }

      if (validDocs.length > 0) {
        inserted += await insertChunk(validDocs, validRowNumbers, reject);
      }

      const processedRows = Math.min(start + CHUNK_SIZE, totalRows);
      await job.updateProgress({
        batchId,
        progress: Math.round((processedRows / totalRows) * 100),
        processedRows,
        totalRows,
      });

      await yieldToEventLoop(); // keep the process responsive when embedded in the API
    }

    await UploadBatch.findByIdAndUpdate(batchId, {
      status: 'completed',
      totalRowsRead: totalRows,
      validRowsInserted: inserted,
      invalidRowsCount: skipped,
      errorLogs,
    });

    return {
      batchId,
      inserted,
      skipped,
      totalRows,
      errorLogs,
      errorLogsTruncated: skipped > errorLogs.length,
    };
  } catch (err) {
    if (err instanceof FileParseError) {
      // A problem with the user's file, not a server fault: no stack trace needed.
      console.warn(`[worker] job ${job.id} (batch ${batchId}) rejected: ${err.message}`);
    } else {
      console.error(`[worker] job ${job.id} (batch ${batchId}) failed:`, err);
    }

    // Leave no half-loaded dataset behind.
    await SalesRecord.deleteMany({ batchId: batchObjectId }).catch(() => {});

    const reason =
      err instanceof FileParseError
        ? err.message
        : 'Processing failed because of an internal error. Please try the upload again.';

    await UploadBatch.findByIdAndUpdate(batchId, { status: 'failed', failureReason: reason });
    throw new Error(reason, { cause: err });
  } finally {
    await fs.promises.rm(filePath, { force: true }).catch(() => {});
  }
}

/**
 * Starts the BullMQ worker. Called from server.js (embedded) or from this
 * file's own entry point (`npm run worker`).
 */
export function createUploadWorker() {
  const worker = new Worker(UPLOAD_QUEUE_NAME, processUploadJob, {
    connection: createRedisConnection(),
    concurrency: Number(process.env.WORKER_CONCURRENCY) || 1,
  });

  worker.on('completed', (job) => console.log(`[worker] job ${job.id} completed`));
  worker.on('failed', (job, err) => console.error(`[worker] job ${job?.id} failed: ${err.message}`));
  worker.on('error', (err) => console.error('[worker] error:', err.message));

  return worker;
}

/* ------------------- Standalone entry point: `npm run worker` ------------------- */

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  (async () => {
    await connectDB();
    const worker = createUploadWorker();
    console.log('[worker] standalone upload worker started');

    const shutdown = async (signal) => {
      console.log(`[worker] ${signal} received, shutting down`);
      await worker.close();
      await disconnectDB();
      process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  })().catch((err) => {
    console.error('[worker] failed to start:', err);
    process.exit(1);
  });
}

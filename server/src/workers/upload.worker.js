import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { Worker } from 'bullmq';
import { connectDB, disconnectDB } from '../config/db.config.js';
import { createRedisConnection, logBullError } from '../config/redis.config.js';
import { UPLOAD_QUEUE_NAME } from '../queues/upload.queue.js';
import UploadBatch from '../models/UploadBatch.model.js';
import SalesRecord from '../models/SalesRecord.model.js';
import { openRowSource, FileParseError } from '../services/fileParser.service.js';
import { validateSalesRow } from '../validators/salesRow.schema.js';
import { DATE_ORDER_LABELS, defaultDateOrder, detectDateOrder } from '../utils/dateOrder.util.js';
import { toClientErrorLogs } from '../utils/uploadMappers.util.js';
import {
  createMasterResolver,
  findExistingLineKeys,
  lineKey,
  releaseMasterData,
} from '../services/masterData.service.js';

/** Valid rows are bulk-inserted in chunks of 1,000. */
export const CHUNK_SIZE = 1000;

/** Rows read up front to work out how the file writes its dates (see dateOrder.util.js). */
const SNIFF_ROWS = 2000;

/** Progress is pushed to Redis after every chunk but saved to MongoDB at most this often. */
const PROGRESS_SAVE_INTERVAL_MS = 1000;

const maxErrorLogs = () => Number(process.env.MAX_ERROR_LOGS) || 1000;
const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Inserts one chunk with `ordered: false` for throughput (a bad document does
 * not stop the rest). Returns how many documents were stored; anything the
 * database rejected is reported through `onRejected`.
 *
 * `lean: true` makes Mongoose skip building, casting and re-validating a full
 * document for every row. That is safe here because each row has just been
 * validated and typed by Zod (real Date, ObjectId, numbers), and it is a large
 * saving on files with 100,000+ rows.
 */
export async function insertChunk(docs, rowNumbers, onRejected) {
  try {
    await SalesRecord.insertMany(docs, { ordered: false, lean: true });
    return docs.length;
  } catch (err) {
    const writeErrors = err.writeErrors ? [].concat(err.writeErrors) : [];
    if (writeErrors.length === 0) throw err;

    for (const writeError of writeErrors) {
      onRejected(
        rowNumbers[writeError.index],
        `Database rejected row: ${writeError.errmsg ?? 'write error'}`,
        'row'
      );
    }
    return docs.length - writeErrors.length;
  }
}

/** Head sample first, then the rest of the stream, as one async sequence. */
async function* withHead(head, iterator) {
  yield* head;
  for (;;) {
    const { value, done } = await iterator.next();
    if (done) return;
    yield value;
  }
}

/** Human-readable remarks about how dates were read, shown with the upload result. */
function describeDateOrder({ order, detected, dmy, mdy, ambiguous }) {
  const notes = [];
  const label = DATE_ORDER_LABELS[order];

  if (detected && order !== defaultDateOrder()) {
    notes.push(`Dates in this file were read as ${label}, detected automatically from the data.`);
  }
  if (dmy > 0 && mdy > 0) {
    notes.push(
      `This file mixes day-first and month-first dates (${dmy} vs ${mdy}). Dates were read as ${label}; rows that do not fit are listed as skipped.`
    );
  }
  if (!detected && ambiguous > 0) {
    notes.push(
      `${ambiguous} dates (such as 03/04/2026) could be read either way and were read as ${label}. ` +
        'Set DEFAULT_DATE_ORDER=mdy on the server if your files use MM/DD/YYYY.'
    );
  }
  return notes;
}

/**
 * BullMQ processor: stream rows -> sanitize -> validate (Zod) -> skip lines
 * that already exist in an earlier file -> create missing customers/products
 * and link the rows to them -> chunked bulk insert, reporting progress after
 * every chunk. Runs off the Express request cycle.
 *
 * Files are processed strictly in upload order (the worker runs one job at a
 * time), which is what makes "new in this file" and duplicate detection
 * well-defined.
 *
 * Returns the validation summary, which the queue-events bridge broadcasts as
 * `upload:completed`.
 *
 * Safe to run twice for the same batch: it clears any rows a crashed earlier
 * run left behind before it inserts anything, so a BullMQ stalled-job re-run
 * can never duplicate data.
 */
export async function processUploadJob(job) {
  const { batchId, filePath, originalName } = job.data;
  const batchObjectId = new mongoose.Types.ObjectId(batchId);
  const errorCap = maxErrorLogs();
  let source = null;

  await UploadBatch.findByIdAndUpdate(batchId, {
    status: 'processing',
    processedRows: 0,
    progress: 0,
    startedAt: new Date(),
  });

  try {
    await SalesRecord.deleteMany({ batchId: batchObjectId });
    await releaseMasterData(batchObjectId); // undo a crashed earlier run of this same file

    // Fails here (before any row work) for an empty file or missing columns.
    source = await openRowSource(filePath, originalName);
    const iterator = source.rows[Symbol.asyncIterator]();

    // Read a head sample so the date order can be decided before row 1 is validated.
    const head = [];
    while (head.length < SNIFF_ROWS) {
      const { value, done } = await iterator.next();
      if (done) break;
      head.push(value);
    }
    if (head.length === 0) {
      throw new FileParseError(`The ${source.type === 'csv' ? 'CSV' : 'Excel'} file has no data rows.`);
    }

    const dateInfo = detectDateOrder(head.map((row) => row.data.orderDate));
    const dateOrder = dateInfo.order;
    const notes = describeDateOrder(dateInfo);

    let processedRows = 0;
    let inserted = 0;
    let skipped = 0;
    let duplicates = 0;
    const errorLogs = []; // capped; `skipped` always holds the true count
    const duplicateLogs = []; // capped; `duplicates` always holds the true count
    const master = createMasterResolver(batchObjectId);

    const reject = (rowNumber, reason, field) => {
      skipped += 1;
      if (errorLogs.length < errorCap) {
        errorLogs.push({ rowNumber, reason, ...(field && { field }) });
      }
    };

    let lastSaved = 0;
    const reportProgress = async () => {
      // CSVs are streamed, so the row total is unknown until the end; progress
      // is then the share of the file's bytes consumed. Never claim 100% early.
      const progress = Math.min(99, Math.round(source.progress() * 100));
      await job.updateProgress({
        batchId,
        progress,
        processedRows,
        totalRows: source.totalRows ?? undefined,
      });

      const now = Date.now();
      if (now - lastSaved >= PROGRESS_SAVE_INTERVAL_MS) {
        lastSaved = now;
        await UploadBatch.updateOne({ _id: batchId }, { processedRows, progress });
      }
    };

    const processChunk = async (chunk) => {
      const validDocs = [];
      const validRowNumbers = [];

      for (const { rowNumber, data } of chunk) {
        const result = validateSalesRow(data, { dateOrder });
        if (result.ok) {
          validDocs.push({ ...result.data, batchId: batchObjectId });
          validRowNumbers.push(rowNumber);
        } else {
          reject(rowNumber, result.reason, result.field); // quarantined: logged, never inserted
        }
      }

      // Order lines that already exist in an earlier file are skipped and reported.
      const existing = await findExistingLineKeys(validDocs, batchObjectId);
      const freshDocs = [];
      const freshRowNumbers = [];
      validDocs.forEach((doc, i) => {
        if (existing.has(lineKey(doc.orderId, doc.productId))) {
          duplicates += 1;
          if (duplicateLogs.length < errorCap) {
            duplicateLogs.push({
              rowNumber: validRowNumbers[i],
              reason: `Duplicate: order ${doc.orderId} / product ${doc.productId} already exists in another file`,
              field: 'order_id, product_id',
            });
          }
        } else {
          freshDocs.push(doc);
          freshRowNumbers.push(validRowNumbers[i]);
        }
      });

      if (freshDocs.length > 0) {
        // Create missing customers / products, link each row to its master record.
        await master.attach(freshDocs);
        inserted += await insertChunk(freshDocs, freshRowNumbers, reject);
      }

      processedRows += chunk.length;
      await reportProgress();
      await yieldToEventLoop(); // keep the process responsive when embedded in the API
    };

    let chunk = [];
    for await (const row of withHead(head, iterator)) {
      chunk.push(row);
      if (chunk.length >= CHUNK_SIZE) {
        await processChunk(chunk);
        chunk = [];
      }
    }
    if (chunk.length > 0) await processChunk(chunk);

    const totalRows = processedRows;
    await job.updateProgress({ batchId, progress: 100, processedRows, totalRows });

    await UploadBatch.findByIdAndUpdate(batchId, {
      status: 'completed',
      totalRowsRead: totalRows,
      validRowsInserted: inserted,
      invalidRowsCount: skipped,
      duplicateRowsCount: duplicates,
      newCustomersCount: master.newCustomers,
      newProductsCount: master.newProducts,
      processedRows,
      progress: 100,
      errorLogs,
      duplicateLogs,
      dateOrder,
      notes,
      finishedAt: new Date(),
    });

    return {
      batchId,
      fileName: originalName,
      inserted,
      skipped,
      duplicates,
      newCustomers: master.newCustomers,
      newProducts: master.newProducts,
      totalRows,
      errorLogs: toClientErrorLogs(errorLogs),
      errorLogsTruncated: skipped > errorLogs.length,
      duplicateLogs: toClientErrorLogs(duplicateLogs),
      duplicateLogsTruncated: duplicates > duplicateLogs.length,
      dateOrder,
      notes,
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
    await releaseMasterData(batchObjectId).catch(() => {});

    const reason =
      err instanceof FileParseError
        ? err.message
        : 'Processing failed because of an internal error. Please try the upload again.';

    await UploadBatch.findByIdAndUpdate(batchId, {
      status: 'failed',
      failureReason: reason,
      finishedAt: new Date(),
    });
    throw new Error(reason, { cause: err });
  } finally {
    source?.close();
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
    // Must stay 1: file 2 has to see everything file 1 created (customers,
    // products, order lines). Running uploads in parallel would break the
    // "new in this file" and duplicate checks, so WORKER_CONCURRENCY is ignored.
    concurrency: 1,
    // The worker renews its claim on a running job every lockDuration / 2. If
    // Redis is unreachable for longer than lockDuration (a network drop of
    // 30-40s was enough with BullMQ's 30s default) the claim expires, BullMQ
    // treats the job as stalled and runs it again from the start. 2 minutes
    // rides out a typical drop. The trade-off: a job whose worker process was
    // killed is only recovered after that time.
    lockDuration: Number(process.env.WORKER_LOCK_MS) || 120_000,
  });

  worker.on('completed', (job) => console.log(`[worker] job ${job.id} completed`));
  worker.on('error', logBullError('worker'));

  worker.on('failed', async (job, err) => {
    console.error(`[worker] job ${job?.id} failed: ${err.message}`);

    // processUploadJob marks its own failures. This covers the ones it cannot
    // reach: a job that stalled because the worker process died mid-run would
    // otherwise leave its batch "processing" forever (and undeletable).
    const { batchId, filePath } = job?.data ?? {};
    if (!batchId) return;
    try {
      await UploadBatch.updateOne(
        { _id: batchId, status: { $in: ['queued', 'processing'] } },
        {
          status: 'failed',
          failureReason: 'Processing was interrupted. Please upload the file again.',
          finishedAt: new Date(),
        }
      );
      if (filePath) await fs.promises.rm(filePath, { force: true });
    } catch (updateErr) {
      console.error('[worker] could not mark batch as failed:', updateErr.message);
    }
  });

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

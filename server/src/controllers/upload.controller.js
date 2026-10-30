import fs from 'node:fs';
import UploadBatch from '../models/UploadBatch.model.js';
import SalesRecord from '../models/SalesRecord.model.js';
import { nextSequence } from '../models/Counter.model.js';
import { releaseMasterData } from '../services/masterData.service.js';
import { enqueueUploadJob } from '../queues/upload.queue.js';
import { ApiError } from '../middlewares/error.middleware.js';
import { clearBatchCache } from './analytics.controller.js';
import { toClientBatch } from '../utils/uploadMappers.util.js';

const OBJECT_ID = /^[a-f\d]{24}$/i;

/**
 * A batch still "queued" or "processing" after this long lost its worker
 * (the process was killed mid-job), so it may be deleted anyway instead of
 * being stuck in the list forever.
 */
const STALE_UPLOAD_MS = (Number(process.env.STALE_UPLOAD_MINUTES) || 60) * 60 * 1000;

function assertBatchId(id) {
  if (!OBJECT_ID.test(String(id))) throw new ApiError(400, 'Invalid batchId.');
}

const removeFile = (filePath) => fs.promises.rm(filePath, { force: true }).catch(() => {});

/**
 * POST /api/v1/uploads
 * Saves the upload, creates the UploadBatch record, queues the parse + ingest
 * job in BullMQ and returns immediately. Progress then arrives over WebSocket
 * (upload:progress / upload:completed).
 */
export async function uploadFile(req, res) {
  if (!req.file) {
    throw new ApiError(400, 'No file uploaded. Send the CSV/Excel file in the "file" form field.');
  }

  let batch;
  let job;
  try {
    // sequence = "File 1", "File 2", ...; the worker processes files in this order.
    batch = await UploadBatch.create({
      fileName: req.file.originalname,
      status: 'queued',
      sequence: await nextSequence('uploadBatch'),
    });

    job = await enqueueUploadJob({
      batchId: batch._id,
      filePath: req.file.path,
      originalName: req.file.originalname,
    });
  } catch (err) {
    console.error('[upload] could not start processing:', err);

    // Whatever failed, the temp file will never be picked up by a worker.
    await removeFile(req.file.path);
    if (batch) {
      await UploadBatch.findByIdAndUpdate(batch._id, {
        status: 'failed',
        failureReason: 'Could not queue the file for processing.',
        finishedAt: new Date(),
      }).catch(() => {});
    }

    throw new ApiError(503, 'The upload queue is unavailable. Please try again shortly.');
  }

  res.status(202).json({
    batchId: batch._id,
    jobId: job.id,
    sequence: batch.sequence,
    fileName: batch.fileName,
    status: batch.status,
    message: 'File received and queued for processing.',
  });
}

/**
 * GET /api/v1/uploads
 * Every uploaded file in upload order (File 1 first). They all feed the
 * combined dashboard; the "view by file" filter picks which ones to show.
 * errorLogs / duplicateLogs are left out of the list; fetch one file to see them.
 */
export async function listUploads(req, res) {
  const batches = await UploadBatch.find()
    .select('-errorLogs -duplicateLogs')
    .sort({ sequence: 1, uploadedAt: 1 }) // File 1, File 2, ... (the file filter lists them in this order)
    .limit(200)
    .lean();
  res.json(batches.map(toClientBatch));
}

/**
 * GET /api/v1/uploads/:batchId
 * One batch including its skipped-row error log and duplicate log (status polling / "View Skipped Rows").
 */
export async function getUpload(req, res) {
  assertBatchId(req.params.batchId);

  const batch = await UploadBatch.findById(req.params.batchId).lean();
  if (!batch) throw new ApiError(404, 'Upload batch not found.');

  res.json(toClientBatch(batch));
}

/**
 * DELETE /api/v1/uploads/:batchId
 * Removes one file and all of its sales records (the other files are untouched).
 */
export async function deleteUpload(req, res) {
  assertBatchId(req.params.batchId);

  const batch = await UploadBatch.findById(req.params.batchId);
  if (!batch) throw new ApiError(404, 'Upload batch not found.');

  const inFlight = batch.status === 'queued' || batch.status === 'processing';
  const isStale = Date.now() - new Date(batch.uploadedAt).getTime() > STALE_UPLOAD_MS;
  if (inFlight && !isStale) {
    throw new ApiError(409, 'This upload is still being processed. Try again once it has finished.');
  }

  const { deletedCount } = await SalesRecord.deleteMany({ batchId: batch._id });
  // Customers / products only this file introduced are removed; ones a later
  // file also uses are handed to that file (it becomes their "first" file).
  await releaseMasterData(batch._id);
  await batch.deleteOne();
  clearBatchCache(batch._id);

  res.json({
    batchId: batch._id,
    deletedRecords: deletedCount,
    message: 'Upload deleted.',
  });
}

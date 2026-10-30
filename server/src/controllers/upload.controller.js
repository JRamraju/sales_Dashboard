import fs from 'node:fs';
import UploadBatch from '../models/UploadBatch.model.js';
import SalesRecord from '../models/SalesRecord.model.js';
import { enqueueUploadJob } from '../queues/upload.queue.js';
import { ApiError } from '../middlewares/error.middleware.js';
import { clearBatchCache } from './analytics.controller.js';
import { toClientBatch, withFileNumbers } from '../utils/uploadMappers.util.js';
import { removeUnreferencedMasters } from '../services/masterData.service.js';

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
    batch = await UploadBatch.create({ fileName: req.file.originalname, status: 'queued' });

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
    fileName: batch.fileName,
    status: batch.status,
    message: 'File received and queued for processing.',
  });
}

/**
 * GET /api/v1/uploads
 * Uploaded files (newest first), which feed the dashboard's "view by file"
 * filter. Each finished file carries `fileNumber` (oldest = 1); the others have
 * null. errorLogs are left out of the list; fetch one batch to see them.
 */
export async function listUploads(req, res) {
  const batches = await UploadBatch.find().select('-errorLogs').sort({ uploadedAt: -1 }).limit(200).lean();
  res.json(withFileNumbers(batches.map(toClientBatch)));
}

/**
 * GET /api/v1/uploads/:batchId
 * One batch including its skipped-row error log (status polling / "View Skipped Rows").
 */
export async function getUpload(req, res) {
  assertBatchId(req.params.batchId);

  const batch = await UploadBatch.findById(req.params.batchId).lean();
  if (!batch) throw new ApiError(404, 'Upload batch not found.');

  res.json(toClientBatch(batch));
}

/**
 * DELETE /api/v1/uploads/:batchId
 * Removes one file and its sales records. The other files stay as they are,
 * and customers / products that only this file had are removed too, while
 * the ones other files still use are kept.
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

  // Which customer / product records this file's rows pointed to, read before the rows go.
  const [customerRefs, productRefs] = await Promise.all([
    SalesRecord.distinct('customerRef', { batchId: batch._id }),
    SalesRecord.distinct('productRef', { batchId: batch._id }),
  ]);

  const { deletedCount } = await SalesRecord.deleteMany({ batchId: batch._id });
  await batch.deleteOne();
  clearBatchCache(batch._id);

  // The file is already gone, so a failure here must not turn the delete into an error.
  let removed = { removedCustomers: 0, removedProducts: 0 };
  try {
    removed = await removeUnreferencedMasters({
      customerRefs: customerRefs.filter(Boolean),
      productRefs: productRefs.filter(Boolean),
    });
  } catch (err) {
    console.error('[upload] could not clean up customer/product records:', err.message);
  }

  res.json({
    batchId: batch._id,
    deletedRecords: deletedCount,
    ...removed,
    message: 'Upload deleted.',
  });
}

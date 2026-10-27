import fs from 'node:fs';
import UploadBatch from '../models/UploadBatch.model.js';
import SalesRecord from '../models/SalesRecord.model.js';
import { enqueueUploadJob } from '../queues/upload.queue.js';
import { ApiError } from '../middlewares/error.middleware.js';

const OBJECT_ID = /^[a-f\d]{24}$/i;

function assertBatchId(id) {
  if (!OBJECT_ID.test(String(id))) throw new ApiError(400, 'Invalid batchId.');
}

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

  const batch = await UploadBatch.create({ fileName: req.file.originalname, status: 'queued' });

  let job;
  try {
    job = await enqueueUploadJob({
      batchId: batch._id,
      filePath: req.file.path,
      originalName: req.file.originalname,
    });
  } catch (err) {
    console.error('[upload] could not enqueue job:', err);
    await UploadBatch.findByIdAndUpdate(batch._id, {
      status: 'failed',
      failureReason: 'Could not queue the file for processing.',
    });
    await fs.promises.rm(req.file.path, { force: true }).catch(() => {});
    throw new ApiError(503, 'The upload queue is unavailable. Please try again shortly.');
  }

  res.status(202).json({
    batchId: batch._id,
    jobId: job.id,
    fileName: batch.fileName,
    status: batch.status,
  });
}

/**
 * GET /api/v1/uploads
 * Previously uploaded batches (newest first) so the user can switch datasets
 * without re-uploading. errorLogs are left out of the list; fetch one batch
 * to see them.
 */
export async function listUploads(req, res) {
  const batches = await UploadBatch.find().select('-errorLogs').sort({ uploadedAt: -1 }).limit(200).lean();
  res.json(batches);
}

/**
 * GET /api/v1/uploads/:batchId
 * One batch including its skipped-row error log (status polling / "View Skipped Rows").
 */
export async function getUpload(req, res) {
  assertBatchId(req.params.batchId);

  const batch = await UploadBatch.findById(req.params.batchId).lean();
  if (!batch) throw new ApiError(404, 'Upload batch not found.');

  res.json(batch);
}

/**
 * DELETE /api/v1/uploads/:batchId
 * Removes an old upload and all of its sales records.
 */
export async function deleteUpload(req, res) {
  assertBatchId(req.params.batchId);

  const batch = await UploadBatch.findById(req.params.batchId);
  if (!batch) throw new ApiError(404, 'Upload batch not found.');

  if (batch.status === 'queued' || batch.status === 'processing') {
    throw new ApiError(409, 'This upload is still being processed. Try again once it has finished.');
  }

  const { deletedCount } = await SalesRecord.deleteMany({ batchId: batch._id });
  await batch.deleteOne();

  res.json({ batchId: batch._id, deletedRecords: deletedCount });
}

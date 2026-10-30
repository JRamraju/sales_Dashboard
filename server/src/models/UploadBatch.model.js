import mongoose from 'mongoose';

const { Schema } = mongoose;

export const UPLOAD_STATUSES = ['queued', 'processing', 'completed', 'failed'];

const errorLogSchema = new Schema(
  {
    rowNumber: { type: Number, required: true },
    reason: { type: String, required: true },
    // Column(s) the problem is in, e.g. "order_date" or "quantity, total_amount".
    field: { type: String },
  },
  { _id: false }
);

/**
 * One document per uploaded file. Tracks the background job so the UI can show
 * progress, let the user switch between datasets, or delete old uploads.
 */
const uploadBatchSchema = new Schema({
  fileName: { type: String, required: true, trim: true }, // "Q1_Sales_2026.xlsx"
  // 1 for the first file, 2 for the second, ... (assigned at upload time).
  sequence: { type: Number, index: true },
  status: { type: String, enum: UPLOAD_STATUSES, default: 'queued', index: true },
  totalRowsRead: { type: Number, default: 0 },
  validRowsInserted: { type: Number, default: 0 },
  invalidRowsCount: { type: Number, default: 0 },
  // Live progress, saved while the worker runs so a page refresh (or a browser
  // that missed the WebSocket events) can still show where the job is.
  processedRows: { type: Number, default: 0 },
  progress: { type: Number, default: 0 }, // 0-100
  // Capped at MAX_ERROR_LOGS entries by the worker (Mongo's 16MB document
  // limit); invalidRowsCount always holds the true number of skipped rows.
  errorLogs: { type: [errorLogSchema], default: [] },
  // Rows skipped because the same order line (order_id + product_id) already
  // exists in another file. Counted separately from invalid rows.
  duplicateRowsCount: { type: Number, default: 0 },
  duplicateLogs: { type: [errorLogSchema], default: [] },
  // Customers / products first seen in this file (created by the worker).
  newCustomersCount: { type: Number, default: 0 },
  newProductsCount: { type: Number, default: 0 },
  // How a/b/YYYY dates were read for this file ('dmy' = DD/MM/YYYY, 'mdy' = MM/DD/YYYY),
  // plus human-readable notes about it (see upload.worker.js).
  dateOrder: { type: String, enum: ['dmy', 'mdy'] },
  notes: { type: [String], default: [] },
  // Only set when status === 'failed' so the UI can say why.
  failureReason: { type: String },
  uploadedAt: { type: Date, default: Date.now, index: true },
  startedAt: { type: Date },
  finishedAt: { type: Date },
});

const UploadBatch =
  mongoose.models.UploadBatch || mongoose.model('UploadBatch', uploadBatchSchema);

export default UploadBatch;

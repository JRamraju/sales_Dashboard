/**
 * Shapes stored upload data the way the dashboard client reads it.
 *
 * The client's ValidationModal renders `log.message` / `log.field`, its
 * failure toast reads `event.error`, and its batch type uses `totalRows` and
 * `batchId`, while MongoDB stores `reason`, `failureReason` and `totalRowsRead`.
 * Mapping happens here, at the API / WebSocket boundary, so the stored schema
 * can stay as it is and every consumer gets one consistent payload.
 */

/** Stored { rowNumber, reason, field? } -> client { rowNumber, field, message, reason }. */
export function toClientErrorLog(log) {
  const reason = log?.reason ?? log?.message ?? 'Invalid record';
  return {
    rowNumber: log?.rowNumber,
    field: log?.field || 'row',
    message: reason,
    reason, // kept so anything reading the original field name still works
  };
}

export const toClientErrorLogs = (logs) => (Array.isArray(logs) ? logs.map(toClientErrorLog) : []);

/** A UploadBatch document (or lean object) as returned by GET /uploads and GET /uploads/:id. */
export function toClientBatch(batch) {
  if (!batch) return batch;
  const plain = typeof batch.toObject === 'function' ? batch.toObject() : batch;
  const { errorLogs, duplicateLogs, ...rest } = plain;

  return {
    ...rest,
    batchId: String(plain._id),
    totalRows: plain.totalRowsRead ?? 0,
    // errorLogs is left out of list queries; only emit it when it was loaded.
    ...(errorLogs !== undefined && { errorLogs: toClientErrorLogs(errorLogs) }),
    ...(duplicateLogs !== undefined && { duplicateLogs: toClientErrorLogs(duplicateLogs) }),
  };
}

export const MAX_ERROR_LOGS_IN_EVENT = 1000;

/**
 * The WebSocket event that describes where a batch currently stands. Used to
 * replay the outcome to a browser that subscribed after the job had already
 * finished (the upload response and the first `join:batch` race with a fast job).
 *
 * @returns {{ event: string, payload: object } | null}  null while still queued
 */
export function buildBatchSnapshot(batch) {
  if (!batch) return null;
  const batchId = String(batch._id);

  if (batch.status === 'completed') {
    return {
      event: 'upload:completed',
      payload: {
        batchId,
        fileName: batch.fileName,
        inserted: batch.validRowsInserted ?? 0,
        skipped: batch.invalidRowsCount ?? 0,
        duplicates: batch.duplicateRowsCount ?? 0,
        newCustomers: batch.newCustomersCount ?? 0,
        newProducts: batch.newProductsCount ?? 0,
        totalRows: batch.totalRowsRead ?? 0,
        errorLogs: toClientErrorLogs(batch.errorLogs),
        errorLogsTruncated: (batch.invalidRowsCount ?? 0) > (batch.errorLogs?.length ?? 0),
        duplicateLogs: toClientErrorLogs(batch.duplicateLogs),
        duplicateLogsTruncated: (batch.duplicateRowsCount ?? 0) > (batch.duplicateLogs?.length ?? 0),
        dateOrder: batch.dateOrder,
        notes: batch.notes ?? [],
      },
    };
  }

  if (batch.status === 'failed') {
    const reason = batch.failureReason || 'Processing failed.';
    return { event: 'upload:failed', payload: { batchId, reason, error: reason } };
  }

  if (batch.status === 'processing') {
    return {
      event: 'upload:progress',
      payload: {
        batchId,
        progress: batch.progress ?? 0,
        processedRows: batch.processedRows ?? 0,
        totalRows: batch.totalRowsRead || undefined,
      },
    };
  }

  return null;
}

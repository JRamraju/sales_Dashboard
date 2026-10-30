import SalesRecord from '../models/SalesRecord.model.js';
import UploadBatch from '../models/UploadBatch.model.js';

/**
 * Finds orders in a new upload that are already in a file uploaded earlier, so
 * the worker can skip them instead of counting them twice. Uploading the same
 * file again, or an updated export that still contains last month's orders,
 * then never inflates revenue.
 *
 * Only finished files count as "earlier": a failed or half-loaded upload must
 * not make a later file's orders look like duplicates. The comparison is on
 * `orderId` alone and only against OTHER files; several lines sharing one
 * order id inside the same file are normal and are kept.
 *
 * @param {import('mongoose').Types.ObjectId} batchObjectId  the upload being processed
 * @param {{ SalesRecordModel?: object, UploadBatchModel?: object }} [models]  overridable for tests
 * @returns {Promise<{ hasEarlierFiles: boolean, findExisting: (orderIds: string[]) => Promise<Map<string, string>> }>}
 */
export async function createOrderDeduper(batchObjectId, models = {}) {
  const SalesRecordModel = models.SalesRecordModel ?? SalesRecord;
  const UploadBatchModel = models.UploadBatchModel ?? UploadBatch;

  const earlier = await UploadBatchModel.find({ status: 'completed', _id: { $ne: batchObjectId } })
    .select('fileName')
    .lean();

  if (earlier.length === 0) {
    return { hasEarlierFiles: false, findExisting: async () => new Map() };
  }

  const earlierIds = earlier.map((b) => b._id);
  const fileNameOf = new Map(earlier.map((b) => [String(b._id), b.fileName]));

  /**
   * @param {string[]} orderIds
   * @returns {Promise<Map<string, string>>}  order id -> name of the earlier file that has it
   */
  async function findExisting(orderIds) {
    const unique = [...new Set(orderIds)];
    if (unique.length === 0) return new Map();

    const rows = await SalesRecordModel.aggregate([
      { $match: { orderId: { $in: unique }, batchId: { $in: earlierIds } } },
      { $group: { _id: '$orderId', batchId: { $first: '$batchId' } } },
    ]);

    return new Map(rows.map((row) => [row._id, fileNameOf.get(String(row.batchId)) ?? 'an earlier file']));
  }

  return { hasEarlierFiles: true, findExisting };
}

/** Remark for the upload result, e.g. "Skipped 120 rows (45 orders) that were already in an earlier file." */
export function describeDuplicates({ rows, orders }) {
  if (rows === 0) return '';
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return `Skipped ${plural(rows, 'row')} (${plural(orders, 'order')}) that were already in an earlier file.`;
}

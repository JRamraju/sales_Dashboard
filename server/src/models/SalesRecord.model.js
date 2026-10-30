import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * One document per validated order line item.
 * Rows sharing an orderId belong to the same order.
 */
const salesRecordSchema = new Schema({
  batchId: { type: Schema.Types.ObjectId, ref: 'UploadBatch', required: true },
  orderId: { type: String, required: true },
  orderDate: { type: Date, required: true },
  customerId: { type: String, required: true },
  customerName: { type: String, required: true },
  productId: { type: String, required: true },
  productName: { type: String, required: true },
  // Links to the Customer / Product master records (set by the upload worker).
  // Not required: rows uploaded before master records existed do not have them.
  // The inline customer* / product* fields above stay as they are, so analytics
  // queries need no join.
  customerRef: { type: Schema.Types.ObjectId, ref: 'Customer' },
  productRef: { type: Schema.Types.ObjectId, ref: 'Product' },
  category: { type: String, required: true },
  region: { type: String, required: true },
  quantity: { type: Number, required: true },
  unitPrice: { type: Number, required: true },
  discount: { type: Number, default: 0 },
  totalRevenue: { type: Number, required: true }, // rounded to 2 decimals on ingest
});

// Every analytics query starts with `batchId`, so this one compound index
// serves them all: file scans, date-range filters, and the category / region
// filters. (The earlier version also kept separate single-field indexes on
// orderId, orderDate, category and region. No analytics query can use them,
// because they are never filtered without batchId, and each one made every
// inserted row more expensive to write. Set SYNC_INDEXES=true for one start-up
// to drop the old ones from an existing database.)
salesRecordSchema.index({ batchId: 1, orderDate: 1, category: 1, region: 1 });

// The one exception: an upload looks up which of its order ids are already in
// an earlier file (duplicateOrders.service.js), and without this index every
// chunk of that lookup would scan the whole collection.
salesRecordSchema.index({ orderId: 1 });

const SalesRecord =
  mongoose.models.SalesRecord || mongoose.model('SalesRecord', salesRecordSchema);

export default SalesRecord;

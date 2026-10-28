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
  category: { type: String, required: true },
  region: { type: String, required: true },
  quantity: { type: Number, required: true },
  unitPrice: { type: Number, required: true },
  discount: { type: Number, default: 0 },
  totalRevenue: { type: Number, required: true }, // rounded to 2 decimals on ingest
});

// Every query in the app starts with `batchId`, so this one compound index
// serves them all: batch scans, date-range filters, and the category / region
// filters. (The earlier version also kept separate single-field indexes on
// orderId, orderDate, category and region. No query can use them, because
// they are never filtered without batchId, and each one made every inserted
// row more expensive to write. Set SYNC_INDEXES=true for one start-up to drop
// the old ones from an existing database.)
salesRecordSchema.index({ batchId: 1, orderDate: 1, category: 1, region: 1 });

const SalesRecord =
  mongoose.models.SalesRecord || mongoose.model('SalesRecord', salesRecordSchema);

export default SalesRecord;

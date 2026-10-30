import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Product master record: one document per distinct `product_id` ever seen in an
 * uploaded sales file (when a file has only product_name, the validator copies
 * it into product_id, so the name acts as the id).
 *
 * Records are created automatically by the upload worker the first time an id
 * appears (see masterData.service.js). An existing record is never modified by
 * a later upload; it is only linked to the new sales rows.
 */
const productSchema = new Schema({
  productId: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  category: { type: String, default: 'Uncategorized' },
  // Upload that first brought this product in (used for the per-upload "new products" count).
  createdByBatchId: { type: Schema.Types.ObjectId, ref: 'UploadBatch', index: true },
  createdAt: { type: Date, default: Date.now },
});

const Product = mongoose.models.Product || mongoose.model('Product', productSchema);

export default Product;

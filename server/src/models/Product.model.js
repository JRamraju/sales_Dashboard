import mongoose from 'mongoose';

const { Schema } = mongoose;

/** Same idea as Customer: one document per distinct product_id across all files. */
const productSchema = new Schema({
  productId: { type: String, required: true, unique: true },
  productName: { type: String, required: true },
  category: { type: String, default: 'Uncategorized' },
  firstBatchId: { type: Schema.Types.ObjectId, ref: 'UploadBatch', required: true, index: true },
  createdAt: { type: Date, default: Date.now },
});

const Product = mongoose.models.Product || mongoose.model('Product', productSchema);

export default Product;

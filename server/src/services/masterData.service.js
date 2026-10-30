import Customer from '../models/Customer.model.js';
import Product from '../models/Product.model.js';
import SalesRecord from '../models/SalesRecord.model.js';

/**
 * Customer / product master data for one upload.
 *
 * For every validated sales row the upload worker needs the row linked to a
 * Customer and a Product record. This linker does that in bulk, per chunk:
 *
 *   1. Look up which of the chunk's customer / product ids already exist.
 *   2. Create the ones that do not (one bulk upsert, race-safe).
 *   3. Put `customerRef` / `productRef` (the master record's _id) on each row.
 *
 * Existing records are only linked, never changed. The sales row keeps its own
 * customerId / customerName / productId / productName / category exactly as
 * before, so every analytics query works unchanged.
 *
 * Ids resolved once are remembered for the rest of the upload, so a file with
 * 100,000 rows and 5,000 customers does about 5,000 lookups in total, not
 * 100,000.
 *
 * @param {import('mongoose').Types.ObjectId} batchObjectId  the upload being processed
 * @param {{ CustomerModel?: object, ProductModel?: object }} [models]  overridable for tests
 */
export function createMasterDataLinker(batchObjectId, models = {}) {
  const CustomerModel = models.CustomerModel ?? Customer;
  const ProductModel = models.ProductModel ?? Product;

  const customerRefs = new Map(); // customerId -> Customer _id
  const productRefs = new Map(); //  productId  -> Product _id
  let ready = null;

  /** Waits for the unique indexes, which the "create if missing" step relies on. */
  const ensureReady = () => {
    ready ??= Promise.all([CustomerModel.init?.(), ProductModel.init?.()]);
    return ready;
  };

  /**
   * Fills `refs` with an _id for every key in `wanted`, creating the records
   * that do not exist yet.
   *
   * @param {object} Model
   * @param {string} keyField   'customerId' | 'productId'
   * @param {Map<string, object>} refs    cache of key -> _id (updated in place)
   * @param {Map<string, object>} wanted  key -> the other fields to store if the record must be
   *                                      created (the key itself comes from the upsert filter)
   */
  async function resolve(Model, keyField, refs, wanted) {
    const unknown = [...wanted.keys()].filter((key) => !refs.has(key));
    if (unknown.length === 0) return;

    const lookup = async (keys) => {
      const rows = await Model.find({ [keyField]: { $in: keys } })
        .select(`_id ${keyField}`)
        .lean();
      for (const row of rows) refs.set(row[keyField], row._id);
    };

    // 1. Existing records are just mapped.
    await lookup(unknown);

    // 2. Anything still unknown is new. $setOnInsert + upsert means that if
    //    another worker created the same id a moment ago, nothing is
    //    overwritten and no duplicate is made (the unique index guarantees it).
    const toCreate = unknown.filter((key) => !refs.has(key));
    if (toCreate.length === 0) return;

    const createdAt = new Date();
    await Model.bulkWrite(
      toCreate.map((key) => ({
        updateOne: {
          filter: { [keyField]: key },
          update: {
            $setOnInsert: { ...wanted.get(key), createdByBatchId: batchObjectId, createdAt },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );

    // 3. Read the ids back (covers both the records just created and the ones
    //    another worker created first).
    await lookup(toCreate);

    const missing = toCreate.filter((key) => !refs.has(key));
    if (missing.length > 0) {
      throw new Error(`Could not create ${keyField} record(s): ${missing.slice(0, 5).join(', ')}`);
    }
  }

  /**
   * Adds `customerRef` and `productRef` to every row (the rows are changed in
   * place and also returned). Rows must already be validated: each one has a
   * customerId, customerName, productId, productName and category.
   */
  async function attach(rows) {
    await ensureReady();

    const customers = new Map();
    const products = new Map();
    for (const row of rows) {
      // First occurrence in the file wins, as it does for the analytics queries.
      if (!customers.has(row.customerId)) {
        customers.set(row.customerId, { name: row.customerName });
      }
      if (!products.has(row.productId)) {
        products.set(row.productId, { name: row.productName, category: row.category });
      }
    }

    await Promise.all([
      resolve(CustomerModel, 'customerId', customerRefs, customers),
      resolve(ProductModel, 'productId', productRefs, products),
    ]);

    for (const row of rows) {
      row.customerRef = customerRefs.get(row.customerId);
      row.productRef = productRefs.get(row.productId);
    }
    return rows;
  }

  /**
   * How many customers / products this upload created, and how many it only
   * linked. "Created" is counted from the database (by createdByBatchId), so
   * the figure stays right even if BullMQ re-runs a stalled job.
   */
  async function summary() {
    const [newCustomers, newProducts] = await Promise.all([
      CustomerModel.countDocuments({ createdByBatchId: batchObjectId }),
      ProductModel.countDocuments({ createdByBatchId: batchObjectId }),
    ]);
    return {
      newCustomers,
      newProducts,
      existingCustomers: Math.max(0, customerRefs.size - newCustomers),
      existingProducts: Math.max(0, productRefs.size - newProducts),
    };
  }

  return { attach, summary };
}

const PRUNE_CHUNK = 10_000;

/**
 * After a file is deleted: removes the customer / product records that no
 * remaining sales row points to, so the two collections always mirror what the
 * loaded files contain. A customer that another file still uses is kept.
 * (Without this, deleting a file and uploading it again would report 0 new
 * customers, because the old records would still be there.)
 *
 * Call it AFTER the file's sales rows have been deleted.
 *
 * @param {{ customerRefs?: object[], productRefs?: object[] }} refs  _ids the deleted file's rows pointed to
 * @param {{ CustomerModel?: object, ProductModel?: object, SalesRecordModel?: object }} [models]
 * @returns {Promise<{ removedCustomers: number, removedProducts: number }>}
 */
export async function removeUnreferencedMasters({ customerRefs = [], productRefs = [] }, models = {}) {
  const CustomerModel = models.CustomerModel ?? Customer;
  const ProductModel = models.ProductModel ?? Product;
  const SalesRecordModel = models.SalesRecordModel ?? SalesRecord;

  const prune = async (Model, refs, field) => {
    let removed = 0;
    for (let i = 0; i < refs.length; i += PRUNE_CHUNK) {
      const slice = refs.slice(i, i + PRUNE_CHUNK);
      const stillUsed = new Set(
        (await SalesRecordModel.distinct(field, { [field]: { $in: slice } })).map(String)
      );
      const unused = slice.filter((id) => !stillUsed.has(String(id)));
      if (unused.length > 0) {
        const result = await Model.deleteMany({ _id: { $in: unused } });
        removed += result.deletedCount ?? 0;
      }
    }
    return removed;
  };

  const [removedCustomers, removedProducts] = await Promise.all([
    prune(CustomerModel, customerRefs, 'customerRef'),
    prune(ProductModel, productRefs, 'productRef'),
  ]);
  return { removedCustomers, removedProducts };
}

/** One-line remark for the upload result, e.g. "Created 12 new customers and 5 new products ...". */
export function describeMasterData({ newCustomers, newProducts, existingCustomers, existingProducts }) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts = [];

  if (newCustomers > 0 || newProducts > 0) {
    parts.push(
      `Created ${plural(newCustomers, 'new customer')} and ${plural(newProducts, 'new product')} that were not in the system yet.`
    );
  }
  if (existingCustomers > 0 || existingProducts > 0) {
    parts.push(
      `Linked ${plural(existingCustomers, 'existing customer')} and ${plural(existingProducts, 'existing product')}.`
    );
  }
  return parts.join(' ');
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createMasterDataLinker, describeMasterData } from '../src/services/masterData.service.js';

const { ObjectId } = mongoose.Types;

/**
 * A tiny in-memory stand-in for a Mongoose model with a unique key field.
 * It supports exactly what the linker uses: find().select().lean(),
 * bulkWrite() of upserting updateOne ops, and countDocuments().
 */
function fakeModel(keyField, seed = []) {
  const rows = seed.map((row) => ({ _id: new ObjectId(), ...row }));
  const calls = { find: 0, bulkWrite: 0, bulkOps: 0 };

  return {
    rows,
    calls,
    find(query) {
      calls.find += 1;
      const keys = query[keyField].$in;
      const hits = rows.filter((row) => keys.includes(row[keyField])).map((row) => ({ ...row }));
      const chain = { select: () => chain, lean: async () => hits };
      return chain;
    },
    async bulkWrite(ops) {
      calls.bulkWrite += 1;
      for (const { updateOne } of ops) {
        calls.bulkOps += 1;
        const key = updateOne.filter[keyField];
        if (!rows.some((row) => row[keyField] === key)) {
          rows.push({ _id: new ObjectId(), [keyField]: key, ...updateOne.update.$setOnInsert });
        }
      }
    },
    async countDocuments(query) {
      return rows.filter((row) => String(row.createdByBatchId) === String(query.createdByBatchId)).length;
    },
  };
}

const saleRow = (over = {}) => ({
  orderId: 'ORD-1',
  customerId: 'CUST-1',
  customerName: 'Asha Traders',
  productId: 'PROD-1',
  productName: 'Ergonomic Chair',
  category: 'Furniture',
  quantity: 1,
  unitPrice: 100,
  totalRevenue: 100,
  ...over,
});

const setup = ({ customers = [], products = [] } = {}) => {
  const batchId = new ObjectId();
  const CustomerModel = fakeModel('customerId', customers);
  const ProductModel = fakeModel('productId', products);
  const linker = createMasterDataLinker(batchId, { CustomerModel, ProductModel });
  return { batchId, CustomerModel, ProductModel, linker };
};

test('customers and products missing from the system are created', async () => {
  const { linker, CustomerModel, ProductModel, batchId } = setup();

  await linker.attach([
    saleRow(),
    saleRow({ orderId: 'ORD-2', customerId: 'CUST-2', customerName: 'Ravi Stores', productId: 'PROD-2', productName: 'Desk Lamp', category: 'Lighting' }),
  ]);

  assert.deepEqual(CustomerModel.rows.map((r) => [r.customerId, r.name]), [['CUST-1', 'Asha Traders'], ['CUST-2', 'Ravi Stores']]);
  assert.deepEqual(ProductModel.rows.map((r) => [r.productId, r.name, r.category]), [['PROD-1', 'Ergonomic Chair', 'Furniture'], ['PROD-2', 'Desk Lamp', 'Lighting']]);
  assert.ok(CustomerModel.rows.every((r) => String(r.createdByBatchId) === String(batchId)));
});

test('existing customers and products are linked, not duplicated or changed', async () => {
  const { linker, CustomerModel, ProductModel } = setup({
    customers: [{ customerId: 'CUST-1', name: 'Original Name' }],
    products: [{ productId: 'PROD-1', name: 'Original Chair', category: 'Office' }],
  });
  const [existingCustomer] = CustomerModel.rows;
  const [existingProduct] = ProductModel.rows;

  const [row] = await linker.attach([saleRow()]);

  assert.equal(CustomerModel.rows.length, 1);
  assert.equal(ProductModel.rows.length, 1);
  assert.equal(CustomerModel.rows[0].name, 'Original Name');
  assert.equal(ProductModel.rows[0].category, 'Office');
  assert.equal(String(row.customerRef), String(existingCustomer._id));
  assert.equal(String(row.productRef), String(existingProduct._id));
  assert.equal(CustomerModel.calls.bulkWrite, 0); // nothing to create
});

test('new records are linked to the sales rows, and rows of one customer share a link', async () => {
  const { linker, CustomerModel, ProductModel } = setup();

  const rows = await linker.attach([
    saleRow(),
    saleRow({ orderId: 'ORD-2', productId: 'PROD-2', productName: 'Desk Lamp' }),
    saleRow({ orderId: 'ORD-3', customerId: 'CUST-9', customerName: 'New Buyer' }),
  ]);

  const customerOf = (id) => String(CustomerModel.rows.find((r) => r.customerId === id)._id);
  const productOf = (id) => String(ProductModel.rows.find((r) => r.productId === id)._id);

  assert.equal(String(rows[0].customerRef), customerOf('CUST-1'));
  assert.equal(String(rows[1].customerRef), customerOf('CUST-1'));
  assert.equal(String(rows[2].customerRef), customerOf('CUST-9'));
  assert.equal(String(rows[1].productRef), productOf('PROD-2'));
  assert.equal(CustomerModel.rows.length, 2);
  assert.equal(ProductModel.rows.length, 2);
});

test('the first row of an id decides the stored name and category', async () => {
  const { linker, ProductModel } = setup();
  await linker.attach([
    saleRow({ productName: 'First Name', category: 'First Cat' }),
    saleRow({ orderId: 'ORD-2', productName: 'Second Name', category: 'Second Cat' }),
  ]);
  assert.deepEqual([ProductModel.rows[0].name, ProductModel.rows[0].category], ['First Name', 'First Cat']);
});

test('ids seen in an earlier chunk are remembered and cost no database calls', async () => {
  const { linker, CustomerModel, ProductModel } = setup();
  await linker.attach([saleRow()]);
  const before = [CustomerModel.calls.find, CustomerModel.calls.bulkWrite, ProductModel.calls.find, ProductModel.calls.bulkWrite];

  const [row] = await linker.attach([saleRow({ orderId: 'ORD-77' })]);

  assert.deepEqual(
    [CustomerModel.calls.find, CustomerModel.calls.bulkWrite, ProductModel.calls.find, ProductModel.calls.bulkWrite],
    before
  );
  assert.ok(row.customerRef && row.productRef);
});

test('only the ids that are missing are written', async () => {
  const { linker, CustomerModel } = setup({ customers: [{ customerId: 'CUST-1', name: 'Known' }] });
  await linker.attach([saleRow(), saleRow({ customerId: 'CUST-2', customerName: 'Fresh' })]);
  assert.equal(CustomerModel.calls.bulkOps, 1);
});

test('summary separates created records from linked ones', async () => {
  const { linker } = setup({
    customers: [{ customerId: 'CUST-1', name: 'Known' }],
    products: [{ productId: 'PROD-1', name: 'Known Chair', category: 'Office' }],
  });

  await linker.attach([
    saleRow(),
    saleRow({ orderId: 'ORD-2', customerId: 'CUST-2', customerName: 'Fresh', productId: 'PROD-2', productName: 'Fresh Lamp' }),
    saleRow({ orderId: 'ORD-3', customerId: 'CUST-3', customerName: 'Fresher', productId: 'PROD-1' }),
  ]);

  assert.deepEqual(await linker.summary(), {
    newCustomers: 2,
    newProducts: 1,
    existingCustomers: 1,
    existingProducts: 1,
  });
});

test('summary still counts correctly when a stalled job is run again', async () => {
  const { linker: firstRun, CustomerModel, ProductModel, batchId } = setup();
  await firstRun.attach([saleRow()]);

  // Same batch, new linker (a BullMQ re-run): everything it finds already exists.
  const secondRun = createMasterDataLinker(batchId, { CustomerModel, ProductModel });
  await secondRun.attach([saleRow()]);

  assert.deepEqual(await secondRun.summary(), {
    newCustomers: 1,
    newProducts: 1,
    existingCustomers: 0,
    existingProducts: 0,
  });
  assert.equal(CustomerModel.rows.length, 1);
});

test('the upload note says what was created and what was linked', () => {
  assert.equal(
    describeMasterData({ newCustomers: 1, newProducts: 2, existingCustomers: 0, existingProducts: 3 }),
    'Created 1 new customer and 2 new products that were not in the system yet. Linked 0 existing customers and 3 existing products.'
  );
  assert.equal(
    describeMasterData({ newCustomers: 0, newProducts: 0, existingCustomers: 4, existingProducts: 1 }),
    'Linked 4 existing customers and 1 existing product.'
  );
  assert.equal(describeMasterData({ newCustomers: 0, newProducts: 0, existingCustomers: 0, existingProducts: 0 }), '');
});

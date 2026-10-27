/**
 * Maps fuzzy CSV/Excel column names to the strict canonical keys used by the
 * validation schema, e.g. "Order Date", "order_date" and "Date" all become
 * `orderDate`.
 *
 * Matching ignores case, spaces, underscores, dashes and any other
 * punctuation, so "Unit Price", "unit_price" and "UnitPrice" are equivalent.
 */
const HEADER_ALIASES = {
  orderId: ['orderid', 'ordernumber', 'orderno', 'ordernum', 'invoiceid', 'invoiceno'],
  orderDate: ['orderdate', 'date', 'saledate', 'purchasedate', 'transactiondate', 'orderdatetime'],
  customerId: ['customerid', 'custid', 'customercode', 'clientid'],
  customerName: ['customername', 'customer', 'client', 'clientname', 'buyer', 'buyername'],
  productId: ['productid', 'sku', 'skuid', 'productcode', 'itemid'],
  productName: ['productname', 'product', 'item', 'itemname'],
  category: ['category', 'productcategory', 'categoryname'],
  region: ['region', 'area', 'zone', 'territory'],
  quantity: ['quantity', 'qty', 'units', 'unitssold', 'quantitysold'],
  unitPrice: ['unitprice', 'price', 'priceperunit', 'rate', 'sellingprice'],
  discount: ['discount', 'discountamount', 'disc'],
  totalAmount: ['totalamount', 'total', 'amount', 'totalrevenue', 'revenue', 'linetotal', 'netrevenue', 'totalprice'],
};

export const CANONICAL_FIELDS = Object.keys(HEADER_ALIASES);

const LOOKUP = new Map();
for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
  LOOKUP.set(canonical.toLowerCase(), canonical);
  for (const alias of aliases) LOOKUP.set(alias, canonical);
}

/**
 * Returns the canonical key for a raw column header, or the trimmed original
 * header when it is not recognised (unknown columns are ignored downstream).
 */
export function normalizeHeader(header) {
  if (header === null || header === undefined) return '';
  const cleaned = String(header).replace(/^﻿/, '').trim();
  const lookupKey = cleaned.toLowerCase().replace(/[^a-z0-9]/g, '');
  return LOOKUP.get(lookupKey) ?? cleaned;
}

/**
 * Given already-normalised headers, returns a list of human readable names
 * (snake_case, as in the sample data spec) for required columns that are
 * absent. An empty array means the file has everything it needs.
 *
 * Required: order_id, order_date, customer_id, quantity,
 *           product_id or product_name, unit_price or total_amount.
 * Optional: customer_name, category, region, discount (defaults are applied).
 */
export function findMissingRequiredColumns(normalizedHeaders) {
  const present = new Set(normalizedHeaders);
  const missing = [];

  if (!present.has('orderId')) missing.push('order_id');
  if (!present.has('orderDate')) missing.push('order_date');
  if (!present.has('customerId')) missing.push('customer_id');
  if (!present.has('quantity')) missing.push('quantity');
  if (!present.has('productId') && !present.has('productName')) {
    missing.push('product_id (or product_name)');
  }
  if (!present.has('unitPrice') && !present.has('totalAmount')) {
    missing.push('unit_price (or total_amount)');
  }

  return missing;
}

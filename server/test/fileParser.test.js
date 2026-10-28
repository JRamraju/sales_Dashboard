import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRowSource, parseFile, FileParseError } from '../src/services/fileParser.service.js';

let dir;
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-test-')); });
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const write = (name, text) => { const p = path.join(dir, name); fs.writeFileSync(p, text); return p; };
const HEAD = 'order_id,order_date,customer_id,product_name,quantity,unit_price';

test('semicolon CSV with a BOM and a blank line keeps real row numbers', async () => {
  const p = write('semi.csv', '﻿order_id;order_date;customer_id;product_name;quantity;unit_price\r\nA1;2026-01-05;C1;Pen;2;5.5\r\n\r\nA2;2026-01-06;C2;Ink;1;9\r\n');
  const rows = await parseFile(p, 'semi.csv');
  assert.deepEqual(rows.map((r) => [r.rowNumber, r.data.orderId]), [[2, 'A1'], [4, 'A2']]);
});

test('quoted commas stay inside the cell and headers are mapped from aliases', async () => {
  const p = write('quoted.csv', 'Order ID,Date,Customer ID,Product,Qty,Price\n"A,1",2026-01-05,C1,"Pen, blue",2,5.5\n');
  const [row] = await parseFile(p, 'quoted.csv');
  assert.equal(row.data.orderId, 'A,1');
  assert.equal(row.data.productName, 'Pen, blue');
});

test('file-level problems are FileParseErrors raised before any row is read', async () => {
  await assert.rejects(openRowSource(write('empty.csv', ''), 'empty.csv'), (e) => e instanceof FileParseError && /empty/.test(e.message));
  await assert.rejects(openRowSource(write('cols.csv', 'order_id,order_date\nA,2026-01-01\n'), 'cols.csv'), /Missing required column/);
  await assert.rejects(parseFile(write('head.csv', `${HEAD}\n`), 'head.csv'), /no data rows/);
  await assert.rejects(openRowSource(write('x.txt', 'a'), 'x.txt'), /Unsupported file type/);
});

test('both file types expose rows as an ASYNC iterable (the worker calls rows[Symbol.asyncIterator])', async () => {
  const csv = await openRowSource(write('a.csv', `${HEAD}\nA1,2026-01-05,C1,Pen,2,5.5\n`), 'a.csv');
  assert.equal(typeof csv.rows[Symbol.asyncIterator], 'function');
  csv.close();

  const xlsx = fileURLToPath(new URL('../../sample-data/MOCK_DATA(1).xlsx', import.meta.url));
  if (!fs.existsSync(xlsx)) return; // sample data not present
  const source = await openRowSource(xlsx, 'MOCK_DATA(1).xlsx');
  assert.equal(typeof source.rows[Symbol.asyncIterator], 'function');
  const first = await source.rows[Symbol.asyncIterator]().next();
  assert.equal(first.value.rowNumber, 2);
  assert.equal(source.totalRows, 1000);
});

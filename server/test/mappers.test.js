import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toClientErrorLog, toClientBatch, buildBatchSnapshot } from '../src/utils/uploadMappers.util.js';
import { redactedRedisUrl, isRedisConnectionError } from '../src/config/redis.config.js';

const doc = (over = {}) => ({
  _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', fileName: 'x.csv', status: 'completed', totalRowsRead: 10,
  validRowsInserted: 8, invalidRowsCount: 2, errorLogs: [{ rowNumber: 3, reason: 'Missing order_date', field: 'order_date' }],
  ...over,
});

test('error logs get the fields the UI renders', () => {
  assert.deepEqual(toClientErrorLog({ rowNumber: 3, reason: 'bad', field: 'quantity' }), { rowNumber: 3, field: 'quantity', message: 'bad', reason: 'bad' });
  assert.equal(toClientErrorLog({ rowNumber: 9, reason: 'old log without a field' }).field, 'row');
});

test('toClientBatch adds batchId / totalRows and only maps errorLogs when loaded', () => {
  const full = toClientBatch(doc());
  assert.equal(full.batchId, 'aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(full.totalRows, 10);
  assert.equal(full.errorLogs[0].message, 'Missing order_date');
  const { errorLogs, ...listRow } = doc();
  assert.equal('errorLogs' in toClientBatch(listRow), false);
});

test('snapshot of a finished batch replays upload:completed', () => {
  const s = buildBatchSnapshot(doc({ dateOrder: 'mdy', notes: ['n'] }));
  assert.equal(s.event, 'upload:completed');
  assert.deepEqual([s.payload.inserted, s.payload.skipped, s.payload.totalRows, s.payload.dateOrder], [8, 2, 10, 'mdy']);
  assert.equal(s.payload.errorLogs[0].message, 'Missing order_date');
  assert.equal(s.payload.errorLogsTruncated, true); // 2 skipped, 1 logged
});

test('snapshots for failed, processing and queued batches', () => {
  const failed = buildBatchSnapshot(doc({ status: 'failed', failureReason: 'Missing columns' }));
  assert.deepEqual([failed.event, failed.payload.error, failed.payload.reason], ['upload:failed', 'Missing columns', 'Missing columns']);
  const running = buildBatchSnapshot(doc({ status: 'processing', progress: 40, processedRows: 4 }));
  assert.deepEqual([running.event, running.payload.progress], ['upload:progress', 40]);
  assert.equal(buildBatchSnapshot(doc({ status: 'queued' })), null);
  assert.equal(buildBatchSnapshot(null), null);
});

test('redis URLs are logged without their password', () => {
  const shown = redactedRedisUrl('rediss://default:s3cret@cache.example.com:6380');
  assert.ok(!shown.includes('s3cret') && shown.includes('***') && shown.includes('cache.example.com'));
  assert.equal(redactedRedisUrl('not a url'), 'the configured REDIS_URL');
});

test('redis connection errors are recognised', () => {
  assert.equal(isRedisConnectionError(new Error('connect ETIMEDOUT')), true);
  assert.equal(isRedisConnectionError(Object.assign(new Error('x'), { code: 'ECONNRESET' })), true);
  assert.equal(isRedisConnectionError(new Error('Connection is closed.')), true);
  assert.equal(isRedisConnectionError(new Error('ERR wrong number of arguments')), false);
});

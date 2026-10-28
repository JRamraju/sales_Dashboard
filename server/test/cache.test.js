import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TtlCache } from '../src/utils/cache.util.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('caches a result and serves it without calling the loader again', async () => {
  const cache = new TtlCache({ ttlMs: 1000 });
  let calls = 0;
  const load = async () => ++calls;
  assert.equal(await cache.wrap('k', load), 1);
  assert.equal(await cache.wrap('k', load), 1);
  assert.equal(calls, 1);
});

test('identical requests that arrive together share one load', async () => {
  const cache = new TtlCache({ ttlMs: 1000 });
  let calls = 0;
  const load = async () => { calls += 1; await sleep(20); return 'v'; };
  const results = await Promise.all([cache.wrap('k', load), cache.wrap('k', load), cache.wrap('k', load)]);
  assert.deepEqual(results, ['v', 'v', 'v']);
  assert.equal(calls, 1);
});

test('entries expire', async () => {
  const cache = new TtlCache({ ttlMs: 20 });
  let calls = 0;
  await cache.wrap('k', async () => ++calls);
  await sleep(40);
  await cache.wrap('k', async () => ++calls);
  assert.equal(calls, 2);
});

test('invalidatePrefix removes a batch and stops an in-flight load from storing stale data', async () => {
  const cache = new TtlCache({ ttlMs: 1000 });
  await cache.wrap('b1:overview', async () => 'old');
  await cache.wrap('b2:overview', async () => 'other');
  const loading = cache.wrap('b1:trends', async () => { await sleep(30); return 'stale'; });
  cache.invalidatePrefix('b1:');
  assert.equal(await loading, 'stale'); // the caller still gets its answer...
  assert.equal(await cache.wrap('b1:trends', async () => 'fresh'), 'fresh'); // ...but it was not kept
  assert.equal(await cache.wrap('b1:overview', async () => 'reloaded'), 'reloaded');
  assert.equal(await cache.wrap('b2:overview', async () => 'x'), 'other'); // other batches untouched
});

test('the least recently used entry is evicted first', async () => {
  const cache = new TtlCache({ ttlMs: 1000, maxEntries: 2 });
  await cache.wrap('a', async () => 1);
  await cache.wrap('b', async () => 2);
  await cache.wrap('a', async () => 99); // touch a
  await cache.wrap('c', async () => 3); // evicts b
  assert.equal(cache.size, 2);
  assert.equal(await cache.wrap('a', async () => 'reloaded'), 1);
  assert.equal(await cache.wrap('b', async () => 'reloaded'), 'reloaded');
});

test('a failed load is not cached', async () => {
  const cache = new TtlCache({ ttlMs: 1000 });
  await assert.rejects(cache.wrap('k', async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await cache.wrap('k', async () => 'ok'), 'ok');
});

test('a TTL of 0 disables caching', async () => {
  const cache = new TtlCache({ ttlMs: 0 });
  let calls = 0;
  await cache.wrap('k', async () => ++calls);
  await cache.wrap('k', async () => ++calls);
  assert.equal(calls, 2);
});

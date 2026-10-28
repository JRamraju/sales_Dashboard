import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  redisStatus,
  noteRedisError,
  noteRedisConnected,
  resetRedisStatus,
  logBullError,
  REMINDER_INTERVAL_MS,
} from '../src/config/redis.config.js';

let warn;
let log;
let error;

beforeEach(() => {
  resetRedisStatus();
  warn = mock.method(console, 'warn', () => {});
  log = mock.method(console, 'log', () => {});
  error = mock.method(console, 'error', () => {});
});
afterEach(() => mock.restoreAll());

const timeout = () => Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });

test('an outage logs once when it starts, no matter how many connections report it', () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 12; i += 1) noteRedisError(timeout(), t0 + i * 1000);

  assert.equal(redisStatus.state, 'reconnecting');
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /connection problem: connect ETIMEDOUT/);
});

test('a reminder with the hidden-error count is printed every 30 seconds', () => {
  const t0 = 1_000_000;
  noteRedisError(timeout(), t0);
  for (let i = 1; i <= 10; i += 1) noteRedisError(timeout(), t0 + i * 1000); // 10 hidden
  assert.equal(warn.mock.callCount(), 1);

  noteRedisError(timeout(), t0 + REMINDER_INTERVAL_MS); // 11th repeat, reminder is due
  assert.equal(warn.mock.callCount(), 2);
  assert.match(warn.mock.calls[1].arguments[0], /still reconnecting after 30s/);
  assert.match(warn.mock.calls[1].arguments[0], /11 repeated error\(s\) not shown/);

  noteRedisError(timeout(), t0 + REMINDER_INTERVAL_MS + 1000); // counter restarted
  assert.equal(warn.mock.callCount(), 2);
});

test('recovery is announced once, with how long the outage lasted', () => {
  const t0 = 1_000_000;
  noteRedisError(timeout(), t0);
  noteRedisConnected(t0 + 38_000);

  assert.equal(redisStatus.state, 'connected');
  assert.equal(log.mock.callCount(), 1);
  assert.match(log.mock.calls[0].arguments[0], /connection restored after 38s/);

  noteRedisConnected(t0 + 40_000); // already connected: nothing more to say
  assert.equal(log.mock.callCount(), 1);
});

test('a first successful connection is silent', () => {
  assert.equal(redisStatus.state, 'connecting');
  noteRedisConnected();
  assert.equal(redisStatus.state, 'connected');
  assert.equal(log.mock.callCount(), 0);
});

test('a second outage after recovery is reported again', () => {
  noteRedisError(timeout(), 1_000);
  noteRedisConnected(5_000);
  noteRedisError(timeout(), 100_000);
  assert.equal(warn.mock.callCount(), 2);
  assert.equal(redisStatus.state, 'reconnecting');
});

test('BullMQ errors: network errors go to the shared tracker, others are logged as before', () => {
  const onWorkerError = logBullError('worker');

  onWorkerError(timeout());
  assert.equal(redisStatus.state, 'reconnecting');
  assert.equal(error.mock.callCount(), 0); // no more "[worker] error: connect ETIMEDOUT"

  onWorkerError(new Error('ERR something else'));
  assert.equal(error.mock.callCount(), 1);
  assert.equal(error.mock.calls[0].arguments[0], '[worker] error:');
  assert.equal(error.mock.calls[0].arguments[1], 'ERR something else');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateForecast, fillMissingMonths, MAX_HORIZON } from '../src/services/forecast.service.js';

const series = (values, start = '2026-01') =>
  values.map((revenue, i) => {
    const d = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5)) - 1 + i, 1));
    return { month: d.toISOString().slice(0, 7), revenue };
  });

test('no history', () => {
  const f = calculateForecast([]);
  assert.equal(f.method, 'insufficient_data');
  assert.deepEqual(f.forecast, []);
});

test('under 3 months falls back to a moving average, with no range', () => {
  const f = calculateForecast(series([100, 200]), 2);
  assert.equal(f.method, 'sma');
  assert.equal(f.trendDirection, 'upward');
  assert.equal(f.forecast.length, 2);
  assert.equal(f.forecast[0].lower, null);
});

test('a perfectly linear history gives slope, R² = 1 and a zero-width range', () => {
  const f = calculateForecast(series([100, 200, 300, 400]), 2);
  assert.equal(f.slope, 100);
  assert.equal(f.rSquared, 1);
  assert.equal(f.confidence, 'High');
  assert.equal(f.trendDirection, 'upward');
  // 70% x line(4)=500 + 30% x WMA(200,300,400)=333.33
  assert.equal(f.forecast[0].revenue, 450);
  assert.equal(f.forecast[0].lower, f.forecast[0].upper);
  assert.deepEqual(f.forecast.map((p) => p.month), ['2026-05', '2026-06']);
});

test('a constant history is "flat", not upward', () => {
  const f = calculateForecast(series([100, 100, 100, 100, 100]), 3);
  assert.equal(f.trendDirection, 'flat');
  assert.equal(f.trend, 'flat');
});

test('a noisy history has a range that contains the forecast and widens with distance', () => {
  const f = calculateForecast(series([100, 300, 150, 350, 120, 280]), 6);
  for (const p of f.forecast) {
    assert.ok(p.lower <= p.revenue && p.revenue <= p.upper && p.lower >= 0);
  }
  const width = (p) => p.upper - p.lower;
  assert.ok(width(f.forecast[5]) > width(f.forecast[0]));
  assert.equal(f.intervalConfidence, 0.95);
});

test('forecast values never go below zero', () => {
  const f = calculateForecast(series([1000, 600, 300, 100]), 12);
  assert.ok(f.forecast.every((p) => p.revenue >= 0 && p.lower >= 0));
});

test('horizon is clamped', () => {
  assert.equal(calculateForecast(series([1, 2, 3, 4]), 999).forecast.length, MAX_HORIZON);
  assert.equal(calculateForecast(series([1, 2, 3, 4]), 'x').forecast.length, 3);
});

test('months without sales between the first and last are filled with 0', () => {
  const filled = fillMissingMonths([{ month: '2026-01', revenue: 5 }, { month: '2026-04', revenue: 9 }]);
  assert.deepEqual(filled.map((p) => [p.month, p.revenue]), [['2026-01', 5], ['2026-02', 0], ['2026-03', 0], ['2026-04', 9]]);
});

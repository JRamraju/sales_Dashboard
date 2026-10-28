import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMatch, previousPeriodOf, computeRevenueGrowth, fillTrendGaps, shapeBreakdowns,
} from '../src/services/kpi.service.js';

const ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

test('buildMatch casts batchId and only adds the filters that were given', () => {
  const m = buildMatch({ batchId: ID, categories: ['A', 'B'], regions: [] });
  assert.equal(String(m.batchId), ID);
  assert.deepEqual(m.category, { $in: ['A', 'B'] });
  assert.equal('region' in m, false);
  assert.equal('orderDate' in m, false);
});

test('previousPeriodOf is the window of equal length right before the range', () => {
  const { previousStart, previousEnd } = previousPeriodOf({
    startDate: new Date('2026-03-01T00:00:00.000Z'),
    endDate: new Date('2026-03-31T23:59:59.999Z'),
  });
  assert.equal(previousStart.toISOString(), '2026-01-29T00:00:00.000Z');
  assert.equal(previousEnd.toISOString(), '2026-02-28T23:59:59.999Z');
});

test('growth against the previous period', () => {
  const filters = { startDate: new Date('2026-03-01T00:00:00Z'), endDate: new Date('2026-03-31T23:59:59.999Z') };
  const g = computeRevenueGrowth(filters, 120, [], 100);
  assert.equal(g.basis, 'previous_period');
  assert.equal(g.percent, 20);
  assert.equal(computeRevenueGrowth(filters, 120, [], 0).percent, null); // nothing to compare with
});

test('growth of the latest month against the month before it', () => {
  const monthly = [{ _id: '2025-12', revenue: 100 }, { _id: '2026-01', revenue: 150 }];
  const g = computeRevenueGrowth({}, 250, monthly, 0);
  assert.equal(g.basis, 'latest_month_vs_prior_month');
  assert.equal(g.percent, 50);
  assert.deepEqual(g.previousPeriod, { month: '2025-12' });
  assert.equal(computeRevenueGrowth({}, 150, [{ _id: '2026-01', revenue: 150 }], 0).percent, null);
  assert.equal(computeRevenueGrowth({}, 0, [], 0).percent, null);
});

test('fillTrendGaps inserts zero buckets for months, days and weeks', () => {
  const p = (date, revenue = 10) => ({ date, revenue, orders: 1, averageOrderValue: revenue });
  const months = fillTrendGaps([p('2026-01'), p('2026-04')], 'month');
  assert.deepEqual(months.map((x) => [x.date, x.revenue]), [['2026-01', 10], ['2026-02', 0], ['2026-03', 0], ['2026-04', 10]]);
  assert.equal(fillTrendGaps([p('2026-01-01'), p('2026-01-04')], 'day').length, 4);
  assert.deepEqual(fillTrendGaps([p('2026-01-05'), p('2026-01-19')], 'week').map((x) => x.date), ['2026-01-05', '2026-01-12', '2026-01-19']);
  assert.equal(fillTrendGaps([p('2026-01')], 'month').length, 1);
});

test('fillTrendGaps leaves a series that is too long to chart alone', () => {
  const pts = [{ date: '2020-01', revenue: 1, orders: 1 }, { date: '2026-01', revenue: 1, orders: 1 }];
  assert.equal(fillTrendGaps(pts, 'month', 10).length, 2);
});

test('shapeBreakdowns computes shares and emits the names the client reads', () => {
  const out = shapeBreakdowns({
    totals: [{ revenue: 200 }],
    topProducts: [{ _id: 'P1', productName: 'Pen', category: 'Stationery', unitsSold: 3, revenue: 50 }],
    topCustomers: [{ _id: 'C1', customerName: 'Acme', totalSpend: 100, totalOrders: 4, lastPurchaseDate: new Date('2026-01-01') }],
    categoryDistribution: [{ _id: 'Stationery', revenue: 150 }, { _id: 'Other', revenue: 50 }],
    regionDistribution: [{ _id: 'West', revenue: 200 }],
  });
  assert.equal(out.topProducts[0].percentageOfSales, 25);
  assert.equal(out.topProducts[0].totalRevenue, 50);
  assert.equal(out.topCustomers[0].averageOrderValue, 25);
  assert.deepEqual(out.categoryDistribution.map((c) => [c.name, c.percentage]), [['Stationery', 75], ['Other', 25]]);
  assert.equal(out.regionDistribution[0].region, 'West');
  assert.deepEqual(shapeBreakdowns({}).topProducts, []); // empty batch
});

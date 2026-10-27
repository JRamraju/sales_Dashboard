import mongoose from 'mongoose';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import SalesRecord from '../models/SalesRecord.model.js';

dayjs.extend(utc);

const { ObjectId } = mongoose.Types;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const percentOf = (part, whole) => (whole > 0 ? round2((part / whole) * 100) : 0);

export const GRANULARITIES = ['day', 'week', 'month'];

/**
 * Filters shape (built and validated by analytics.controller.js):
 *   { batchId: string, startDate?: Date, endDate?: Date,
 *     categories?: string[], regions?: string[] }
 *
 * Aggregation pipelines do not auto-cast, so batchId is converted to an
 * ObjectId here. The match keys line up with the compound index
 * { batchId, orderDate, category, region }.
 */
export function buildMatch({ batchId, startDate, endDate, categories, regions }) {
  const match = { batchId: new ObjectId(batchId) };

  if (startDate || endDate) {
    match.orderDate = {};
    if (startDate) match.orderDate.$gte = startDate;
    if (endDate) match.orderDate.$lte = endDate;
  }
  if (categories?.length) match.category = { $in: categories };
  if (regions?.length) match.region = { $in: regions };

  return match;
}

const run = (pipeline) => SalesRecord.aggregate(pipeline).allowDiskUse(true);

const countOf = (facetResult) => facetResult?.[0]?.count ?? 0;

/* -------------------------------------------------------------------------- */
/* Overview: 5 KPIs + filter options                                          */
/* -------------------------------------------------------------------------- */

/**
 * Total Revenue   = Σ totalRevenue
 * Total Orders    = COUNT(DISTINCT orderId)      (an order can have many lines)
 * Total Customers = COUNT(DISTINCT customerId)
 * AOV             = Total Revenue / Total Orders
 * Revenue Growth  = (current − previous) / previous × 100
 *
 * Growth compares the selected period with the previous period of equal
 * length when both startDate and endDate are given; otherwise it compares the
 * latest month in the (filtered) data with the month before it.
 */
export async function getOverview(filters) {
  const match = buildMatch(filters);
  const batchMatch = { batchId: match.batchId };

  const [facetDocs, categories, regions] = await Promise.all([
    run([
      { $match: match },
      {
        $facet: {
          totals: [{ $group: { _id: null, revenue: { $sum: '$totalRevenue' } } }],
          orders: [{ $group: { _id: '$orderId' } }, { $count: 'count' }],
          customers: [{ $group: { _id: '$customerId' } }, { $count: 'count' }],
          monthly: [
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m', date: '$orderDate' } },
                revenue: { $sum: '$totalRevenue' },
              },
            },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ]),
    // Dropdown options come from the whole batch so they don't shrink as filters apply.
    SalesRecord.distinct('category', batchMatch),
    SalesRecord.distinct('region', batchMatch),
  ]);

  const facet = facetDocs[0] ?? {};
  const totalRevenue = round2(facet.totals?.[0]?.revenue ?? 0);
  const totalOrders = countOf(facet.orders);
  const totalCustomers = countOf(facet.customers);
  const averageOrderValue = totalOrders > 0 ? round2(totalRevenue / totalOrders) : 0;

  const revenueGrowth = await computeRevenueGrowth(filters, totalRevenue, facet.monthly ?? []);

  return {
    kpis: { totalRevenue, totalOrders, totalCustomers, averageOrderValue, revenueGrowth },
    options: {
      categories: categories.filter(Boolean).sort(),
      regions: regions.filter(Boolean).sort(),
    },
  };
}

async function computeRevenueGrowth(filters, currentRevenue, monthly) {
  const toPercent = (current, previous) =>
    previous > 0 ? round2(((current - previous) / previous) * 100) : null;

  /* Selected period vs the previous period of the same length. */
  if (filters.startDate && filters.endDate) {
    const spanMs = filters.endDate.getTime() - filters.startDate.getTime() + 1;
    const previousEnd = new Date(filters.startDate.getTime() - 1);
    const previousStart = new Date(filters.startDate.getTime() - spanMs);

    const previousMatch = buildMatch({ ...filters, startDate: previousStart, endDate: previousEnd });
    const [previousDoc] = await run([
      { $match: previousMatch },
      { $group: { _id: null, revenue: { $sum: '$totalRevenue' } } },
    ]);
    const previousRevenue = round2(previousDoc?.revenue ?? 0);

    return {
      basis: 'previous_period',
      percent: toPercent(currentRevenue, previousRevenue),
      currentRevenue,
      previousRevenue,
      currentPeriod: { start: filters.startDate, end: filters.endDate },
      previousPeriod: { start: previousStart, end: previousEnd },
    };
  }

  /* No explicit range: latest month in the data vs the month before it. */
  if (monthly.length === 0) {
    return { basis: 'latest_month_vs_prior_month', percent: null, currentRevenue: 0, previousRevenue: 0 };
  }

  const latest = monthly[monthly.length - 1];
  const priorKey = dayjs.utc(`${latest._id}-01`).subtract(1, 'month').format('YYYY-MM');
  const currentMonthRevenue = round2(latest.revenue);
  const priorMonthRevenue = round2(monthly.find((m) => m._id === priorKey)?.revenue ?? 0);

  return {
    basis: 'latest_month_vs_prior_month',
    percent: toPercent(currentMonthRevenue, priorMonthRevenue),
    currentRevenue: currentMonthRevenue,
    previousRevenue: priorMonthRevenue,
    currentPeriod: { month: latest._id },
    previousPeriod: { month: priorKey },
  };
}

/* -------------------------------------------------------------------------- */
/* Trends: time series for the Revenue Trend chart                            */
/* -------------------------------------------------------------------------- */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Buckets as sortable strings. Weeks are ISO weeks (Monday start) labelled by
// their Monday: orderDate minus (isoDayOfWeek - 1) days, formatted as a date.
const BUCKET_EXPRESSIONS = {
  day: { $dateToString: { format: '%Y-%m-%d', date: '$orderDate' } },
  month: { $dateToString: { format: '%Y-%m', date: '$orderDate' } },
  week: {
    $dateToString: {
      format: '%Y-%m-%d',
      date: {
        $subtract: [
          '$orderDate',
          { $multiply: [{ $subtract: [{ $isoDayOfWeek: '$orderDate' }, 1] }, MS_PER_DAY] },
        ],
      },
    },
  },
};

/**
 * @returns {Promise<{date: string, revenue: number, orders: number}[]>}
 */
export async function getTrends(filters, granularity = 'month') {
  const bucket = BUCKET_EXPRESSIONS[granularity] ?? BUCKET_EXPRESSIONS.month;

  const rows = await run([
    { $match: buildMatch(filters) },
    // First collapse to (bucket, orderId) so orders are DISTINCT order ids.
    { $group: { _id: { bucket, orderId: '$orderId' }, revenue: { $sum: '$totalRevenue' } } },
    { $group: { _id: '$_id.bucket', revenue: { $sum: '$revenue' }, orders: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, date: '$_id', revenue: 1, orders: 1 } },
  ]);

  return rows.map((r) => ({ date: r.date, revenue: round2(r.revenue), orders: r.orders }));
}

/* -------------------------------------------------------------------------- */
/* Breakdowns: top products / customers, category + region distribution       */
/* -------------------------------------------------------------------------- */

const TOP_N = 10;

export async function getBreakdowns(filters) {
  const [facet = {}] = await run([
    { $match: buildMatch(filters) },
    {
      $facet: {
        totals: [{ $group: { _id: null, revenue: { $sum: '$totalRevenue' } } }],

        topProducts: [
          {
            $group: {
              _id: '$productId',
              productName: { $first: '$productName' },
              category: { $first: '$category' },
              unitsSold: { $sum: '$quantity' },
              revenue: { $sum: '$totalRevenue' },
            },
          },
          { $sort: { revenue: -1, _id: 1 } },
          { $limit: TOP_N },
        ],

        topCustomers: [
          // Collapse to (customer, order) first so totalOrders counts DISTINCT orders.
          {
            $group: {
              _id: { customerId: '$customerId', orderId: '$orderId' },
              customerName: { $first: '$customerName' },
              revenue: { $sum: '$totalRevenue' },
              lastPurchase: { $max: '$orderDate' },
            },
          },
          {
            $group: {
              _id: '$_id.customerId',
              customerName: { $first: '$customerName' },
              totalSpend: { $sum: '$revenue' },
              totalOrders: { $sum: 1 },
              lastPurchaseDate: { $max: '$lastPurchase' },
            },
          },
          { $sort: { totalSpend: -1, _id: 1 } },
          { $limit: TOP_N },
        ],

        categoryDistribution: [
          { $group: { _id: '$category', revenue: { $sum: '$totalRevenue' } } },
          { $sort: { revenue: -1, _id: 1 } },
        ],

        regionDistribution: [
          { $group: { _id: '$region', revenue: { $sum: '$totalRevenue' } } },
          { $sort: { revenue: -1, _id: 1 } },
        ],
      },
    },
  ]);

  const grandTotal = facet.totals?.[0]?.revenue ?? 0;

  return {
    topProducts: (facet.topProducts ?? []).map((p) => ({
      productId: p._id,
      productName: p.productName,
      category: p.category,
      unitsSold: p.unitsSold,
      revenue: round2(p.revenue),
      percentOfTotal: percentOf(p.revenue, grandTotal),
    })),
    topCustomers: (facet.topCustomers ?? []).map((c) => ({
      customerId: c._id,
      customerName: c.customerName,
      totalOrders: c.totalOrders,
      totalSpend: round2(c.totalSpend),
      averageOrderValue: c.totalOrders > 0 ? round2(c.totalSpend / c.totalOrders) : 0,
      lastPurchaseDate: c.lastPurchaseDate,
    })),
    categoryDistribution: (facet.categoryDistribution ?? []).map((c) => ({
      category: c._id,
      revenue: round2(c.revenue),
      percentOfTotal: percentOf(c.revenue, grandTotal),
    })),
    regionDistribution: (facet.regionDistribution ?? []).map((r) => ({
      region: r._id,
      revenue: round2(r.revenue),
      percentOfTotal: percentOf(r.revenue, grandTotal),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Forecast input                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Historical monthly revenue for the whole batch, ascending. Feeds
 * forecast.service.js (the forecast ignores dashboard filters).
 * @returns {Promise<{month: string, revenue: number}[]>}
 */
export async function getMonthlyRevenue(batchId) {
  const rows = await run([
    { $match: { batchId: new ObjectId(batchId) } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$orderDate' } },
        revenue: { $sum: '$totalRevenue' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return rows.map((r) => ({ month: r._id, revenue: round2(r.revenue) }));
}

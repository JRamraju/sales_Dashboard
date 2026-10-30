import mongoose from 'mongoose';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import SalesRecord from '../models/SalesRecord.model.js';

dayjs.extend(utc);

const { ObjectId } = mongoose.Types;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const percentOf = (part, whole) => (whole > 0 ? round2((part / whole) * 100) : 0);

export const GRANULARITIES = ['day', 'week', 'month'];

/** Longest series the trend endpoint will zero-fill (a chart cannot show more anyway). */
export const MAX_TREND_POINTS = 2000;

const TOP_N = 10;

/**
 * The `batchId` part of a $match for one file (a string) or several files (an
 * array). One file stays a plain equality so it behaves exactly as before; no
 * files at all matches nothing, so an empty dataset gives empty results.
 */
export function batchClause(input) {
  const ids = [].concat(input ?? []).filter(Boolean).map((id) => new ObjectId(id));
  return ids.length === 1 ? ids[0] : { $in: ids };
}

/**
 * Filters shape (built and validated by analytics.controller.js):
 *   { batchIds: string[], startDate?: Date, endDate?: Date,
 *     categories?: string[], regions?: string[] }
 *
 * `batchId` (a single string) is still accepted. Each uploaded file is one
 * batch, and the dashboard can look at any set of them together.
 *
 * Aggregation pipelines do not auto-cast, so the ids are converted to
 * ObjectIds here. The match keys line up with the compound index
 * { batchId, orderDate, category, region }.
 */
export function buildMatch({ batchIds, batchId, startDate, endDate, categories, regions }) {
  const match = { batchId: batchClause(batchIds ?? batchId) };

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
const dateOnly = (date) => (date ? dayjs.utc(date).format('YYYY-MM-DD') : null);

/* -------------------------------------------------------------------------- */
/* Filter dropdown options (whole batch, independent of the active filters)    */
/* -------------------------------------------------------------------------- */

export const optionsPipeline = (batchIds) => [
  { $match: { batchId: batchClause(batchIds) } },
  {
    $group: {
      _id: null,
      categories: { $addToSet: '$category' },
      regions: { $addToSet: '$region' },
      minDate: { $min: '$orderDate' },
      maxDate: { $max: '$orderDate' },
    },
  },
];

/**
 * Dropdown options come from all the selected files so they do not shrink as
 * filters apply, and the date bounds feed the date pickers' min/max. One pass
 * over the index replaces the two separate `distinct` calls the first version
 * made.
 *
 * @param {string | string[]} batchIds  one file or several
 * @returns {Promise<{categories: string[], regions: string[], minDate: string|null, maxDate: string|null}>}
 */
export async function getFilterOptions(batchIds) {
  const [doc] = await run(optionsPipeline(batchIds));
  return {
    categories: (doc?.categories ?? []).filter(Boolean).sort(),
    regions: (doc?.regions ?? []).filter(Boolean).sort(),
    minDate: dateOnly(doc?.minDate),
    maxDate: dateOnly(doc?.maxDate),
  };
}

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
export function overviewPipeline(match, { withMonthly = true } = {}) {
  const facet = {
    totals: [{ $group: { _id: null, revenue: { $sum: '$totalRevenue' } } }],
    orders: [{ $group: { _id: '$orderId' } }, { $count: 'count' }],
    customers: [{ $group: { _id: '$customerId' } }, { $count: 'count' }],
  };

  // Only the "latest month vs prior month" growth needs the monthly split.
  if (withMonthly) {
    facet.monthly = [
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$orderDate' } },
          revenue: { $sum: '$totalRevenue' },
        },
      },
      { $sort: { _id: 1 } },
    ];
  }

  return [{ $match: match }, { $facet: facet }];
}

/** The window immediately before [startDate, endDate], of the same length. */
export function previousPeriodOf({ startDate, endDate }) {
  const spanMs = endDate.getTime() - startDate.getTime() + 1;
  return {
    previousStart: new Date(startDate.getTime() - spanMs),
    previousEnd: new Date(startDate.getTime() - 1),
  };
}

async function getPreviousPeriodRevenue(filters) {
  const { previousStart, previousEnd } = previousPeriodOf(filters);
  const previousMatch = buildMatch({ ...filters, startDate: previousStart, endDate: previousEnd });
  const [doc] = await run([
    { $match: previousMatch },
    { $group: { _id: null, revenue: { $sum: '$totalRevenue' } } },
  ]);
  return round2(doc?.revenue ?? 0);
}

const toPercent = (current, previous) =>
  previous > 0 ? round2(((current - previous) / previous) * 100) : null;

/** Pure: builds the growth object from already-fetched numbers. */
export function computeRevenueGrowth(filters, currentRevenue, monthly, previousPeriodRevenue) {
  /* Selected period vs the previous period of the same length. */
  if (filters.startDate && filters.endDate) {
    const { previousStart, previousEnd } = previousPeriodOf(filters);
    return {
      basis: 'previous_period',
      percent: toPercent(currentRevenue, previousPeriodRevenue),
      currentRevenue,
      previousRevenue: previousPeriodRevenue,
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

/**
 * The response carries the figures under the names the dashboard client reads:
 * `kpis.revenueGrowth` is a plain number (the percentage) and the dropdown /
 * date-picker data is `filterOptions` (the original response nested the growth
 * details inside `revenueGrowth` and called the options `options`, so the
 * client showed empty dropdowns and a NaN growth figure). The details live in
 * `growth`, and `options` is kept as an alias.
 *
 * @param {object} filters
 * @param {object} [filterOptions]  pass a cached result to skip that query
 */
export async function getOverview(filters, filterOptions) {
  const match = buildMatch(filters);
  const hasRange = Boolean(filters.startDate && filters.endDate);

  const [facetDocs, options, previousPeriodRevenue] = await Promise.all([
    run(overviewPipeline(match, { withMonthly: !hasRange })),
    filterOptions ?? getFilterOptions(filters.batchIds ?? filters.batchId),
    hasRange ? getPreviousPeriodRevenue(filters) : Promise.resolve(0),
  ]);

  const facet = facetDocs[0] ?? {};
  const totalRevenue = round2(facet.totals?.[0]?.revenue ?? 0);
  const totalOrders = countOf(facet.orders);
  const totalCustomers = countOf(facet.customers);
  const averageOrderValue = totalOrders > 0 ? round2(totalRevenue / totalOrders) : 0;

  const growth = computeRevenueGrowth(filters, totalRevenue, facet.monthly ?? [], previousPeriodRevenue);

  return {
    kpis: {
      totalRevenue,
      totalOrders,
      totalCustomers,
      averageOrderValue,
      revenueGrowth: growth.percent,
      previousPeriodRevenue: growth.previousRevenue,
    },
    growth,
    filterOptions: options,
    options: { categories: options.categories, regions: options.regions },
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

export function trendsPipeline(match, granularity = 'month') {
  const bucket = BUCKET_EXPRESSIONS[granularity] ?? BUCKET_EXPRESSIONS.month;

  return [
    { $match: match },
    // First collapse to (bucket, orderId) so orders are DISTINCT order ids.
    { $group: { _id: { bucket, orderId: '$orderId' }, revenue: { $sum: '$totalRevenue' } } },
    { $group: { _id: '$_id.bucket', revenue: { $sum: '$revenue' }, orders: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, date: '$_id', revenue: 1, orders: 1 } },
  ];
}

const GAP_STEP = { day: [1, 'day'], week: [7, 'day'], month: [1, 'month'] };
const GAP_FORMAT = { day: 'YYYY-MM-DD', week: 'YYYY-MM-DD', month: 'YYYY-MM' };

/**
 * The aggregation only returns buckets that have sales. On a chart that makes
 * a quiet month vanish and its neighbours touch, which reads as steady revenue
 * instead of a dip to zero. This inserts the missing buckets as 0 (the same
 * thing the forecast already does for months). A series too long to chart
 * (more than `maxPoints` buckets) is returned unfilled.
 */
export function fillTrendGaps(points, granularity = 'month', maxPoints = MAX_TREND_POINTS) {
  if (points.length < 2) return points;

  const [amount, unit] = GAP_STEP[granularity] ?? GAP_STEP.month;
  const format = GAP_FORMAT[granularity] ?? GAP_FORMAT.month;
  const parse = (label) => dayjs.utc(format === 'YYYY-MM' ? `${label}-01` : label);

  const first = parse(points[0].date);
  const last = parse(points[points.length - 1].date);
  const buckets = Math.floor(last.diff(first, unit) / amount) + 1;
  if (buckets > maxPoints || buckets <= points.length) return points;

  const byDate = new Map(points.map((p) => [p.date, p]));
  const filled = [];
  for (let cursor = first; !cursor.isAfter(last); cursor = cursor.add(amount, unit)) {
    const date = cursor.format(format);
    filled.push(byDate.get(date) ?? { date, revenue: 0, orders: 0, averageOrderValue: 0 });
  }
  return filled;
}

/**
 * @returns {Promise<{date: string, revenue: number, orders: number, averageOrderValue: number}[]>}
 */
export async function getTrends(filters, granularity = 'month', { fillGaps = true } = {}) {
  const rows = await run(trendsPipeline(buildMatch(filters), granularity));

  const points = rows.map((r) => ({
    date: r.date,
    revenue: round2(r.revenue),
    orders: r.orders,
    averageOrderValue: r.orders > 0 ? round2(r.revenue / r.orders) : 0,
  }));

  return fillGaps ? fillTrendGaps(points, granularity) : points;
}

/* -------------------------------------------------------------------------- */
/* Breakdowns: top products / customers, category + region distribution       */
/* -------------------------------------------------------------------------- */

export function breakdownsPipeline(match) {
  return [
    { $match: match },
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
  ];
}

/**
 * Pure: turns the $facet output into the response. Each money / share field is
 * emitted under both its original name and the name the dashboard client
 * reads (`totalRevenue`, `percentageOfSales`, `percentage`, `name`), because
 * with only the original names every percentage showed as 0 in the UI.
 */
export function shapeBreakdowns(facet = {}) {
  const grandTotal = facet.totals?.[0]?.revenue ?? 0;

  const distribution = (rows, key) =>
    (rows ?? []).map((row) => {
      const percentOfTotal = percentOf(row.revenue, grandTotal);
      return {
        [key]: row._id,
        name: row._id,
        revenue: round2(row.revenue),
        percentOfTotal,
        percentage: percentOfTotal,
      };
    });

  return {
    topProducts: (facet.topProducts ?? []).map((p) => {
      const percentOfTotal = percentOf(p.revenue, grandTotal);
      return {
        productId: p._id,
        productName: p.productName,
        category: p.category,
        unitsSold: p.unitsSold,
        revenue: round2(p.revenue),
        totalRevenue: round2(p.revenue),
        percentOfTotal,
        percentageOfSales: percentOfTotal,
      };
    }),
    topCustomers: (facet.topCustomers ?? []).map((c) => ({
      customerId: c._id,
      customerName: c.customerName,
      totalOrders: c.totalOrders,
      totalSpend: round2(c.totalSpend),
      averageOrderValue: c.totalOrders > 0 ? round2(c.totalSpend / c.totalOrders) : 0,
      lastPurchaseDate: c.lastPurchaseDate,
    })),
    categoryDistribution: distribution(facet.categoryDistribution, 'category'),
    regionDistribution: distribution(facet.regionDistribution, 'region'),
  };
}

export async function getBreakdowns(filters) {
  const [facet = {}] = await run(breakdownsPipeline(buildMatch(filters)));
  return shapeBreakdowns(facet);
}

/* -------------------------------------------------------------------------- */
/* Forecast input                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Historical monthly revenue for the selected file(s), ascending. Feeds
 * forecast.service.js. The forecast looks at the whole history, so date filters
 * are ignored, but category / region filters are honoured (the dashboard sends
 * them, so the forecast describes the same slice of the business as the KPI
 * cards).
 *
 * @param {string | { batchIds?: string[], batchId?: string, categories?: string[], regions?: string[] }} input
 * @returns {Promise<{month: string, revenue: number}[]>}
 */
export async function getMonthlyRevenue(input) {
  const { batchIds, batchId, categories, regions } =
    typeof input === 'string' ? { batchId: input } : input;

  const rows = await run([
    { $match: buildMatch({ batchIds, batchId, categories, regions }) },
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

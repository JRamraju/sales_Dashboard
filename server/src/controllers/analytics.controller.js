import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import UploadBatch from '../models/UploadBatch.model.js';
import { ApiError } from '../middlewares/error.middleware.js';
import {
  GRANULARITIES,
  getOverview,
  getTrends,
  getBreakdowns,
  getMonthlyRevenue,
  getFilterOptions,
} from '../services/kpi.service.js';
import { calculateForecast, DEFAULT_HORIZON, MAX_HORIZON } from '../services/forecast.service.js';
import { analyticsCache } from '../utils/cache.util.js';

dayjs.extend(utc);

const OBJECT_ID = /^[a-f\d]{24}$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FILTER_VALUES = 100;

/**
 * Multi-select filters can arrive as repeated params (?category=A&category=B),
 * bracket params (?category[]=A) or a comma-separated list (?category=A,B),
 * which is what the dashboard client sends. Values that contain a comma must
 * use the repeated/bracket form.
 */
function toList(value, name) {
  if (value === undefined || value === null || value === '') return undefined;

  // ?category[a]=b parses to an object with the extended query parser; there is
  // no sensible reading of it, and it must never reach the database filter.
  if (typeof value === 'object' && !Array.isArray(value)) {
    throw new ApiError(400, `Invalid ${name} filter.`);
  }

  const items = Array.isArray(value) ? value : String(value).split(',');
  if (items.some((item) => typeof item !== 'string')) {
    throw new ApiError(400, `Invalid ${name} filter.`);
  }

  const cleaned = items.map((item) => item.trim()).filter(Boolean);
  if (cleaned.length > MAX_FILTER_VALUES) {
    throw new ApiError(400, `Too many ${name} values (maximum ${MAX_FILTER_VALUES}).`);
  }
  return cleaned.length ? cleaned : undefined;
}

function parseDateParam(value, name, { endOfDay = false } = {}) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new ApiError(400, `Invalid ${name}.`);

  const parsed = dayjs.utc(value);
  if (!parsed.isValid()) {
    throw new ApiError(400, `Invalid ${name}. Use YYYY-MM-DD or an ISO 8601 date.`);
  }

  // A bare date means the whole UTC day, so endDate=2026-03-31 includes March 31.
  if (DATE_ONLY.test(value)) {
    return (endOfDay ? parsed.endOf('day') : parsed.startOf('day')).toDate();
  }
  return parsed.toDate();
}

/**
 * Looks the batch up once and returns what the handlers need. The status is
 * used for caching: only a finished batch is immutable, so only a finished
 * batch's results are cached (a half-ingested one changes while it loads).
 */
async function requireBatch(batchId) {
  if (!batchId) throw new ApiError(400, 'batchId is required.');
  if (typeof batchId !== 'string' || !OBJECT_ID.test(batchId)) {
    throw new ApiError(400, 'Invalid batchId.');
  }

  const batch = await UploadBatch.findById(batchId).select('status').lean();
  if (!batch) throw new ApiError(404, 'Upload batch not found.');

  return { id: String(batch._id), status: batch.status };
}

/** Builds the validated filter object that kpi.service.js turns into a $match. */
async function parseFilters(query) {
  const batch = await requireBatch(query.batchId);

  const filters = {
    batchId: batch.id,
    startDate: parseDateParam(query.startDate, 'startDate'),
    endDate: parseDateParam(query.endDate, 'endDate', { endOfDay: true }),
    categories: toList(query.category, 'category'),
    regions: toList(query.region, 'region'),
  };

  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
    throw new ApiError(400, 'startDate must not be after endDate.');
  }
  return { batch, filters };
}

/* ------------------------------- Caching --------------------------------- */

const sorted = (list) => (list ? [...list].sort() : null);

/** Same filters in a different order must hit the same cache entry. */
const filterKey = (filters) =>
  JSON.stringify([
    filters.startDate?.toISOString() ?? null,
    filters.endDate?.toISOString() ?? null,
    sorted(filters.categories),
    sorted(filters.regions),
  ]);

const cached = (batch, name, variant, loader) =>
  batch.status === 'completed'
    ? analyticsCache.wrap(`${batch.id}:${name}:${variant}`, loader)
    : loader();

/** Drops everything cached for a batch (called when it is deleted). */
export const clearBatchCache = (batchId) => analyticsCache.invalidatePrefix(`${batchId}:`);

/* ------------------------------- Handlers -------------------------------- */

/** GET /api/v1/analytics/overview — 5 KPIs, growth and filter dropdown options. */
export async function overview(req, res) {
  const { batch, filters } = await parseFilters(req.query);

  const data = await cached(batch, 'overview', filterKey(filters), async () => {
    const options = await cached(batch, 'options', '', () => getFilterOptions(batch.id));
    return getOverview(filters, options);
  });

  res.json(data);
}

/**
 * GET /api/v1/analytics/trends — time series [{ date, revenue, orders, averageOrderValue }].
 * Buckets with no sales are returned as zeros so the chart shows the dip;
 * pass fillGaps=false for only the buckets that have sales.
 */
export async function trends(req, res) {
  const { batch, filters } = await parseFilters(req.query);

  const granularity = req.query.granularity ?? 'month';
  if (!GRANULARITIES.includes(granularity)) {
    throw new ApiError(400, `Invalid granularity. Use one of: ${GRANULARITIES.join(', ')}.`);
  }
  const fillGaps = !['false', '0'].includes(String(req.query.fillGaps ?? '').toLowerCase());

  const data = await cached(batch, 'trends', `${granularity}|${fillGaps}|${filterKey(filters)}`, () =>
    getTrends(filters, granularity, { fillGaps })
  );
  res.json(data);
}

/** GET /api/v1/analytics/breakdowns — top products/customers, category + region distribution. */
export async function breakdowns(req, res) {
  const { batch, filters } = await parseFilters(req.query);

  const data = await cached(batch, 'breakdowns', filterKey(filters), () => getBreakdowns(filters));
  res.json(data);
}

/**
 * GET /api/v1/analytics/forecast — history + next N months, trend direction, R²
 * and a 95% range per month. Honours the category / region filters (the
 * dashboard sends them); date filters do not apply, the forecast always uses
 * the whole history.
 */
export async function forecast(req, res) {
  const batch = await requireBatch(req.query.batchId);
  const categories = toList(req.query.category, 'category');
  const regions = toList(req.query.region, 'region');

  let horizon = DEFAULT_HORIZON;
  if (req.query.horizon !== undefined) {
    horizon = Number(req.query.horizon);
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > MAX_HORIZON) {
      throw new ApiError(400, `horizon must be a whole number between 1 and ${MAX_HORIZON}.`);
    }
  }

  const variant = `${horizon}|${filterKey({ categories, regions })}`;
  const data = await cached(batch, 'forecast', variant, async () => {
    const monthlyRevenue = await getMonthlyRevenue({ batchId: batch.id, categories, regions });
    return calculateForecast(monthlyRevenue, horizon);
  });

  res.json(data);
}

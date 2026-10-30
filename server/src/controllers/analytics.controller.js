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
import { getNewEntitiesByFile } from '../services/masterData.service.js';
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
 * Works out which files a request is about ("view by file"):
 *   ?batchIds=a,b   (or repeated / bracket params; `batchId` is accepted as an alias)
 *                   -> exactly those files
 *   nothing given   -> every COMPLETED file, i.e. the combined view
 *
 * The id list is always explicit and sorted, so it doubles as the cache key:
 * a newly finished upload changes the "all files" key by itself, and only
 * finished files are cached (a half-ingested one changes while it loads).
 */
async function requireBatches(query) {
  const requested = toList(query.batchIds ?? query.batchId, 'batchIds');

  if (requested) {
    const ids = [...new Set(requested)];
    if (ids.some((id) => !OBJECT_ID.test(id))) throw new ApiError(400, 'Invalid batchIds.');

    const found = await UploadBatch.find({ _id: { $in: ids } }).select('status').lean();
    if (found.length !== ids.length) throw new ApiError(404, 'One or more files were not found.');

    ids.sort();
    return { ids, key: ids.join('+'), cacheable: found.every((b) => b.status === 'completed') };
  }

  const completed = await UploadBatch.find({ status: 'completed' }).select('_id').lean();
  const ids = completed.map((b) => String(b._id)).sort();
  return { ids, key: ids.join('+') || 'none', cacheable: true };
}

/** Builds the validated filter object that kpi.service.js turns into a $match. */
async function parseFilters(query) {
  const batch = await requireBatches(query);

  const filters = {
    batchIds: batch.ids,
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

// Key layout: "<id>+<id>:<endpoint>:<variant>" (ObjectIds contain no ':' or '+').
const cached = (batch, name, variant, loader) =>
  batch.cacheable ? analyticsCache.wrap(`${batch.key}:${name}:${variant}`, loader) : loader();

/** Drops every cached result that includes this file (called when it is deleted). */
export const clearBatchCache = (batchId) =>
  analyticsCache.invalidateWhere((key) => key.split(':')[0].split('+').includes(String(batchId)));

/* ------------------------------- Handlers -------------------------------- */

/** GET /api/v1/analytics/overview — 5 KPIs, growth and filter dropdown options (for the selected files). */
export async function overview(req, res) {
  const { batch, filters } = await parseFilters(req.query);

  const data = await cached(batch, 'overview', filterKey(filters), async () => {
    const options = await cached(batch, 'options', '', () => getFilterOptions(batch.ids));
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
  const batch = await requireBatches(req.query);
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
    const monthlyRevenue = await getMonthlyRevenue({ batchIds: batch.ids, categories, regions });
    return calculateForecast(monthlyRevenue, horizon);
  });

  res.json(data);
}

/**
 * GET /api/v1/analytics/new-entities?batchIds=a,b&limit=200
 * For each selected file: the customers and products that first appeared in
 * it (not present in any earlier file), with the invoices (order ids) they
 * were linked to. The baseline (earliest) file only reports counts.
 * Not cached: it reads master data that changes when files are deleted.
 */
export async function newEntities(req, res) {
  const batch = await requireBatches(req.query);

  let limit = 200;
  if (req.query.limit !== undefined) {
    limit = Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new ApiError(400, 'limit must be a whole number between 1 and 1000.');
    }
  }

  res.json({ files: await getNewEntitiesByFile(batch.ids, { limit }) });
}

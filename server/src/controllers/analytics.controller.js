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
import {
  getNewRecords,
  DEFAULT_ITEM_LIMIT,
  MAX_ITEM_LIMIT,
} from '../services/newRecords.service.js';
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

const filesOf = (ids, allCompleted) => ({ ids, allCompleted, key: `files=${ids.join('+')}` });

/**
 * Works out which uploaded files a request is about.
 *
 *   ?batchIds=a,b   those files (the dashboard's "view by file" selection)
 *   ?batchId=a      one file (the original parameter, still accepted)
 *   (neither)       every finished file together, i.e. the whole running dataset
 *
 * Returns the sorted ids plus `key`, the cache key for exactly that set of
 * files. Only finished files are immutable, so results are cached only when
 * every selected file is finished (a half-ingested one changes while it loads).
 *
 * @param {object} query
 * @param {object} [UploadBatchModel]  overridable for tests
 */
export async function resolveFiles(query, UploadBatchModel = UploadBatch) {
  const requested = toList(query.batchIds ?? query.batchId, 'batchIds');

  if (!requested) {
    const finished = await UploadBatchModel.find({ status: 'completed' }).select('_id').lean();
    return filesOf(finished.map((b) => String(b._id)).sort(), true);
  }

  if (!requested.every((id) => OBJECT_ID.test(id))) throw new ApiError(400, 'Invalid batchIds.');

  const unique = [...new Set(requested.map((id) => id.toLowerCase()))];
  const found = await UploadBatchModel.find({ _id: { $in: unique } }).select('status').lean();
  if (found.length !== unique.length) throw new ApiError(404, 'Upload batch not found.');

  return filesOf(
    found.map((b) => String(b._id)).sort(),
    found.every((b) => b.status === 'completed')
  );
}

/** Builds the validated filter object that kpi.service.js turns into a $match. */
async function parseFilters(query) {
  const files = await resolveFiles(query);

  const filters = {
    batchIds: files.ids,
    startDate: parseDateParam(query.startDate, 'startDate'),
    endDate: parseDateParam(query.endDate, 'endDate', { endOfDay: true }),
    categories: toList(query.category, 'category'),
    regions: toList(query.region, 'region'),
  };

  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
    throw new ApiError(400, 'startDate must not be after endDate.');
  }
  return { files, filters };
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

const cached = (files, name, variant, loader) =>
  files.allCompleted ? analyticsCache.wrap(`${files.key}:${name}:${variant}`, loader) : loader();

/**
 * Drops every cached result that includes the file, whatever other files it
 * was combined with (called when a file is deleted).
 */
export const clearBatchCache = (batchId) =>
  analyticsCache.invalidateWhere((key) => key.includes(String(batchId)));

/* ------------------------------- Handlers -------------------------------- */

/**
 * GET /api/v1/analytics/overview — 5 KPIs, growth and filter dropdown options.
 *
 * Every analytics endpoint takes `batchIds` (comma-separated file ids) to say
 * which uploaded files to look at; leave it out for all finished files combined.
 */
export async function overview(req, res) {
  const { files, filters } = await parseFilters(req.query);

  const data = await cached(files, 'overview', filterKey(filters), async () => {
    const options = await cached(files, 'options', '', () => getFilterOptions(files.ids));
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
  const { files, filters } = await parseFilters(req.query);

  const granularity = req.query.granularity ?? 'month';
  if (!GRANULARITIES.includes(granularity)) {
    throw new ApiError(400, `Invalid granularity. Use one of: ${GRANULARITIES.join(', ')}.`);
  }
  const fillGaps = !['false', '0'].includes(String(req.query.fillGaps ?? '').toLowerCase());

  const data = await cached(files, 'trends', `${granularity}|${fillGaps}|${filterKey(filters)}`, () =>
    getTrends(filters, granularity, { fillGaps })
  );
  res.json(data);
}

/** GET /api/v1/analytics/breakdowns — top products/customers, category + region distribution. */
export async function breakdowns(req, res) {
  const { files, filters } = await parseFilters(req.query);

  const data = await cached(files, 'breakdowns', filterKey(filters), () => getBreakdowns(filters));
  res.json(data);
}

/**
 * GET /api/v1/analytics/forecast — history + next N months, trend direction, R²
 * and a 95% range per month. Honours the category / region filters (the
 * dashboard sends them); date filters do not apply, the forecast always uses
 * the whole history.
 */
export async function forecast(req, res) {
  const files = await resolveFiles(req.query);
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
  const data = await cached(files, 'forecast', variant, async () => {
    const monthlyRevenue = await getMonthlyRevenue({ batchIds: files.ids, categories, regions });
    return calculateForecast(monthlyRevenue, horizon);
  });

  res.json(data);
}

/**
 * GET /api/v1/analytics/new-records — for each selected file, the customers and
 * products that are in it but in none of the files uploaded before it.
 *
 *   ?batchIds=a,b   files to report on (default: all finished files)
 *   ?limit=100      most new customers / products listed per file (max 500);
 *                   `count` and `revenue` always cover all of them
 *
 * The first file has nothing earlier to compare with (`isFirstFile: true`, empty
 * lists). Category / region / date filters do not apply: whether a customer is
 * new does not depend on them.
 */
export async function newRecords(req, res) {
  const files = await resolveFiles(req.query);

  let limit = DEFAULT_ITEM_LIMIT;
  if (req.query.limit !== undefined) {
    limit = Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ITEM_LIMIT) {
      throw new ApiError(400, `limit must be a whole number between 1 and ${MAX_ITEM_LIMIT}.`);
    }
  }

  // "Earlier" is judged against every finished file, in upload order.
  const finished = await UploadBatch.find({ status: 'completed' })
    .select('fileName uploadedAt')
    .sort({ uploadedAt: 1, _id: 1 })
    .lean();
  const orderedFiles = finished.map((b, i) => ({
    id: String(b._id),
    fileName: b.fileName,
    uploadedAt: b.uploadedAt,
    fileNumber: i + 1,
  }));

  // The result depends on every finished file, so the key lists them all;
  // deleting any one of them drops it (see clearBatchCache).
  const key = `files=${orderedFiles.map((f) => f.id).join('+')}:new-records:${files.ids.join('+')}|${limit}`;
  const data = await analyticsCache.wrap(key, () =>
    getNewRecords({ orderedFiles, selectedIds: files.ids, limit })
  );

  res.json(data);
}

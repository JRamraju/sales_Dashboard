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
} from '../services/kpi.service.js';
import { calculateForecast, DEFAULT_HORIZON, MAX_HORIZON } from '../services/forecast.service.js';

dayjs.extend(utc);

const OBJECT_ID = /^[a-f\d]{24}$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Multi-select filters can arrive as repeated params (?category=A&category=B),
 * bracket params (?category[]=A) or a comma-separated list (?category=A,B).
 * Values that contain a comma must use the repeated/bracket form.
 */
function toList(value) {
  if (value === undefined || value === null || value === '') return undefined;

  const items = Array.isArray(value)
    ? value.map(String)
    : String(value).split(',');

  const cleaned = items.map((item) => item.trim()).filter(Boolean);
  return cleaned.length ? cleaned : undefined;
}

function parseDateParam(value, name, { endOfDay = false } = {}) {
  if (value === undefined || value === '') return undefined;

  const text = String(value);
  const parsed = dayjs.utc(text);
  if (!parsed.isValid()) {
    throw new ApiError(400, `Invalid ${name}. Use YYYY-MM-DD or an ISO 8601 date.`);
  }

  // A bare date means the whole UTC day, so endDate=2026-03-31 includes March 31.
  if (DATE_ONLY.test(text)) {
    return (endOfDay ? parsed.endOf('day') : parsed.startOf('day')).toDate();
  }
  return parsed.toDate();
}

async function requireBatchId(batchId) {
  if (!batchId) throw new ApiError(400, 'batchId is required.');
  if (!OBJECT_ID.test(String(batchId))) throw new ApiError(400, 'Invalid batchId.');

  const exists = await UploadBatch.exists({ _id: batchId });
  if (!exists) throw new ApiError(404, 'Upload batch not found.');

  return String(batchId);
}

/** Builds the validated filter object that kpi.service.js turns into a $match. */
async function parseFilters(query) {
  const filters = {
    batchId: await requireBatchId(query.batchId),
    startDate: parseDateParam(query.startDate, 'startDate'),
    endDate: parseDateParam(query.endDate, 'endDate', { endOfDay: true }),
    categories: toList(query.category),
    regions: toList(query.region),
  };

  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
    throw new ApiError(400, 'startDate must not be after endDate.');
  }
  return filters;
}

/** GET /api/v1/analytics/overview — 5 KPIs, growth and filter dropdown options. */
export async function overview(req, res) {
  const filters = await parseFilters(req.query);
  res.json(await getOverview(filters));
}

/** GET /api/v1/analytics/trends — time series [{ date, revenue, orders }]. */
export async function trends(req, res) {
  const filters = await parseFilters(req.query);

  const granularity = req.query.granularity ?? 'month';
  if (!GRANULARITIES.includes(granularity)) {
    throw new ApiError(400, `Invalid granularity. Use one of: ${GRANULARITIES.join(', ')}.`);
  }

  res.json(await getTrends(filters, granularity));
}

/** GET /api/v1/analytics/breakdowns — top products/customers, category + region distribution. */
export async function breakdowns(req, res) {
  const filters = await parseFilters(req.query);
  res.json(await getBreakdowns(filters));
}

/** GET /api/v1/analytics/forecast — history + next N months, trend direction and R². */
export async function forecast(req, res) {
  const batchId = await requireBatchId(req.query.batchId);

  let horizon = DEFAULT_HORIZON;
  if (req.query.horizon !== undefined) {
    horizon = Number(req.query.horizon);
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > MAX_HORIZON) {
      throw new ApiError(400, `horizon must be a whole number between 1 and ${MAX_HORIZON}.`);
    }
  }

  const monthlyRevenue = await getMonthlyRevenue(batchId);
  res.json(calculateForecast(monthlyRevenue, horizon));
}

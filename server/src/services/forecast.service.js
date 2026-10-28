import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import { linearRegression, linearRegressionLine, rSquared } from 'simple-statistics';

dayjs.extend(utc);

/**
 * Sales forecasting engine. A deterministic, explainable model:
 *
 *   1. Monthly revenue history -> points (x_i, y_i), x = 0, 1, 2 ...
 *   2. Ordinary Least Squares linear regression:
 *        m = (nΣxy − ΣxΣy) / (nΣx² − (Σx)²),   b = (Σy − mΣx) / n
 *   3. 3-month Weighted Moving Average (weights 1-2-3, newest heaviest)
 *      to capture recent momentum the straight line misses.
 *   4. Blend: forecast = 70% linear trend + 30% WMA, for the next `horizon`
 *      months (x_n, x_n+1, x_n+2 ...).
 *   5. R² of the regression is returned so the UI can show a confidence badge.
 *   6. Each forecast month also carries a 95% prediction range (lower/upper),
 *      so the chart can show how uncertain the number is. The range is the
 *      standard OLS prediction interval, widest for the months furthest ahead
 *      and for noisy histories, centred on the blended forecast.
 *
 * With fewer than 3 months of history a regression is not meaningful, so the
 * engine falls back to a Simple Moving Average (and gives no range).
 */

export const LINEAR_WEIGHT = 0.7;
export const WMA_WEIGHT = 0.3;
export const MOVING_AVERAGE_WINDOW = 3;
export const MIN_POINTS_FOR_REGRESSION = 3;
export const DEFAULT_HORIZON = 3;
export const MAX_HORIZON = 12;

/** A slope smaller than this share of the average month counts as "flat". */
export const FLAT_TOLERANCE = 0.01;

export const INTERVAL_CONFIDENCE = 0.95;

// Two-sided 95% Student-t critical values by degrees of freedom (index = df).
const T_95 = [
  NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16,
  2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052,
  2.048, 2.045, 2.042,
];
const tCritical = (df) => (df <= 30 ? T_95[df] : 1.96);

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** Simple Moving Average over the last `window` values. */
export function simpleMovingAverage(values, window = MOVING_AVERAGE_WINDOW) {
  const slice = values.slice(-window);
  if (slice.length === 0) return 0;
  return slice.reduce((sum, v) => sum + v, 0) / slice.length;
}

/** Weighted Moving Average over the last `window` values (weights 1..window, newest heaviest). */
export function weightedMovingAverage(values, window = MOVING_AVERAGE_WINDOW) {
  const slice = values.slice(-window);
  if (slice.length === 0) return 0;
  let weighted = 0;
  let weightSum = 0;
  slice.forEach((value, index) => {
    const weight = index + 1;
    weighted += value * weight;
    weightSum += weight;
  });
  return weighted / weightSum;
}

/**
 * Regression needs a gap-free time index, so months with no sales between the
 * first and last month are inserted with revenue 0.
 * @param {{month: string, revenue: number}[]} series  sorted ascending, "YYYY-MM"
 */
export function fillMissingMonths(series) {
  if (series.length === 0) return [];

  const byMonth = new Map(series.map((p) => [p.month, p.revenue]));
  const first = dayjs.utc(`${series[0].month}-01`);
  const last = dayjs.utc(`${series[series.length - 1].month}-01`);

  const filled = [];
  for (let cursor = first; !cursor.isAfter(last); cursor = cursor.add(1, 'month')) {
    const month = cursor.format('YYYY-MM');
    filled.push({ month, revenue: byMonth.get(month) ?? 0 });
  }
  return filled;
}

function nextMonths(lastMonth, count) {
  const start = dayjs.utc(`${lastMonth}-01`);
  return Array.from({ length: count }, (_, i) => start.add(i + 1, 'month').format('YYYY-MM'));
}

function confidenceLabel(r2) {
  if (r2 >= 0.7) return 'High';
  if (r2 >= 0.4) return 'Medium';
  return 'Low';
}

function clampHorizon(horizon) {
  const n = Math.floor(Number(horizon));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_HORIZON;
  return Math.min(n, MAX_HORIZON);
}

function direction(delta, scale) {
  if (Math.abs(delta) <= FLAT_TOLERANCE * Math.max(scale, 1)) return 'flat';
  return delta > 0 ? 'upward' : 'downward';
}

/**
 * @param {{month: string, revenue: number}[]} monthlySeries  revenue per "YYYY-MM", ascending
 * @param {number} [horizon=3]  months to project
 */
export function calculateForecast(monthlySeries, horizon = DEFAULT_HORIZON) {
  const steps = clampHorizon(horizon);
  const historical = fillMissingMonths(monthlySeries);
  const n = historical.length;

  const base = {
    horizon: steps,
    dataPoints: n,
    historical: historical.map((p) => ({ month: p.month, revenue: round2(p.revenue) })),
    forecast: [],
    trend: null,
    trendDirection: null,
    slope: null,
    intercept: null,
    rSquared: null,
    confidence: null,
    intervalConfidence: null,
    method: 'insufficient_data',
    methodUsed: 'Not enough history to forecast',
    note: null,
  };

  if (n === 0) {
    return { ...base, note: 'No sales history available to forecast from.' };
  }

  const values = historical.map((p) => p.revenue);
  const months = nextMonths(historical[n - 1].month, steps);
  const extended = [...values]; // history + predictions so far (the moving average rolls forward)
  const mean = values.reduce((s, v) => s + v, 0) / n;

  /* ---- Fewer than 3 months: Simple Moving Average fallback ---- */
  if (n < MIN_POINTS_FOR_REGRESSION) {
    const forecast = months.map((month) => {
      const predicted = simpleMovingAverage(extended);
      extended.push(predicted);
      return { month, revenue: round2(Math.max(0, predicted)), lower: null, upper: null };
    });

    const trendDirection = n === 2 ? direction(values[1] - values[0], mean) : null;

    return {
      ...base,
      forecast,
      method: 'sma',
      methodUsed: 'Simple moving average (fewer than 3 months of history)',
      trend: trendDirection,
      trendDirection,
      note: `Only ${n} month(s) of history (minimum ${MIN_POINTS_FOR_REGRESSION} needed for a regression trend); using a Simple Moving Average instead.`,
    };
  }

  /* ---- Linear regression (OLS) + WMA blend ---- */
  const points = values.map((y, x) => [x, y]);
  const { m: slope, b: intercept } = linearRegression(points);
  const line = linearRegressionLine({ m: slope, b: intercept });

  // A perfectly constant history has zero variance, so R² is undefined; the
  // flat line fits it exactly, so report 1.
  const totalVariance = values.reduce((s, v) => s + (v - mean) ** 2, 0);
  const r2 = totalVariance === 0 ? 1 : Math.max(0, Math.min(1, rSquared(points, line)));

  // Prediction-interval ingredients: residual standard error and Σ(x − x̄)².
  const df = n - 2;
  const sse = points.reduce((s, [x, y]) => s + (y - line(x)) ** 2, 0);
  const residualSd = Math.sqrt(sse / df);
  const xMean = (n - 1) / 2;
  const sxx = points.reduce((s, [x]) => s + (x - xMean) ** 2, 0);
  const t = tCritical(df);

  const forecast = months.map((month, k) => {
    const linearPart = line(n + k);
    const wmaPart = weightedMovingAverage(extended);
    const predicted = Math.max(0, LINEAR_WEIGHT * linearPart + WMA_WEIGHT * wmaPart);
    extended.push(predicted);

    const halfWidth = t * residualSd * Math.sqrt(1 + 1 / n + (n + k - xMean) ** 2 / sxx);

    return {
      month,
      revenue: round2(predicted),
      lower: round2(Math.max(0, predicted - halfWidth)),
      upper: round2(predicted + halfWidth),
    };
  });

  const trendDirection = direction(slope, mean);

  return {
    ...base,
    forecast,
    method: 'linear_wma_blend',
    methodUsed: '70% OLS linear regression + 30% 3-month weighted moving average',
    trend: trendDirection,
    trendDirection,
    slope: round2(slope),
    intercept: round2(intercept),
    rSquared: round4(r2),
    confidence: confidenceLabel(r2),
    intervalConfidence: INTERVAL_CONFIDENCE,
    note: null,
  };
}

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
 *
 * With fewer than 3 months of history a regression is not meaningful, so the
 * engine falls back to a Simple Moving Average.
 */

export const LINEAR_WEIGHT = 0.7;
export const WMA_WEIGHT = 0.3;
export const MOVING_AVERAGE_WINDOW = 3;
export const MIN_POINTS_FOR_REGRESSION = 3;
export const DEFAULT_HORIZON = 3;
export const MAX_HORIZON = 12;

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
    slope: null,
    intercept: null,
    rSquared: null,
    confidence: null,
    method: 'insufficient_data',
    note: null,
  };

  if (n === 0) {
    return { ...base, note: 'No sales history available to forecast from.' };
  }

  const values = historical.map((p) => p.revenue);
  const months = nextMonths(historical[n - 1].month, steps);
  const extended = [...values]; // history + predictions so far (the moving average rolls forward)

  /* ---- Fewer than 3 months: Simple Moving Average fallback ---- */
  if (n < MIN_POINTS_FOR_REGRESSION) {
    const forecast = months.map((month) => {
      const predicted = simpleMovingAverage(extended);
      extended.push(predicted);
      return { month, revenue: round2(Math.max(0, predicted)) };
    });

    return {
      ...base,
      forecast,
      method: 'sma',
      trend: n === 2 ? (values[1] >= values[0] ? 'upward' : 'downward') : null,
      note: `Only ${n} month(s) of history (minimum ${MIN_POINTS_FOR_REGRESSION} needed for a regression trend); using a Simple Moving Average instead.`,
    };
  }

  /* ---- Linear regression (OLS) + WMA blend ---- */
  const points = values.map((y, x) => [x, y]);
  const { m: slope, b: intercept } = linearRegression(points);
  const line = linearRegressionLine({ m: slope, b: intercept });

  // A perfectly constant history has zero variance, so R² is undefined; the
  // flat line fits it exactly, so report 1.
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const totalVariance = values.reduce((s, v) => s + (v - mean) ** 2, 0);
  const r2 = totalVariance === 0 ? 1 : Math.max(0, Math.min(1, rSquared(points, line)));

  const forecast = months.map((month, k) => {
    const linearPart = line(n + k);
    const wmaPart = weightedMovingAverage(extended);
    const predicted = Math.max(0, LINEAR_WEIGHT * linearPart + WMA_WEIGHT * wmaPart);
    extended.push(predicted);
    return { month, revenue: round2(predicted) };
  });

  return {
    ...base,
    forecast,
    method: 'linear_wma_blend',
    trend: slope >= 0 ? 'upward' : 'downward',
    slope: round2(slope),
    intercept: round2(intercept),
    rSquared: round4(r2),
    confidence: confidenceLabel(r2),
    note: null,
  };
}

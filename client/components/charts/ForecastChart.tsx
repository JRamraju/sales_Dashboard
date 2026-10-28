// client/components/charts/ForecastChart.tsx
'use client';

import React from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { ForecastResponse } from '@/types/dashboard.types';

interface ForecastChartProps {
  forecastData: ForecastResponse | null;
  loading?: boolean;
}

const formatCompactCurrency = (val: number): string => {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
};

export const ForecastChart: React.FC<ForecastChartProps> = ({
  forecastData,
  loading = false,
}) => {
  const series = forecastData?.combinedSeries ?? [];
  const rSquared = Number(forecastData?.rSquared ?? 0);
  const confidence = forecastData?.confidenceLabel ?? 'Moderate';
  const isUpward = forecastData?.trendDirection !== 'downward';

  return (
    <div
      id="sales-forecast"
      className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs scroll-mt-28"
    >
      {/* Header & R² Confidence Metadata Badge */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-600" />
            <h2 className="text-base font-bold text-slate-900">
              3-Month Sales Forecast (OLS Regression + WMA)
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {forecastData?.methodUsed ||
              '70% Ordinary Least Squares Linear Trend + 30% 3-Month Weighted Moving Average'}
          </p>
        </div>

        {forecastData && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Trend Slope Badge */}
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                isUpward
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border border-rose-200'
              }`}
            >
              {isUpward ? (
                <TrendingUp className="h-3.5 w-3.5" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5" />
              )}
              <span className="capitalize">
                {forecastData.trendDirection} Trajectory
              </span>
            </span>

            {/* R-Squared Confidence Badge */}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 border border-purple-200 px-3 py-1 text-xs font-semibold text-purple-700">
              <span>
                Forecast Confidence: {confidence} (R² = {rSquared.toFixed(2)})
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Chart Area */}
      {loading ? (
        <div className="h-72 w-full animate-pulse rounded-xl bg-slate-100" />
      ) : series.length === 0 ? (
        <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400">
          Minimum 3 historical months required to generate a statistical forecast.
        </div>
      ) : (
        <>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={series}
                margin={{ top: 10, right: 15, left: 0, bottom: 5 }}
              >
                <defs>
                  <linearGradient
                    id="actualRevenueFill"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
                  </linearGradient>
                </defs>

                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#e2e8f0"
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={{ stroke: '#cbd5e1' }}
                />
                <YAxis
                  tickFormatter={formatCompactCurrency}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={false}
                />

                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderRadius: '12px',
                    border: '1px solid #334155',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                  formatter={(value: any, name: any) => [
                    new Intl.NumberFormat('en-US', {
                      style: 'currency',
                      currency: 'USD',
                    }).format(Number(value)),
                    name,
                  ]}
                />
                <Legend
                  wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                />

                {/* Historical Solid Blue Line / Area */}
                <Area
                  type="monotone"
                  dataKey="actualRevenue"
                  name="Actual Historical Sales"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  fill="url(#actualRevenueFill)"
                  connectNulls={false}
                  activeDot={{ r: 5 }}
                />

                {/* Predicted Dashed Purple Line */}
                <Line
                  type="monotone"
                  dataKey="forecastRevenue"
                  name="Projected Sales (3M Forecast)"
                  stroke="#9333ea"
                  strokeWidth={2.5}
                  strokeDasharray="6 6"
                  dot={{ r: 4, fill: '#9333ea' }}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Next 3 Predicted Months Mini Callout Cards */}
          {forecastData && forecastData.forecast.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3 pt-3 border-t border-slate-100">
              {forecastData.forecast.map((item) => (
                <div
                  key={item.date}
                  className="flex items-center justify-between rounded-xl bg-purple-50/60 border border-purple-100 px-3.5 py-2"
                >
                  <span className="text-xs font-semibold text-purple-900">
                    {item.date} (Projected)
                  </span>
                  <span className="text-xs font-bold text-purple-700">
                    {new Intl.NumberFormat('en-US', {
                      style: 'currency',
                      currency: 'USD',
                      maximumFractionDigits: 0,
                    }).format(item.predictedRevenue)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
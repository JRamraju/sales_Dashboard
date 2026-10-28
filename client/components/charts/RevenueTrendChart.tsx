// client/components/charts/RevenueTrendChart.tsx
'use client';

import React from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Calendar, TrendingUp } from 'lucide-react';
import { Granularity, RevenueTrendPoint } from '@/types/dashboard.types';
import { useFilterContext } from '@/context/FilterContext';

interface RevenueTrendChartProps {
  data: RevenueTrendPoint[];
  loading?: boolean;
}

const formatCompactCurrency = (val: number): string => {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
};

export const RevenueTrendChart: React.FC<RevenueTrendChartProps> = ({
  data,
  loading = false,
}) => {
  const { granularity, setGranularity } = useFilterContext();

  const granularityOptions: { value: Granularity; label: string }[] = [
    { value: 'day', label: 'Daily' },
    { value: 'week', label: 'Weekly' },
    { value: 'month', label: 'Monthly' },
  ];

  return (
    <div
      id="revenue-trends"
      className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs scroll-mt-28"
    >
      {/* Header & Granularity Toggle */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-indigo-600" />
            <h2 className="text-base font-bold text-slate-900">
              Revenue & Order Volume Trend
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Historical revenue trajectory alongside distinct order counts
          </p>
        </div>

        <div className="inline-flex items-center gap-1 rounded-xl bg-slate-100 p-1 self-start sm:self-auto">
          <Calendar className="h-3.5 w-3.5 text-slate-400 ml-1.5 mr-0.5" />
          {granularityOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setGranularity(opt.value)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                granularity === opt.value
                  ? 'bg-white text-indigo-600 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart Body */}
      {loading ? (
        <div className="h-80 w-full animate-pulse rounded-xl bg-slate-100" />
      ) : data.length === 0 ? (
        <div className="flex h-80 items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400">
          No time-series data matches the active filter criteria.
        </div>
      ) : (
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 10, right: 15, left: 0, bottom: 5 }}
            >
              <defs>
                <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.0} />
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
                yAxisId="left"
                tickFormatter={formatCompactCurrency}
                tick={{ fontSize: 11, fill: '#64748b' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
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
                formatter={(value: any, name: any) => {
                  if (name === 'Revenue') {
                    return [
                      new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: 'USD',
                      }).format(Number(value)),
                      'Revenue',
                    ];
                  }
                  return [Number(value).toLocaleString(), 'Orders'];
                }}
              />

              <Area
                yAxisId="left"
                type="monotone"
                dataKey="revenue"
                name="Revenue"
                stroke="#4f46e5"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#revenueFill)"
                activeDot={{ r: 5, strokeWidth: 0 }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="orders"
                name="Orders"
                stroke="#0ea5e9"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};
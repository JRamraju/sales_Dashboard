// client/components/charts/CategoryPieChart.tsx
'use client';

import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Globe, PieChart as PieIcon } from 'lucide-react';
import { DimensionDistributionItem } from '@/types/dashboard.types';
import { formatCompactINR, formatINR } from '@/lib/format';

interface CategoryPieChartProps {
  categories: DimensionDistributionItem[];
  regions: DimensionDistributionItem[];
  loading?: boolean;
}

const CHART_COLORS = [
  '#4f46e5', // Indigo
  '#0ea5e9', // Sky
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#64748b', // Slate
];

/** Both tabs render inside the same square box so the card never resizes. */
const SQUARE_BOX = 'relative mx-auto aspect-square w-full max-w-[260px]';

const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: '#0f172a',
  borderRadius: '10px',
  border: 'none',
  color: '#fff',
  fontSize: '12px',
};

export const CategoryPieChart: React.FC<CategoryPieChartProps> = ({
  categories,
  regions,
  loading = false,
}) => {
  const [activeTab, setActiveTab] = useState<'category' | 'region'>('category');

  const activeData = activeTab === 'category' ? categories : regions;

  const totalRevenue = useMemo(
    () => activeData.reduce((sum, item) => sum + (item.revenue || 0), 0),
    [activeData]
  );

  return (
    <div
      id="category-region"
      className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs scroll-target"
    >
      {/* Top Header & Tab Switcher */}
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900">
            Dimensional Breakdown
          </h2>
          <p className="text-xs text-slate-500">
            Revenue share by {activeTab === 'category' ? 'Category' : 'Region'}
          </p>
        </div>

        <div className="inline-flex shrink-0 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('category')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'category'
                ? 'bg-white text-indigo-600 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <PieIcon className="h-3.5 w-3.5" />
            <span>Category</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('region')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'region'
                ? 'bg-white text-indigo-600 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Globe className="h-3.5 w-3.5" />
            <span>Region</span>
          </button>
        </div>
      </div>

      {/* Chart + legend sit together; any spare card height is split evenly
          above and below instead of opening a hole between them. */}
      <div className="flex flex-1 flex-col justify-center">
        {/* Square visualization box */}
        {loading ? (
          <div className={`${SQUARE_BOX} animate-pulse rounded-xl bg-slate-100`} />
        ) : activeData.length === 0 ? (
          <div
            className={`${SQUARE_BOX} flex items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400`}
          >
            No distribution data available.
          </div>
        ) : activeTab === 'category' ? (
          /* Donut Chart for Category Share */
          <div className={SQUARE_BOX}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categories}
                  dataKey="revenue"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="62%"
                  outerRadius="92%"
                  paddingAngle={3}
                  stroke="none"
                >
                  {categories.map((entry, idx) => (
                    <Cell
                      key={entry.name}
                      fill={CHART_COLORS[idx % CHART_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value) => formatINR(value)}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Donut centre label */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Total
              </span>
              <span className="text-lg font-bold tracking-tight text-slate-900">
                {formatCompactINR(totalRevenue)}
              </span>
            </div>
          </div>
        ) : (
          /* Horizontal Bar Chart for Regional Performance */
          <div className={SQUARE_BOX}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={regions}
                layout="vertical"
                margin={{ top: 5, right: 16, left: 0, bottom: 5 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  horizontal={false}
                  stroke="#e2e8f0"
                />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  tickFormatter={formatCompactINR}
                  tickCount={4}
                  interval="preserveStartEnd"
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={72}
                  interval={0}
                  tick={{ fontSize: 11, fill: '#334155', fontWeight: 600 }}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value) => formatINR(value)}
                />
                <Bar dataKey="revenue" radius={[0, 6, 6, 0]}>
                  {regions.map((entry, idx) => (
                    <Cell
                      key={entry.name}
                      fill={CHART_COLORS[idx % CHART_COLORS.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Legend Breakdown List */}
        {!loading && activeData.length > 0 && (
          <div
            className={`mt-4 space-y-2 border-t border-slate-100 pt-3 ${
              activeData.length > 8 ? 'max-h-48 overflow-y-auto' : ''
            }`}
          >
            {activeData.map((item, idx) => (
              <div
                key={item.name}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
                    }}
                  />
                  <span className="truncate font-medium text-slate-700">
                    {item.name}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-semibold text-slate-900">
                    {formatINR(item.revenue, { maximumFractionDigits: 0 })}
                  </span>
                  <span className="w-12 text-right text-[11px] font-medium text-slate-500">
                    {item.percentage.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

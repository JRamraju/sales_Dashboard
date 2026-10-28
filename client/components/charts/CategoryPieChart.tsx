// client/components/charts/CategoryPieChart.tsx
'use client';

import React, { useState } from 'react';
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

export const CategoryPieChart: React.FC<CategoryPieChartProps> = ({
  categories,
  regions,
  loading = false,
}) => {
  const [activeTab, setActiveTab] = useState<'category' | 'region'>('category');

  const activeData = activeTab === 'category' ? categories : regions;

  return (
    <div
      id="category-region"
      className="flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs scroll-mt-28"
    >
      {/* Top Header & Tab Switcher */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Dimensional Breakdown
            </h2>
            <p className="text-xs text-slate-500">
              Revenue share by {activeTab === 'category' ? 'Category' : 'Region'}
            </p>
          </div>

          <div className="inline-flex rounded-xl bg-slate-100 p-1">
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

        {/* Visualization Area */}
        {loading ? (
          <div className="h-64 w-full animate-pulse rounded-xl bg-slate-100" />
        ) : activeData.length === 0 ? (
          <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400">
            No distribution data available.
          </div>
        ) : activeTab === 'category' ? (
          /* Donut Chart for Category Share */
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categories}
                  dataKey="revenue"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={88}
                  paddingAngle={3}
                >
                  {categories.map((entry, idx) => (
                    <Cell
                      key={entry.name}
                      fill={CHART_COLORS[idx % CHART_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderRadius: '10px',
                    border: 'none',
                    color: '#fff',
                    fontSize: '12px',
                  }}
                  formatter={(value: any) =>
                    new Intl.NumberFormat('en-US', {
                      style: 'currency',
                      currency: 'USD',
                    }).format(Number(value))
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          /* Horizontal Bar Chart for Regional Performance */
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={regions}
                layout="vertical"
                margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  horizontal={false}
                  stroke="#e2e8f0"
                />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickFormatter={(v) =>
                    v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                  }
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={80}
                  tick={{ fontSize: 11, fill: '#334155', fontWeight: 600 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderRadius: '10px',
                    border: 'none',
                    color: '#fff',
                    fontSize: '12px',
                  }}
                  formatter={(value: any) =>
                    new Intl.NumberFormat('en-US', {
                      style: 'currency',
                      currency: 'USD',
                    }).format(Number(value))
                  }
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
      </div>

      {/* Legend Breakdown List */}
      {!loading && activeData.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 max-h-48 overflow-y-auto">
          {activeData.map((item, idx) => (
            <div
              key={item.name}
              className="flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2 truncate">
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
                  }}
                />
                <span className="font-medium text-slate-700 truncate">
                  {item.name}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-semibold text-slate-900">
                  {new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: 'USD',
                    maximumFractionDigits: 0,
                  }).format(item.revenue)}
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
  );
};
// client/components/charts/TopProductsBarChart.tsx
'use client';

import React, { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart2, Package, Table as TableIcon } from 'lucide-react';
import { ProductPerformanceItem } from '@/types/dashboard.types';

interface TopProductsBarChartProps {
  products: ProductPerformanceItem[];
  loading?: boolean;
}

export const TopProductsBarChart: React.FC<TopProductsBarChartProps> = ({
  products,
  loading = false,
}) => {
  const [viewMode, setViewMode] = useState<'split' | 'chart' | 'table'>('split');

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <Package className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Top 10 Products Performance
            </h2>
            <p className="text-xs text-slate-500">
              Ranked by total validated revenue and units sold
            </p>
          </div>
        </div>

        <div className="inline-flex rounded-xl bg-slate-100 p-1 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setViewMode('split')}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
              viewMode === 'split'
                ? 'bg-white text-indigo-600 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Combined
          </button>
          <button
            type="button"
            onClick={() => setViewMode('chart')}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
              viewMode === 'chart'
                ? 'bg-white text-indigo-600 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BarChart2 className="h-3.5 w-3.5" />
            <span>Chart</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
              viewMode === 'table'
                ? 'bg-white text-indigo-600 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <TableIcon className="h-3.5 w-3.5" />
            <span>Table</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="h-80 w-full animate-pulse rounded-xl bg-slate-100" />
      ) : products.length === 0 ? (
        <div className="flex h-80 items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400">
          No product performance records found.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Horizontal Bar Chart */}
          {(viewMode === 'split' || viewMode === 'chart') && (
            <div className={viewMode === 'chart' ? 'h-80 w-full' : 'h-52 w-full'}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={products.slice(0, 8)}
                  layout="vertical"
                  margin={{ top: 4, right: 20, left: 10, bottom: 4 }}
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
                    dataKey="productName"
                    width={125}
                    tick={{ fontSize: 11, fill: '#334155' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderRadius: '10px',
                      border: 'none',
                      color: '#fff',
                      fontSize: '12px',
                    }}
                    formatter={(value: any) => [
                      new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: 'USD',
                      }).format(Number(value)),
                      'Revenue',
                    ]}
                  />
                  <Bar
                    dataKey="totalRevenue"
                    fill="#4f46e5"
                    radius={[0, 6, 6, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Product Breakdown Table */}
          {(viewMode === 'split' || viewMode === 'table') && (
            <div className="overflow-x-auto max-h-64 overflow-y-auto border-t border-slate-100 pt-2">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-3">Product Name</th>
                    <th className="py-2 px-3">Category</th>
                    <th className="py-2 px-3 text-right">Units Sold</th>
                    <th className="py-2 px-3 text-right">Total Revenue</th>
                    <th className="py-2 pl-3 text-right">% of Sales</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {products.map((prod, idx) => (
                    <tr
                      key={`${prod.productId || prod.productName}-${idx}`}
                      className="hover:bg-slate-50/80"
                    >
                      <td className="py-2.5 pr-3 font-semibold text-slate-800 max-w-[160px] truncate">
                        {prod.productName}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                          {prod.category}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-slate-700">
                        {prod.unitsSold.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                        {new Intl.NumberFormat('en-US', {
                          style: 'currency',
                          currency: 'USD',
                          maximumFractionDigits: 0,
                        }).format(prod.totalRevenue)}
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                          {prod.percentageOfSales.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
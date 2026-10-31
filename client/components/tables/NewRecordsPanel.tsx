// client/components/tables/NewRecordsPanel.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { AlertCircle, Package, RefreshCw, UserPlus, Users } from 'lucide-react';
import { getNewRecords } from '@/api/analytics.api';
import { useFilterContext } from '@/context/FilterContext';
import { formatINR, formatNumber } from '@/lib/format';
import { NewRecordsFile } from '@/types/dashboard.types';

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value.slice(0, 10)
    : d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
};

const comparedLabel = (file: NewRecordsFile) => {
  const nums = file.comparedWith.map((f) => f.fileNumber);
  if (nums.length === 0) return '';
  if (nums.length === 1) return `File ${nums[0]}`;
  return `Files ${nums[0]}–${nums[nums.length - 1]}`;
};

const StatTile: React.FC<{
  icon: React.ElementType;
  label: string;
  count: number;
  revenue: number;
  tone: 'emerald' | 'indigo';
}> = ({ icon: Icon, label, count, revenue, tone }) => (
  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
        tone === 'emerald'
          ? 'bg-emerald-50 text-emerald-600'
          : 'bg-indigo-50 text-indigo-600'
      }`}
    >
      <Icon className="h-4 w-4" />
    </div>
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="text-lg font-bold leading-tight text-slate-900">
        {formatNumber(count)}
      </p>
      <p className="text-[11px] text-slate-500">
        {formatINR(revenue, { maximumFractionDigits: 0 })} revenue
      </p>
    </div>
  </div>
);

/**
 * For each file: the customers and products that appear in it but in no
 * earlier file (GET /analytics/new-records). Follows the file selection;
 * category / region / date filters do not apply to "is it new".
 */
export const NewRecordsPanel: React.FC = () => {
  const { selectedBatchIds, datasetVersion, hasDataset } = useFilterContext();

  const [files, setFiles] = useState<NewRecordsFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tabId, setTabId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const loadKey = selectedBatchIds.join(',');

  useEffect(() => {
    if (!hasDataset) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear when no data
      setFiles([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    getNewRecords(
      { batchIds: loadKey ? loadKey.split(',') : [], limit: 100 },
      { signal: controller.signal }
    )
      .then((res) => setFiles(res.files))
      .catch((err) => {
        if (axios.isCancel(err) || err?.name === 'CanceledError') return;
        setError(err?.message || 'Could not load new customers and products.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [hasDataset, loadKey, datasetVersion, reload]);

  // Default to the newest file; keep the user's tab while it still exists.
  const activeFile = useMemo(
    () =>
      files.find((f) => f.batchId === tabId) ?? files[files.length - 1] ?? null,
    [files, tabId]
  );

  const retry = useCallback(() => setReload((n) => n + 1), []);

  return (
    <section
      id="new-records"
      className="scroll-target rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs"
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <UserPlus className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              New Customers &amp; Products by File
            </h2>
            <p className="text-xs text-slate-500">
              Records that first appear in a file and in none uploaded before it
            </p>
          </div>
        </div>

        {files.length > 1 && (
          <div
            role="tablist"
            aria-label="Choose a file"
            className="flex max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1"
          >
            {files.map((f) => (
              <button
                key={f.batchId}
                role="tab"
                type="button"
                aria-selected={activeFile?.batchId === f.batchId}
                onClick={() => setTabId(f.batchId)}
                title={f.fileName}
                className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                  activeFile?.batchId === f.batchId
                    ? 'bg-white text-indigo-600 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                File {f.fileNumber}
              </button>
            ))}
          </div>
        )}
      </div>

      {error ? (
        <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </span>
          <button
            type="button"
            onClick={retry}
            className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 font-semibold text-white hover:bg-rose-500 cursor-pointer"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      ) : loading && !activeFile ? (
        <div className="h-64 w-full animate-pulse rounded-xl bg-slate-100" />
      ) : !activeFile ? (
        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400">
          Select at least one finished file to see its new records.
        </div>
      ) : activeFile.isFirstFile ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center">
          <p className="text-sm font-semibold text-slate-800">
            File {activeFile.fileNumber} is the baseline
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
            Nothing comes before it to compare with, so nothing is listed as
            new. New customers and products start from File 2.
          </p>
        </div>
      ) : (
        <div className={loading ? 'opacity-60 transition-opacity' : ''}>
          <p className="mb-3 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">
              File {activeFile.fileNumber} · {activeFile.fileName}
            </span>{' '}
            compared with {comparedLabel(activeFile)}
          </p>

          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatTile
              icon={Users}
              tone="emerald"
              label="New customers"
              count={activeFile.newCustomers.count}
              revenue={activeFile.newCustomers.revenue}
            />
            <StatTile
              icon={Package}
              tone="indigo"
              label="New products"
              count={activeFile.newProducts.count}
              revenue={activeFile.newProducts.revenue}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {/* New customers */}
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div data-lenis-prevent className="max-h-80 overflow-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <th className="px-3 py-2">Customer</th>
                      <th className="px-3 py-2 text-right">Orders</th>
                      <th className="px-3 py-2 text-right">Revenue</th>
                      <th className="hidden px-3 py-2 sm:table-cell">First order</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {activeFile.newCustomers.items.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-slate-400">
                          No new customers in this file.
                        </td>
                      </tr>
                    ) : (
                      activeFile.newCustomers.items.map((c) => (
                        <tr key={c.customerId} className="hover:bg-slate-50/80">
                          <td className="px-3 py-2">
                            <span className="block font-medium text-slate-800">
                              {c.customerName}
                            </span>
                            <span className="block font-mono text-[10px] text-slate-400">
                              {c.customerId}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700">
                            {formatNumber(c.orders)}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-800">
                            {formatINR(c.revenue, { maximumFractionDigits: 0 })}
                          </td>
                          <td className="hidden px-3 py-2 text-slate-500 sm:table-cell">
                            {formatDate(c.firstOrderDate)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {activeFile.newCustomers.truncated && (
                <p className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                  Showing the top {activeFile.newCustomers.items.length} of{' '}
                  {formatNumber(activeFile.newCustomers.count)} by revenue. The
                  totals above cover all of them.
                </p>
              )}
            </div>

            {/* New products */}
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div data-lenis-prevent className="max-h-80 overflow-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <th className="px-3 py-2">Product</th>
                      <th className="hidden px-3 py-2 sm:table-cell">Category</th>
                      <th className="px-3 py-2 text-right">Units</th>
                      <th className="px-3 py-2 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {activeFile.newProducts.items.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-slate-400">
                          No new products in this file.
                        </td>
                      </tr>
                    ) : (
                      activeFile.newProducts.items.map((p) => (
                        <tr key={p.productId} className="hover:bg-slate-50/80">
                          <td className="px-3 py-2">
                            <span className="block font-medium text-slate-800">
                              {p.productName}
                            </span>
                            <span className="block font-mono text-[10px] text-slate-400">
                              {p.productId}
                            </span>
                          </td>
                          <td className="hidden px-3 py-2 text-slate-600 sm:table-cell">
                            {p.category}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-700">
                            {formatNumber(p.unitsSold)}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-800">
                            {formatINR(p.revenue, { maximumFractionDigits: 0 })}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {activeFile.newProducts.truncated && (
                <p className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                  Showing the top {activeFile.newProducts.items.length} of{' '}
                  {formatNumber(activeFile.newProducts.count)} by revenue. The
                  totals above cover all of them.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
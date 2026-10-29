// client/components/tables/CustomerSalesTable.tsx
'use client';

import React, { useMemo, useState } from 'react';
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Users,
} from 'lucide-react';
import { CustomerLeaderboardItem } from '@/types/dashboard.types';
import { formatINR } from '@/lib/format';

interface CustomerSalesTableProps {
  customers: CustomerLeaderboardItem[];
  loading?: boolean;
}

type SortKey =
  | 'customerName'
  | 'totalOrders'
  | 'totalSpend'
  | 'averageOrderValue'
  | 'lastPurchaseDate';

export const CustomerSalesTable: React.FC<CustomerSalesTableProps> = ({
  customers,
  loading = false,
}) => {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('totalSpend');
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  // 8 rows lines the card up with the Products card next to it (chart + table).
  const pageSize = 8;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
    setPage(1);
  };

  const filteredAndSorted = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? customers.filter(
          (c) =>
            c.customerName.toLowerCase().includes(query) ||
            (c.customerId ?? '').toLowerCase().includes(query)
        )
      : [...customers];

    filtered.sort((a, b) => {
      const valA = a[sortKey];
      const valB = b[sortKey];

      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortAsc ? valA - valB : valB - valA;
      }
      return sortAsc
        ? String(valA).localeCompare(String(valB))
        : String(valB).localeCompare(String(valA));
    });

    return filtered;
  }, [customers, search, sortKey, sortAsc]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredAndSorted.length / pageSize)
  );
  const paginatedRows = filteredAndSorted.slice(
    (page - 1) * pageSize,
    page * pageSize
  );

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr.slice(0, 10);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
      {/* Header & Search Input */}
      <div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Top Customer Leaderboard
              </h2>
              <p className="text-xs text-slate-500">
                High-value accounts by total spend and order frequency
              </p>
            </div>
          </div>

          <div className="relative w-full sm:w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search customer..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Table Content */}
        {loading ? (
          <div className="h-80 w-full animate-pulse rounded-xl bg-slate-100" />
        ) : filteredAndSorted.length === 0 ? (
          <div className="flex h-80 items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400">
            No matching customer records found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 pr-3">
                    <button
                      type="button"
                      onClick={() => handleSort('customerName')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                    >
                      <span>Customer</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('totalOrders')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                    >
                      <span>Orders</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('totalSpend')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                    >
                      <span>Total Spend</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('averageOrderValue')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                    >
                      <span>AOV</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="py-2.5 pl-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSort('lastPurchaseDate')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                    >
                      <span>Last Purchase</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {paginatedRows.map((cust, idx) => (
                  <tr
                    key={`${cust.customerId || cust.customerName}-${idx}`}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="py-3 pr-3">
                      <p className="font-semibold text-slate-900 truncate max-w-[160px]">
                        {cust.customerName}
                      </p>
                      {cust.customerId && (
                        <p className="text-[10px] font-mono text-slate-400">
                          {cust.customerId}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-medium text-slate-700">
                      {cust.totalOrders.toLocaleString()}
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-emerald-700">
                      {formatINR(cust.totalSpend, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="py-3 px-3 text-right font-medium text-slate-700">
                      {formatINR(cust.averageOrderValue, {
                        maximumFractionDigits: 0,
                      })}
                    </td>
                    <td className="py-3 pl-3 text-right text-slate-500">
                      {formatDate(cust.lastPurchaseDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      {!loading && filteredAndSorted.length > 0 && (
        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
          <span>
            Showing {(page - 1) * pageSize + 1}–
            {Math.min(page * pageSize, filteredAndSorted.length)} of{' '}
            {filteredAndSorted.length} customers
          </span>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-2 font-semibold text-slate-700">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
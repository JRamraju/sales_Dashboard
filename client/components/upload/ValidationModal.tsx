// client/components/upload/ValidationModal.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { getUploadBatchById } from '@/api/analytics.api';
import { useFilterContext } from '@/context/FilterContext';
import { usePresence } from '@/hooks/usePresence';
import { useScrollLock } from '@/hooks/useScrollLock';
import { UploadBatch, ValidationErrorLog } from '@/types/dashboard.types';

const plural = (n: number, word: string) =>
  `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/** A row skipped because its order_id is already in an earlier file. */
const isDuplicateLog = (log: ValidationErrorLog) =>
  log.field === 'order_id' && /already in/i.test(log.message ?? '');

type LogFilter = 'all' | 'invalid' | 'duplicate';

/**
 * Banner shown at the top of the dashboard after an upload completes, or when
 * a single file with skipped rows is being viewed.
 */
export const DataHealthBanner: React.FC = () => {
  const { healthBanner, activeBatch, dismissHealthBanner, openValidationModal } =
    useFilterContext();

  const summary = useMemo(() => {
    if (healthBanner) return healthBanner;
    if (activeBatch && activeBatch.invalidRowsCount > 0) {
      return {
        batchId: activeBatch._id,
        fileName: activeBatch.fileName,
        inserted: activeBatch.validRowsInserted,
        skipped: activeBatch.invalidRowsCount,
        errorLogs: activeBatch.errorLogs || [],
        customers: undefined,
        products: undefined,
        duplicates: {
          rows: activeBatch.duplicateRowsSkipped ?? 0,
          orders: activeBatch.duplicateOrdersSkipped ?? 0,
        },
      };
    }
    return null;
  }, [healthBanner, activeBatch]);

  if (!summary) return null;

  const hasSkipped = summary.skipped > 0;
  const duplicateRows = summary.duplicates?.rows ?? 0;
  const invalidRows = Math.max(0, summary.skipped - duplicateRows);
  const showLinks = Boolean(healthBanner && (summary.customers || summary.products));

  return (
    <div
      className={`rounded-xl border px-4 py-3 shadow-2xs transition-all ${
        hasSkipped
          ? 'border-amber-300/80 bg-amber-50/90 text-amber-900'
          : 'border-emerald-300/80 bg-emerald-50/90 text-emerald-900'
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start sm:items-center gap-2.5 text-xs sm:text-sm">
          {hasSkipped ? (
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5 sm:mt-0" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5 sm:mt-0" />
          )}
          <div className="space-y-0.5">
            <div>
              <span className="font-semibold">
                Processed <span className="underline">{summary.fileName}</span>:
              </span>{' '}
              <strong>{summary.inserted.toLocaleString()}</strong> valid records
              loaded
              {hasSkipped ? (
                <>
                  . <strong>{summary.skipped.toLocaleString()}</strong> rows
                  skipped
                  {duplicateRows > 0 && (
                    <>
                      {' '}
                      ({plural(invalidRows, 'invalid row')},{' '}
                      {plural(duplicateRows, 'duplicate order row')} already in
                      an earlier file)
                    </>
                  )}
                  .
                </>
              ) : (
                '.'
              )}
            </div>
            {showLinks && (
              <div className="text-[11px] opacity-80 sm:text-xs">
                {summary.customers && (
                  <span>
                    Customers: {summary.customers.created.toLocaleString()} new,{' '}
                    {summary.customers.existing.toLocaleString()} already known
                  </span>
                )}
                {summary.customers && summary.products && ' · '}
                {summary.products && (
                  <span>
                    Products: {summary.products.created.toLocaleString()} new,{' '}
                    {summary.products.existing.toLocaleString()} already known
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          {hasSkipped && (
            <button
              type="button"
              onClick={() => openValidationModal(summary.batchId)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-amber-500 transition-colors cursor-pointer"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>View Skipped Rows ({summary.skipped})</span>
            </button>
          )}

          {healthBanner && (
            <button
              type="button"
              onClick={dismissHealthBanner}
              aria-label="Dismiss banner"
              className="rounded-lg p-1 text-slate-500 hover:bg-black/5 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Skipped-rows report for one file: invalid rows (failed validation) and
 * duplicate rows (order already in an earlier file).
 */
export const ValidationModal: React.FC = () => {
  const {
    isValidationModalOpen,
    closeValidationModal,
    validationBatchId,
    healthBanner,
    batches,
  } = useFilterContext();

  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<LogFilter>('all');
  const [detail, setDetail] = useState<UploadBatch | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Slides up from the bottom on open and back down on close.
  const { mounted, state } = usePresence(isValidationModalOpen);
  useScrollLock(mounted);

  // GET /uploads leaves errorLogs out, so load the file's full record on open.
  useEffect(() => {
    if (!isValidationModalOpen || !validationBatchId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch lifecycle flag
    setLoadingDetail(true);
    setDetail(null);
    setSearchQuery('');
    setFilter('all');
    getUploadBatchById(validationBatchId)
      .then((batch) => {
        if (!cancelled) setDetail(batch);
      })
      .catch(() => {
        /* fall back to whatever the banner / list already has */
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isValidationModalOpen, validationBatchId]);

  const listed = batches.find((b) => b._id === validationBatchId) ?? null;
  const banner =
    healthBanner && healthBanner.batchId === validationBatchId ? healthBanner : null;

  const errorLogs: ValidationErrorLog[] = useMemo(() => {
    if (detail && detail.errorLogs.length > 0) return detail.errorLogs;
    if (banner && banner.errorLogs?.length > 0) return banner.errorLogs;
    return detail?.errorLogs ?? [];
  }, [detail, banner]);

  const fileName = detail?.fileName ?? banner?.fileName ?? listed?.fileName ?? 'File';
  const fileNumber = detail?.fileNumber ?? listed?.fileNumber ?? null;
  const insertedCount =
    detail?.validRowsInserted ?? banner?.inserted ?? listed?.validRowsInserted ?? 0;
  const skippedCount =
    detail?.invalidRowsCount ??
    banner?.skipped ??
    listed?.invalidRowsCount ??
    errorLogs.length;

  const duplicateCount = errorLogs.filter(isDuplicateLog).length;
  const invalidCount = errorLogs.length - duplicateCount;

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return errorLogs.filter((log) => {
      if (filter === 'duplicate' && !isDuplicateLog(log)) return false;
      if (filter === 'invalid' && isDuplicateLog(log)) return false;
      if (!q) return true;
      const rowStr = String(log.rowNumber ?? log.row ?? '');
      return (
        rowStr.includes(q) ||
        (log.field ?? '').toLowerCase().includes(q) ||
        (log.message ?? '').toLowerCase().includes(q)
      );
    });
  }, [errorLogs, searchQuery, filter]);

  if (!mounted) return null;

  const exportQuarantineCsv = () => {
    const quote = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      'Row Number,Type,Field,Reason',
      ...errorLogs.map((log) =>
        [
          log.rowNumber ?? log.row ?? 'N/A',
          isDuplicateLog(log) ? 'duplicate' : 'invalid',
          quote(log.field ?? 'row'),
          quote(log.message ?? 'Invalid record'),
        ].join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `skipped_rows_${fileName.replace(/\.[^.]+$/, '')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const chips: { id: LogFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: errorLogs.length },
    { id: 'invalid', label: 'Invalid', count: invalidCount },
    { id: 'duplicate', label: 'Duplicate orders', count: duplicateCount },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="validation-dialog-title"
      inert={state === 'closed'}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        data-state={state}
        aria-hidden="true"
        className="popup-overlay absolute inset-0 bg-slate-950/60 backdrop-blur-xs"
      />
      <div
        data-state={state}
        className="popup-panel relative flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h3
                id="validation-dialog-title"
                className="text-base font-bold text-slate-900"
              >
                Skipped Rows Report
              </h3>
              <p className="text-xs text-slate-500">
                {fileNumber ? `File ${fileNumber} · ` : ''}
                {fileName} •{' '}
                <span className="font-semibold text-emerald-600">
                  {insertedCount.toLocaleString()} imported
                </span>
                ,{' '}
                <span className="font-semibold text-amber-600">
                  {skippedCount.toLocaleString()} skipped
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeValidationModal}
            aria-label="Close report"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search, filter & export toolbar */}
        <div className="flex flex-col gap-2.5 border-b border-slate-100 px-6 py-3">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by row number, column, or reason..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {errorLogs.length > 0 && (
              <button
                type="button"
                onClick={exportQuarantineCsv}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 text-slate-500" />
                <span>Export (.CSV)</span>
              </button>
            )}
          </div>

          {duplicateCount > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setFilter(chip.id)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                    filter === chip.id
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {chip.label} ({chip.count.toLocaleString()})
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Skipped rows table */}
        <div data-lenis-prevent className="flex-1 overflow-y-auto px-6 py-4">
          {loadingDetail && errorLogs.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              Loading skipped rows…
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              No matching skipped rows found.
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 pr-4 w-24">Row #</th>
                  <th className="py-2.5 px-4 w-36">Column / Field</th>
                  <th className="py-2.5 pl-4">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredLogs.map((log, index) => {
                  const rowNum = log.rowNumber ?? log.row ?? index + 1;
                  const duplicate = isDuplicateLog(log);
                  return (
                    <tr
                      key={`${rowNum}-${index}`}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-2.5 pr-4 font-mono font-semibold text-slate-800">
                        Row {rowNum}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-700">
                          {log.field || 'record'}
                        </span>
                      </td>
                      <td
                        className={`py-2.5 pl-4 font-medium ${
                          duplicate ? 'text-amber-700' : 'text-rose-700'
                        }`}
                      >
                        {duplicate && (
                          <span className="mr-2 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                            <Copy className="h-2.5 w-2.5" />
                            Duplicate
                          </span>
                        )}
                        {log.message}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3">
          <span className="text-xs text-slate-500">
            Showing {filteredLogs.length.toLocaleString()} of{' '}
            {errorLogs.length.toLocaleString()} logged rows
            {skippedCount > errorLogs.length &&
              ` (log capped; ${skippedCount.toLocaleString()} rows skipped in total)`}
          </span>
          <button
            type="button"
            onClick={closeValidationModal}
            className="shrink-0 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
          >
            Close Report
          </button>
        </div>
      </div>
    </div>
  );
};
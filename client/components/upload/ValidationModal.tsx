// client/components/upload/ValidationModal.tsx
'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useFilterContext } from '@/context/FilterContext';
import { usePresence } from '@/hooks/usePresence';
import { useScrollLock } from '@/hooks/useScrollLock';
import { ValidationErrorLog } from '@/types/dashboard.types';

/**
 * Conditional Data Health Banner shown at the top of the dashboard
 * after an upload completes or when inspecting an active dataset with quarantined rows.
 */
export const DataHealthBanner: React.FC = () => {
  const {
    healthBanner,
    activeBatch,
    dismissHealthBanner,
    openValidationModal,
  } = useFilterContext();

  // Show either the freshly uploaded banner OR a persistent warning if activeBatch has skipped rows
  const summary = useMemo(() => {
    if (healthBanner) return healthBanner;
    if (activeBatch && activeBatch.invalidRowsCount > 0) {
      return {
        batchId: activeBatch._id,
        fileName: activeBatch.fileName,
        inserted: activeBatch.validRowsInserted,
        skipped: activeBatch.invalidRowsCount,
        errorLogs: activeBatch.errorLogs || [],
      };
    }
    return null;
  }, [healthBanner, activeBatch]);

  if (!summary) return null;

  const hasSkipped = summary.skipped > 0;

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
          <div>
            <span className="font-semibold">
              Processed <span className="underline">{summary.fileName}</span>:
            </span>{' '}
            <span>
              <strong>{summary.inserted.toLocaleString()}</strong> valid records
              loaded.{' '}
              <strong>{summary.skipped.toLocaleString()}</strong> invalid rows
              skipped.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          {hasSkipped && (
            <button
              type="button"
              onClick={openValidationModal}
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
 * Quarantine Inspection Modal displaying exact row numbers and Zod validation errors
 */
export const ValidationModal: React.FC = () => {
  const {
    isValidationModalOpen,
    closeValidationModal,
    activeBatch,
    healthBanner,
  } = useFilterContext();

  const [searchQuery, setSearchQuery] = useState('');

  // Slides up from the bottom on open and back down on close.
  const { mounted, state } = usePresence(isValidationModalOpen);
  useScrollLock(mounted);

  const errorLogs: ValidationErrorLog[] = useMemo(() => {
    if (healthBanner && healthBanner.errorLogs?.length > 0) {
      return healthBanner.errorLogs;
    }
    return activeBatch?.errorLogs ?? [];
  }, [healthBanner, activeBatch]);

  const fileName =
    healthBanner?.fileName || activeBatch?.fileName || 'Dataset';
  const insertedCount =
    healthBanner?.inserted ?? activeBatch?.validRowsInserted ?? 0;
  const skippedCount =
    healthBanner?.skipped ?? activeBatch?.invalidRowsCount ?? errorLogs.length;

  const filteredLogs = useMemo(() => {
    if (!searchQuery.trim()) return errorLogs;
    const q = searchQuery.toLowerCase();
    return errorLogs.filter((log) => {
      const rowStr = String(log.rowNumber ?? log.row ?? '');
      const fieldStr = (log.field ?? '').toLowerCase();
      const msgStr = (log.message ?? '').toLowerCase();
      return rowStr.includes(q) || fieldStr.includes(q) || msgStr.includes(q);
    });
  }, [errorLogs, searchQuery]);

  if (!mounted) return null;

  const exportQuarantineCsv = () => {
    const headers = ['Row Number,Field,Validation Error Reason'];
    const rows = errorLogs.map((log) => {
      const rNum = log.rowNumber ?? log.row ?? 'N/A';
      const field = (log.field ?? 'row').replace(/"/g, '""');
      const reason = (log.message ?? 'Invalid record').replace(/"/g, '""');
      return `${rNum},"${field}","${reason}"`;
    });
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `quarantine_report_${fileName}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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
                Data Quarantine & Validation Report
              </h3>
              <p className="text-xs text-slate-500">
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
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search & Export Toolbar */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 px-6 py-3">
          <div className="relative flex-1 max-w-sm">
            <Search className=" absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by row number, column, or error reason..."
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
              <span>Export Error Log (.CSV)</span>
            </button>
          )}
        </div>

        {/* Skipped Rows Table */}
        <div data-lenis-prevent className="flex-1 overflow-y-auto px-6 py-4">
          {filteredLogs.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              No matching validation errors found.
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 pr-4 w-24">Row #</th>
                  <th className="py-2.5 px-4 w-36">Column / Field</th>
                  <th className="py-2.5 pl-4">Quarantine Reason (Zod Schema)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredLogs.map((log, index) => {
                  const rowNum = log.rowNumber ?? log.row ?? index + 1;
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
                      <td className="py-2.5 pl-4 text-rose-700 font-medium">
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
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3">
          <span className="text-xs text-slate-500">
            Showing {filteredLogs.length} of {errorLogs.length} quarantined records
          </span>
          <button
            type="button"
            onClick={closeValidationModal}
            className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
          >
            Close Report
          </button>
        </div>
      </div>
    </div>
  );
};
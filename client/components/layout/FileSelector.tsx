// client/components/layout/FileSelector.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Database, Layers, Trash2 } from 'lucide-react';
import { useFilterContext } from '@/context/FilterContext';
import { usePresence } from '@/hooks/usePresence';
import { confirmDialog, errorDialog, showToast } from '@/lib/alerts';
import { UploadBatch } from '@/types/dashboard.types';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const fileLabel = (batch: UploadBatch) =>
  batch.fileNumber ? `File ${batch.fileNumber}` : 'Pending';

/**
 * "View by file" selector. With nothing ticked the dashboard shows every
 * finished file combined (the running dataset); ticking files narrows KPIs,
 * charts and the forecast to just those files.
 */
export const FileSelector: React.FC = () => {
  const {
    batches,
    completedBatches,
    selectedBatchIds,
    isAllFiles,
    scopeBatches,
    isLoadingBatches,
    toggleBatch,
    selectAllFiles,
    removeBatch,
  } = useFilterContext();

  const [open, setOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const menu = usePresence(open, { exitMs: 200 });

  useEffect(() => {
    const onOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const summary = (() => {
    if (completedBatches.length === 0) return 'No files uploaded yet';
    if (isAllFiles) {
      return completedBatches.length === 1
        ? `File 1 · ${completedBatches[0].fileName}`
        : `All files (${completedBatches.length})`;
    }
    if (scopeBatches.length === 1) {
      return `${fileLabel(scopeBatches[0])} · ${scopeBatches[0].fileName}`;
    }
    return `${scopeBatches.length} of ${completedBatches.length} files`;
  })();

  const handleDelete = async (batch: UploadBatch) => {
    const confirmed = await confirmDialog({
      title: `Delete ${fileLabel(batch)}?`,
      text: `"${batch.fileName}" and its sales records will be removed, along with customers and products only this file used. Ones other files use are kept, and later files are renumbered.`,
      confirmText: 'Yes, delete it',
      cancelText: 'Keep it',
      tone: 'danger',
      icon: 'warning',
    });
    if (!confirmed) return;

    try {
      setDeletingId(batch._id);
      const result = await removeBatch(batch._id);
      const parts: string[] = [];
      if (result.removedCustomers)
        parts.push(plural(result.removedCustomers, 'customer'));
      if (result.removedProducts)
        parts.push(plural(result.removedProducts, 'product'));
      void showToast(
        parts.length
          ? `Deleted "${batch.fileName}" (also removed ${parts.join(' and ')})`
          : `Deleted "${batch.fileName}"`
      );
    } catch (error) {
      void errorDialog(
        'Could not delete the file',
        error instanceof Error && error.message
          ? error.message
          : 'Something went wrong while deleting. Please try again.'
      );
    } finally {
      setDeletingId(null);
    }
  };

  const ordered = [...batches].sort(
    (a, b) =>
      (a.fileNumber ?? Infinity) - (b.fileNumber ?? Infinity) ||
      new Date(a.uploadedAt ?? 0).getTime() - new Date(b.uploadedAt ?? 0).getTime()
  );

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1 lg:flex-none">
      <button
        type="button"
        disabled={isLoadingBatches || batches.length === 0}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
          !isAllFiles
            ? 'border-indigo-500 bg-indigo-50/80 text-indigo-700'
            : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100'
        }`}
      >
        <Database className="h-4 w-4 shrink-0 text-indigo-600" />
        <span className="min-w-0 flex-1 truncate text-left lg:max-w-[230px]">
          {summary}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {menu.mounted && (
        <div
          data-state={menu.state}
          inert={menu.state === 'closed'}
          className="popup-menu absolute right-0 z-40 mt-1.5 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
        >
          <button
            type="button"
            onClick={() => {
              selectAllFiles();
              setOpen(false);
            }}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs cursor-pointer ${
              isAllFiles
                ? 'bg-indigo-50 font-semibold text-indigo-700'
                : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Layers className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">
              All files
              <span className="block text-[11px] font-normal text-slate-500">
                Running dataset: every finished file combined
              </span>
            </span>
          </button>

          <div className="my-1.5 border-t border-slate-100" />
          <p className="px-2 pb-1 text-[11px] font-semibold text-slate-500">
            Or view by file
          </p>

          <div data-lenis-prevent className="max-h-64 space-y-0.5 overflow-y-auto">
            {ordered.map((batch) => {
              const finished = batch.status === 'completed';
              const checked =
                finished && (isAllFiles || selectedBatchIds.includes(batch._id));
              const inFlight =
                batch.status === 'queued' || batch.status === 'processing';
              return (
                <div
                  key={batch._id}
                  className="flex items-center gap-1 rounded-lg px-1 hover:bg-slate-50"
                >
                  <label
                    className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-1.5 text-xs ${
                      finished ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!finished}
                      onChange={() => toggleBatch(batch._id)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                          {fileLabel(batch)}
                        </span>
                        <span className="truncate font-medium text-slate-800">
                          {batch.fileName}
                        </span>
                      </span>
                      <span className="block text-[11px] text-slate-500">
                        {finished ? (
                          <>
                            {plural(batch.validRowsInserted, 'row')} loaded
                            {(batch.duplicateRowsSkipped ?? 0) > 0 &&
                              ` · ${batch.duplicateRowsSkipped} duplicate`}
                          </>
                        ) : batch.status === 'failed' ? (
                          'Failed to process'
                        ) : (
                          'Still processing…'
                        )}
                      </span>
                    </span>
                  </label>
                  {!inFlight && (
                    <button
                      type="button"
                      disabled={deletingId === batch._id}
                      onClick={() => handleDelete(batch)}
                      aria-label={`Delete ${batch.fileName}`}
                      title="Delete this file"
                      className="shrink-0 rounded p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 cursor-pointer disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
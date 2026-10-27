// client/components/upload/FileDropzone.tsx
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone, FileRejection } from 'react-dropzone';
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  getUploadBatchById,
  uploadSalesFile,
} from '@/api/analytics.api';
import { subscribeToBatchEvents } from '@/api/socket';
import { useFilterContext } from '@/context/FilterContext';

interface FileDropzoneProps {
  /** If true, renders inside a centered modal overlay */
  asModal?: boolean;
}

type UploadStage =
  | 'idle'
  | 'uploading_http'
  | 'processing_worker'
  | 'completed'
  | 'error';

export const FileDropzone: React.FC<FileDropzoneProps> = ({
  asModal = false,
}) => {
  const {
    isUploadModalOpen,
    closeUploadModal,
    handleUploadCompleted,
  } = useFilterContext();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [stage, setStage] = useState<UploadStage>('idle');
  const [progress, setProgress] = useState<number>(0);
  const [processedRows, setProcessedRows] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const unsubscribeRef = useRef<(() => void) | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const cleanupSubscriptions = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => cleanupSubscriptions();
  }, [cleanupSubscriptions]);

  const resetUploaderState = () => {
    cleanupSubscriptions();
    setSelectedFile(null);
    setStage('idle');
    setProgress(0);
    setProcessedRows(0);
    setErrorMessage(null);
  };

  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      setErrorMessage(null);

      if (fileRejections.length > 0) {
        const firstErr = fileRejections[0]?.errors[0]?.message;
        setErrorMessage(
          firstErr || 'Invalid file format. Please upload a .csv or .xlsx file.'
        );
        return;
      }

      if (acceptedFiles.length > 0) {
        setSelectedFile(acceptedFiles[0]);
      }
    },
    []
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    disabled: stage === 'uploading_http' || stage === 'processing_worker',
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
        '.xlsx',
      ],
      'application/vnd.ms-excel': ['.xls'],
    },
    maxSize: 50 * 1024 * 1024, // 50MB max
  });

  const startUploadAndIngestion = async () => {
    if (!selectedFile) return;

    setStage('uploading_http');
    setProgress(5);
    setProcessedRows(0);
    setErrorMessage(null);

    try {
      const initRes = await uploadSalesFile(selectedFile, (httpPct) => {
        // Scale HTTP upload progress between 5% and 30%
        setProgress(Math.min(30, Math.max(5, Math.round(httpPct * 0.3))));
      });

      const batchId = initRes.batchId;
      if (!batchId) {
        throw new Error('Server did not return a valid batchId.');
      }

      // If the backend completed synchronously in the POST response
      if (
        initRes.status === 'completed' &&
        typeof initRes.inserted === 'number'
      ) {
        setProgress(100);
        setStage('completed');
        await handleUploadCompleted(
          {
            batchId,
            fileName: selectedFile.name,
            inserted: initRes.inserted,
            skipped: initRes.skipped ?? 0,
            errorLogs: initRes.errorLogs ?? [],
          },
          selectedFile.name
        );
        resetUploaderState();
        return;
      }

      // Otherwise, listen to BullMQ Worker WebSocket events
      setStage('processing_worker');
      setProgress(35);

      let isFinished = false;

      unsubscribeRef.current = subscribeToBatchEvents(batchId, {
        onProgress: (ev) => {
          // Scale worker progress between 35% and 98%
          const scaled = Math.min(98, Math.max(35, Math.round(ev.progress)));
          setProgress(scaled);
          setProcessedRows(ev.processedRows ?? 0);
        },
        onCompleted: async (ev) => {
          if (isFinished) return;
          isFinished = true;
          cleanupSubscriptions();
          setProgress(100);
          setStage('completed');

          await handleUploadCompleted(
            {
              batchId: ev.batchId || batchId,
              fileName: ev.fileName || selectedFile.name,
              inserted: ev.inserted,
              skipped: ev.skipped,
              errorLogs: ev.errorLogs || [],
            },
            selectedFile.name
          );
          resetUploaderState();
        },
        onFailed: (ev) => {
          if (isFinished) return;
          isFinished = true;
          cleanupSubscriptions();
          setStage('error');
          setErrorMessage(
            ev.error || 'Background worker failed to process the file.'
          );
        },
      });

      // Fallback status polling every 1.5s in case the worker finishes before WS room join
      pollTimerRef.current = setInterval(async () => {
        if (isFinished) return;
        try {
          const batchDoc = await getUploadBatchById(batchId);
          if (batchDoc.status === 'completed' && !isFinished) {
            isFinished = true;
            cleanupSubscriptions();
            setProgress(100);
            setStage('completed');

            await handleUploadCompleted(
              {
                batchId,
                fileName: batchDoc.fileName || selectedFile.name,
                inserted: batchDoc.validRowsInserted,
                skipped: batchDoc.invalidRowsCount,
                errorLogs: batchDoc.errorLogs || [],
              },
              selectedFile.name
            );
            resetUploaderState();
          } else if (batchDoc.status === 'failed' && !isFinished) {
            isFinished = true;
            cleanupSubscriptions();
            setStage('error');
            setErrorMessage(
              batchDoc.errorLogs?.[0]?.message ||
                'Dataset processing failed during validation.'
            );
          }
        } catch {
          // Ignore transient poll errors while worker is active
        }
      }, 1500);
    } catch (err: any) {
      cleanupSubscriptions();
      setStage('error');
      setErrorMessage(
        err?.message || 'Failed to upload file. Please check the server.'
      );
    }
  };

  if (asModal && !isUploadModalOpen) {
    return null;
  }

  const cardBody = (
    <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <UploadCloud className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Upload Sales Dataset (CSV / Excel)
            </h2>
            <p className="text-xs text-slate-500">
              Auto-normalizes headers, strips currency symbols, and validates with Zod
            </p>
          </div>
        </div>

        {asModal && (
          <button
            type="button"
            disabled={
              stage === 'uploading_http' || stage === 'processing_worker'
            }
            onClick={() => {
              resetUploaderState();
              closeUploadModal();
            }}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Dropzone Box */}
      <div
        {...getRootProps()}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-all cursor-pointer ${
          isDragActive
            ? 'border-indigo-500 bg-indigo-50/70'
            : selectedFile
            ? 'border-emerald-400 bg-emerald-50/30'
            : 'border-slate-300 bg-slate-50/60 hover:border-indigo-400 hover:bg-slate-50'
        }`}
      >
        <input {...getInputProps()} />

        {selectedFile ? (
          <div className="flex flex-col items-center">
            <FileSpreadsheet className="h-10 w-10 text-emerald-600 mb-2" />
            <p className="text-sm font-semibold text-slate-800">
              {selectedFile.name}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {(selectedFile.size / 1024).toFixed(1)} KB • Ready for ETL ingestion
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <UploadCloud className="h-10 w-10 text-indigo-500 mb-2.5" />
            <p className="text-sm font-semibold text-slate-700">
              {isDragActive
                ? 'Drop your sales file here...'
                : 'Drag & drop your CSV or Excel file here'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Supports <span className="font-semibold">.csv</span> and{' '}
              <span className="font-semibold">.xlsx</span> up to 50MB (100,000+ rows)
            </p>
          </div>
        )}
      </div>

      {/* Live WebSocket Progress Bar */}
      {(stage === 'uploading_http' ||
        stage === 'processing_worker' ||
        stage === 'completed') && (
        <div className="mt-5 rounded-xl bg-slate-50 p-4 border border-slate-200">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-2">
            <span className="flex items-center gap-2">
              {stage === 'completed' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
              )}
              {stage === 'uploading_http' && 'Uploading file to server...'}
              {stage === 'processing_worker' &&
                `BullMQ Worker validating & inserting rows${
                  processedRows > 0
                    ? ` (${processedRows.toLocaleString()} rows processed)`
                    : '...'
                }`}
              {stage === 'completed' && 'Ingestion complete! Refreshing analytics...'}
            </span>
            <span className="text-indigo-600 font-bold">{progress}%</span>
          </div>

          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-indigo-600 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error Alert */}
      {errorMessage && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-700">
          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Upload Error</p>
            <p className="mt-0.5">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="mt-5 flex items-center justify-end gap-2.5">
        {selectedFile &&
          stage !== 'uploading_http' &&
          stage !== 'processing_worker' && (
            <button
              type="button"
              onClick={resetUploaderState}
              className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              Clear File
            </button>
          )}

        <button
          type="button"
          disabled={
            !selectedFile ||
            stage === 'uploading_http' ||
            stage === 'processing_worker'
          }
          onClick={startUploadAndIngestion}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {(stage === 'uploading_http' || stage === 'processing_worker') && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          )}
          <span>
            {stage === 'uploading_http' || stage === 'processing_worker'
              ? 'Processing Dataset...'
              : 'Start ETL Upload'}
          </span>
        </button>
      </div>
    </div>
  );

  if (!asModal) {
    return <div className="flex justify-center py-8">{cardBody}</div>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
      {cardBody}
    </div>
  );
};

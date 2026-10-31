// client/context/FilterContext.tsx
'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  deleteUploadBatch,
  DeleteUploadResult,
  getUploadBatches,
} from '@/api/analytics.api';
import {
  CreatedVsLinked,
  DuplicateSummary,
  FilterOptions,
  Granularity,
  UploadBatch,
  UploadCompletedEvent,
} from '@/types/dashboard.types';
import { showToast } from '@/lib/alerts';

export interface DataHealthSummary {
  batchId: string;
  fileName: string;
  inserted: number;
  /** Invalid rows + duplicate-order rows. */
  skipped: number;
  errorLogs: UploadBatch['errorLogs'];
  customers?: CreatedVsLinked;
  products?: CreatedVsLinked;
  duplicates?: DuplicateSummary;
}

interface FilterContextValue {
  // File (dataset) state. The dashboard shows a RUNNING dataset: every
  // finished file combined, unless the user picks specific files.
  batches: UploadBatch[];
  /** Finished files only, oldest first (File 1, File 2, ...). */
  completedBatches: UploadBatch[];
  /** Explicit file selection. Empty = all finished files combined. */
  selectedBatchIds: string[];
  /** True when no explicit selection is made (or it covers every file). */
  isAllFiles: boolean;
  /** The files the dashboard is currently looking at. */
  scopeBatches: UploadBatch[];
  /** The single file in scope, or null when several files are in scope. */
  activeBatch: UploadBatch | null;
  /** At least one finished file exists, so analytics can be shown. */
  hasDataset: boolean;
  /** Bumps whenever files are added/removed so analytics refetch. */
  datasetVersion: number;
  isLoadingBatches: boolean;

  // Filter State
  startDate: string | null;
  endDate: string | null;
  selectedCategories: string[];
  selectedRegions: string[];
  granularity: Granularity;
  forecastHorizon: number;
  filterOptions: FilterOptions;
  hasActiveFilters: boolean;

  // Upload & Quarantine Modal State
  isUploadModalOpen: boolean;
  isValidationModalOpen: boolean;
  /** Which file the skipped-rows modal is showing. */
  validationBatchId: string | null;
  healthBanner: DataHealthSummary | null;

  // Actions
  setSelectedBatchIds: (batchIds: string[]) => void;
  toggleBatch: (batchId: string) => void;
  selectAllFiles: () => void;
  setStartDate: (date: string | null) => void;
  setEndDate: (date: string | null) => void;
  setSelectedCategories: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedRegions: React.Dispatch<React.SetStateAction<string[]>>;
  setGranularity: (granularity: Granularity) => void;
  setForecastHorizon: (horizon: number) => void;
  setFilterOptions: (options: FilterOptions) => void;
  resetFilters: () => void;

  // Batch & Modal Operations
  refreshBatches: () => Promise<void>;
  removeBatch: (batchId: string) => Promise<DeleteUploadResult>;
  openUploadModal: () => void;
  closeUploadModal: () => void;
  openValidationModal: (batchId?: string) => void;
  closeValidationModal: () => void;
  dismissHealthBanner: () => void;
  handleUploadCompleted: (
    event: UploadCompletedEvent,
    fileName?: string
  ) => Promise<void>;
}

const DEFAULT_FILTER_OPTIONS: FilterOptions = {
  categories: [],
  regions: [],
  minDate: null,
  maxDate: null,
};

const FilterContext = createContext<FilterContextValue | undefined>(undefined);

const STORAGE_KEY = 'sales_dashboard_selected_batch_ids';

const readStoredSelection = (): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const writeStoredSelection = (ids: string[]) => {
  if (typeof window === 'undefined') return;
  try {
    if (ids.length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: selection just won't persist */
  }
};

/** Oldest first, by fileNumber (falls back to upload time). */
const byUploadOrder = (a: UploadBatch, b: UploadBatch) =>
  (a.fileNumber ?? Infinity) - (b.fileNumber ?? Infinity) ||
  new Date(a.uploadedAt ?? 0).getTime() - new Date(b.uploadedAt ?? 0).getTime();

export const FilterProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // 1. Uploaded files
  const [batches, setBatches] = useState<UploadBatch[]>([]);
  const [selectedBatchIds, setSelectedBatchIdsState] = useState<string[]>([]);
  const [isLoadingBatches, setIsLoadingBatches] = useState<boolean>(true);
  const [datasetVersion, setDatasetVersion] = useState<number>(0);
  // Lets callbacks read the latest selection without re-creating themselves.
  const selectionRef = useRef<string[]>([]);
  useEffect(() => {
    selectionRef.current = selectedBatchIds;
  }, [selectedBatchIds]);

  // 2. Active Filters State
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [forecastHorizon, setForecastHorizon] = useState<number>(3);
  const [filterOptions, setFilterOptionsState] = useState<FilterOptions>(
    DEFAULT_FILTER_OPTIONS
  );

  // 3. Modals & Data Health Banner State
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [isValidationModalOpen, setIsValidationModalOpen] =
    useState<boolean>(false);
  const [validationBatchId, setValidationBatchId] = useState<string | null>(
    null
  );
  const [healthBanner, setHealthBanner] = useState<DataHealthSummary | null>(
    null
  );

  const completedBatches = useMemo(
    () => batches.filter((b) => b.status === 'completed').sort(byUploadOrder),
    [batches]
  );

  const resetFilters = useCallback(() => {
    setStartDate(null);
    setEndDate(null);
    setSelectedCategories([]);
    setSelectedRegions([]);
    setGranularity('month');
  }, []);

  const setSelectedBatchIds = useCallback(
    (ids: string[]) => {
      const unique = [...new Set(ids)];
      // Picking every finished file is the same as "all files": store [] so
      // files uploaded later are included automatically.
      const covered =
        unique.length > 0 &&
        completedBatches.length > 0 &&
        completedBatches.every((b) => unique.includes(b._id));
      const next = covered ? [] : unique;
      setSelectedBatchIdsState(next);
      writeStoredSelection(next);
      resetFilters();
    },
    [completedBatches, resetFilters]
  );

  const selectAllFiles = useCallback(() => setSelectedBatchIds([]), [
    setSelectedBatchIds,
  ]);

  const toggleBatch = useCallback(
    (batchId: string) => {
      const current = selectionRef.current.length
        ? selectionRef.current
        : completedBatches.map((b) => b._id);
      const next = current.includes(batchId)
        ? current.filter((id) => id !== batchId)
        : [...current, batchId];
      // Never leave the dashboard with nothing selected: fall back to all.
      setSelectedBatchIds(next);
    },
    [completedBatches, setSelectedBatchIds]
  );

  const setFilterOptions = useCallback((options: FilterOptions) => {
    setFilterOptionsState((prev) => {
      const sameCategories =
        prev.categories.length === options.categories.length &&
        prev.categories.every((c, i) => c === options.categories[i]);
      const sameRegions =
        prev.regions.length === options.regions.length &&
        prev.regions.every((r, i) => r === options.regions[i]);

      if (
        sameCategories &&
        sameRegions &&
        prev.minDate === options.minDate &&
        prev.maxDate === options.maxDate
      ) {
        return prev;
      }
      return options;
    });
  }, []);

  /**
   * Loads GET /api/v1/uploads and drops any saved selection that points at a
   * file that no longer exists (or is not finished).
   */
  const refreshBatches = useCallback(async () => {
    setIsLoadingBatches(true);
    try {
      const list = await getUploadBatches();
      setBatches(list);

      const finishedIds = new Set(
        list.filter((b) => b.status === 'completed').map((b) => b._id)
      );
      // First load restores the saved selection; later loads keep the current one.
      const current = selectionRef.current;
      const base = current.length > 0 ? current : readStoredSelection();
      const kept = base.filter((id) => finishedIds.has(id));
      const same =
        kept.length === current.length && kept.every((id, i) => id === current[i]);
      if (!same) {
        setSelectedBatchIdsState(kept);
        writeStoredSelection(kept);
      }
      setDatasetVersion((v) => v + 1);
    } catch (error) {
      console.error('[FilterContext] Failed to load upload batches:', error);
      void showToast(
        'Could not load your files. Please check the server connection.',
        'error'
      );
    } finally {
      setIsLoadingBatches(false);
    }
  }, []);

  useEffect(() => {
    refreshBatches();
  }, [refreshBatches]);

  /**
   * Deletes one file. The server also removes customers/products only that
   * file used and keeps shared ones; the result says how many went.
   */
  const removeBatch = useCallback(
    async (batchId: string): Promise<DeleteUploadResult> => {
      const result = await deleteUploadBatch(batchId);
      if (healthBanner?.batchId === batchId) setHealthBanner(null);
      if (validationBatchId === batchId) {
        setIsValidationModalOpen(false);
        setValidationBatchId(null);
      }
      const nextSelection = selectionRef.current.filter((id) => id !== batchId);
      setSelectedBatchIdsState(nextSelection);
      writeStoredSelection(nextSelection);
      // File numbers shift after a delete, so reload the list from the server.
      await refreshBatches();
      return result;
    },
    [healthBanner?.batchId, validationBatchId, refreshBatches]
  );

  /**
   * Triggered when FileDropzone finishes ingesting a file. The new file joins
   * the running dataset, so the selection goes back to "all files".
   */
  const handleUploadCompleted = useCallback(
    async (event: UploadCompletedEvent, fallbackFileName?: string) => {
      resetFilters();
      setSelectedBatchIdsState([]);
      writeStoredSelection([]);
      await refreshBatches();

      setHealthBanner({
        batchId: event.batchId,
        fileName: event.fileName || fallbackFileName || 'Uploaded file',
        inserted: event.inserted,
        skipped: event.skipped,
        errorLogs: event.errorLogs || [],
        customers: event.customers,
        products: event.products,
        duplicates: event.duplicates,
      });

      setIsUploadModalOpen(false);
    },
    [refreshBatches, resetFilters]
  );

  const isAllFiles = selectedBatchIds.length === 0;

  const scopeBatches = useMemo(
    () =>
      isAllFiles
        ? completedBatches
        : completedBatches.filter((b) => selectedBatchIds.includes(b._id)),
    [isAllFiles, completedBatches, selectedBatchIds]
  );

  const activeBatch = scopeBatches.length === 1 ? scopeBatches[0] : null;
  const hasDataset = completedBatches.length > 0;

  const hasActiveFilters = useMemo(
    () =>
      Boolean(
        startDate ||
          endDate ||
          selectedCategories.length > 0 ||
          selectedRegions.length > 0
      ),
    [startDate, endDate, selectedCategories.length, selectedRegions.length]
  );

  const openValidationModal = useCallback(
    (batchId?: string) => {
      setValidationBatchId(
        batchId ?? healthBanner?.batchId ?? activeBatch?._id ?? null
      );
      setIsValidationModalOpen(true);
    },
    [healthBanner?.batchId, activeBatch?._id]
  );

  const value = useMemo<FilterContextValue>(
    () => ({
      batches,
      completedBatches,
      selectedBatchIds,
      isAllFiles,
      scopeBatches,
      activeBatch,
      hasDataset,
      datasetVersion,
      isLoadingBatches,
      startDate,
      endDate,
      selectedCategories,
      selectedRegions,
      granularity,
      forecastHorizon,
      filterOptions,
      hasActiveFilters,
      isUploadModalOpen,
      isValidationModalOpen,
      validationBatchId,
      healthBanner,
      setSelectedBatchIds,
      toggleBatch,
      selectAllFiles,
      setStartDate,
      setEndDate,
      setSelectedCategories,
      setSelectedRegions,
      setGranularity,
      setForecastHorizon,
      setFilterOptions,
      resetFilters,
      refreshBatches,
      removeBatch,
      openUploadModal: () => setIsUploadModalOpen(true),
      closeUploadModal: () => setIsUploadModalOpen(false),
      openValidationModal,
      closeValidationModal: () => setIsValidationModalOpen(false),
      dismissHealthBanner: () => setHealthBanner(null),
      handleUploadCompleted,
    }),
    [
      batches,
      completedBatches,
      selectedBatchIds,
      isAllFiles,
      scopeBatches,
      activeBatch,
      hasDataset,
      datasetVersion,
      isLoadingBatches,
      startDate,
      endDate,
      selectedCategories,
      selectedRegions,
      granularity,
      forecastHorizon,
      filterOptions,
      hasActiveFilters,
      isUploadModalOpen,
      isValidationModalOpen,
      validationBatchId,
      healthBanner,
      setSelectedBatchIds,
      toggleBatch,
      selectAllFiles,
      setFilterOptions,
      resetFilters,
      refreshBatches,
      removeBatch,
      openValidationModal,
      handleUploadCompleted,
    ]
  );

  return (
    <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
  );
};

export const useFilterContext = (): FilterContextValue => {
  const context = useContext(FilterContext);
  if (!context) {
    throw new Error('useFilterContext must be used within a FilterProvider');
  }
  return context;
};
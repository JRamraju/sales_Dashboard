// client/context/FilterContext.tsx
'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  deleteUploadBatch,
  getUploadBatches,
} from '@/api/analytics.api';
import {
  FilterOptions,
  Granularity,
  UploadBatch,
  UploadCompletedEvent,
} from '@/types/dashboard.types';

export interface DataHealthSummary {
  batchId: string;
  fileName: string;
  inserted: number;
  skipped: number;
  errorLogs: UploadBatch['errorLogs'];
}

interface FilterContextValue {
  // Dataset Batch State
  batches: UploadBatch[];
  activeBatchId: string;
  activeBatch: UploadBatch | null;
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
  healthBanner: DataHealthSummary | null;

  // Actions
  setActiveBatchId: (batchId: string) => void;
  setStartDate: (date: string | null) => void;
  setEndDate: (date: string | null) => void;
  setSelectedCategories: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedRegions: React.Dispatch<React.SetStateAction<string[]>>;
  setGranularity: (granularity: Granularity) => void;
  setForecastHorizon: (horizon: number) => void;
  setFilterOptions: (options: FilterOptions) => void;
  resetFilters: () => void;

  // Batch & Modal Operations
  refreshBatches: (preferredBatchId?: string) => Promise<void>;
  removeBatch: (batchId: string) => Promise<void>;
  openUploadModal: () => void;
  closeUploadModal: () => void;
  openValidationModal: () => void;
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

const STORAGE_KEY = 'sales_dashboard_active_batch_id';

export const FilterProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // 1. Uploaded Batches State
  const [batches, setBatches] = useState<UploadBatch[]>([]);
  const [activeBatchId, setActiveBatchIdState] = useState<string>('');
  const [isLoadingBatches, setIsLoadingBatches] = useState<boolean>(true);

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

  // 3. Modals & Conditional Data Health Banner State
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [isValidationModalOpen, setIsValidationModalOpen] =
    useState<boolean>(false);
  const [healthBanner, setHealthBanner] = useState<DataHealthSummary | null>(
    null
  );

  const resetFilters = useCallback(() => {
    setStartDate(null);
    setEndDate(null);
    setSelectedCategories([]);
    setSelectedRegions([]);
    setGranularity('month');
  }, []);

  const setActiveBatchId = useCallback(
    (batchId: string) => {
      setActiveBatchIdState(batchId);
      resetFilters();
      if (typeof window !== 'undefined') {
        if (batchId) {
          window.localStorage.setItem(STORAGE_KEY, batchId);
        } else {
          window.localStorage.removeItem(STORAGE_KEY);
        }
      }
    },
    [resetFilters]
  );

  const setFilterOptions = useCallback((options: FilterOptions) => {
    setFilterOptionsState((prev) => {
      // Only update if values changed to prevent unnecessary re-renders
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
   * Fetches all uploaded batches from GET /api/v1/uploads
   * and selects either the preferredBatchId, saved localStorage batchId, or latest completed batch.
   */
  const refreshBatches = useCallback(async (preferredBatchId?: string) => {
    setIsLoadingBatches(true);
    try {
      const list = await getUploadBatches();
      setBatches(list);

      if (list.length === 0) {
        setActiveBatchIdState('');
        return;
      }

      const savedBatchId =
        typeof window !== 'undefined'
          ? window.localStorage.getItem(STORAGE_KEY)
          : null;

      const targetId =
        preferredBatchId && list.some((b) => b._id === preferredBatchId)
          ? preferredBatchId
          : activeBatchId && list.some((b) => b._id === activeBatchId)
          ? activeBatchId
          : savedBatchId && list.some((b) => b._id === savedBatchId)
          ? savedBatchId
          : list.find((b) => b.status === 'completed')?._id || list[0]._id;

      setActiveBatchIdState(targetId);
      if (typeof window !== 'undefined' && targetId) {
        window.localStorage.setItem(STORAGE_KEY, targetId);
      }
    } catch (error) {
      console.error('[FilterContext] Failed to load upload batches:', error);
    } finally {
      setIsLoadingBatches(false);
    }
  }, [activeBatchId]);

  // Initial load of historical batches on mount
  useEffect(() => {
    refreshBatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Deletes a batch and switches to the next available dataset
   */
  const removeBatch = useCallback(
    async (batchId: string) => {
      await deleteUploadBatch(batchId);
      if (healthBanner?.batchId === batchId) {
        setHealthBanner(null);
      }
      const remaining = batches.filter((b) => b._id !== batchId);
      setBatches(remaining);

      if (activeBatchId === batchId) {
        const nextId = remaining[0]?._id ?? '';
        setActiveBatchId(nextId);
      }
    },
    [activeBatchId, batches, healthBanner?.batchId, setActiveBatchId]
  );

  /**
   * Triggered when FileDropzone finishes ingesting a dataset
   */
  const handleUploadCompleted = useCallback(
    async (event: UploadCompletedEvent, fallbackFileName?: string) => {
      resetFilters();
      await refreshBatches(event.batchId);

      setHealthBanner({
        batchId: event.batchId,
        fileName: event.fileName || fallbackFileName || 'Uploaded Dataset',
        inserted: event.inserted,
        skipped: event.skipped,
        errorLogs: event.errorLogs || [],
      });

      setIsUploadModalOpen(false);
    },
    [refreshBatches, resetFilters]
  );

  const activeBatch = useMemo(
    () => batches.find((b) => b._id === activeBatchId) ?? null,
    [batches, activeBatchId]
  );

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

  const value = useMemo<FilterContextValue>(
    () => ({
      batches,
      activeBatchId,
      activeBatch,
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
      healthBanner,
      setActiveBatchId,
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
      openValidationModal: () => setIsValidationModalOpen(true),
      closeValidationModal: () => setIsValidationModalOpen(false),
      dismissHealthBanner: () => setHealthBanner(null),
      handleUploadCompleted,
    }),
    [
      batches,
      activeBatchId,
      activeBatch,
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
      healthBanner,
      setActiveBatchId,
      setFilterOptions,
      resetFilters,
      refreshBatches,
      removeBatch,
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
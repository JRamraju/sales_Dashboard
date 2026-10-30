import { AxiosRequestConfig } from 'axios';
import axiosInstance from './axiosInstance';
import {
  BatchStatus,
  BreakdownsResponse,
  ComparedFileRef,
  DashboardFilterParams,
  DeleteBatchResponse,
  DuplicateCounts,
  EntitySyncCounts,
  FileNewRecords,
  ForecastDataPoint,
  ForecastFilterParams,
  ForecastResponse,
  Granularity,
  NewCustomerItem,
  NewProductItem,
  NewRecordsParams,
  NewRecordsResponse,
  OverviewResponse,
  RevenueTrendPoint,
  TrendFilterParams,
  UploadBatch,
  UploadInitResponse,
} from '@/types/dashboard.types';

/**
 * Omits 'params' and 'paramsSerializer' from AxiosRequestConfig to prevent
 * Axios v1.7+/v1.8+ generic P invariance conflicts when spreading `...config`.
 */
export type ApiRequestConfig = Omit<
  AxiosRequestConfig,
  'params' | 'paramsSerializer'
>;

/**
 * Safely unwraps backend responses whether they are wrapped in
 * `{ success: true, data: ... }` or returned directly as `res.data`.
 */
const unwrapPayload = <T>(responseData: unknown): T => {
  if (
    responseData &&
    typeof responseData === 'object' &&
    'data' in responseData &&
    (responseData as Record<string, unknown>).data !== undefined
  ) {
    return (responseData as { data: T }).data;
  }
  return responseData as T;
};

/**
 * Normalizes batch lifecycle status, defaulting to `'queued'` (never `'pending'`).
 */
const normalizeBatchStatus = (status: unknown): BatchStatus => {
  if (
    status === 'queued' ||
    status === 'processing' ||
    status === 'completed' ||
    status === 'failed'
  ) {
    return status;
  }
  return 'queued';
};

/**
 * Normalizes master-data deduplication counts (`customers` or `products`) when present.
 */
const normalizeEntitySyncCounts = (
  value: unknown
): EntitySyncCounts | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return {
    created: Number(record.created ?? 0),
    existing: Number(record.existing ?? 0),
  };
};

/**
 * Normalizes cross-file duplicate row/order counts when present.
 */
const normalizeDuplicateCounts = (
  value: unknown
): DuplicateCounts | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return {
    rows: Number(record.rows ?? 0),
    orders: Number(record.orders ?? 0),
  };
};

/**
 * Serializes batch filter parameters for analytics requests:
 * - Converts a non-empty `batchIds` array into `batchIds: params.batchIds.join(',')`.
 * - Omits `batchIds` completely when `[]` or `undefined` so the backend aggregates all finished files.
 * - Preserves `batchId` when passed for single-file compatibility.
 */
export const serializeBatchFilterParams = <
  T extends { batchId?: string; batchIds?: string[] }
>(
  params: T
): Record<string, unknown> => {
  const { batchIds, batchId, ...rest } = params;
  const serialized: Record<string, unknown> = { ...rest };

  if (Array.isArray(batchIds) && batchIds.length > 0) {
    serialized.batchIds = batchIds.join(',');
  }

  if (batchId) {
    serialized.batchId = batchId;
  }

  return serialized;
};

/* ============================================================================
 * 1. FILE UPLOAD & DATASET BATCH MANAGEMENT ENDPOINTS (/api/v1/uploads)
 * ========================================================================== */

/**
 * POST /api/v1/uploads
 * Uploads a .csv or .xlsx sales dataset, enqueues the BullMQ job, and returns the batchId.
 */
export const uploadSalesFile = async (
  file: File,
  onUploadProgress?: (percentage: number) => void
): Promise<UploadInitResponse> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await axiosInstance.post('/uploads', formData, {
    onUploadProgress: (progressEvent) => {
      if (onUploadProgress && progressEvent.total) {
        const percentCompleted = Math.round(
          (progressEvent.loaded * 100) / progressEvent.total
        );
        onUploadProgress(percentCompleted);
      }
    },
  });

  const batch = unwrapPayload<Record<string, any>>(response.data) ?? {};

  return {
    batchId: String(batch.batchId ?? batch._id ?? ''),
    jobId: batch.jobId ? String(batch.jobId) : undefined,
    fileNumber: typeof batch.fileNumber === 'number' ? batch.fileNumber : null,
    status: normalizeBatchStatus(batch.status),
    fileName: batch.fileName ? String(batch.fileName) : file.name,
    message: batch.message ? String(batch.message) : undefined,
    inserted:
      typeof batch.inserted === 'number'
        ? batch.inserted
        : typeof batch.validRowsInserted === 'number'
        ? batch.validRowsInserted
        : undefined,
    skipped:
      typeof batch.skipped === 'number'
        ? batch.skipped
        : typeof batch.invalidRowsCount === 'number'
        ? batch.invalidRowsCount
        : undefined,
    customers: batch.customers
      ? {
          created: Number(batch.customers?.created ?? 0),
          existing: Number(batch.customers?.existing ?? 0),
        }
      : undefined,
    products: batch.products
      ? {
          created: Number(batch.products?.created ?? 0),
          existing: Number(batch.products?.existing ?? 0),
        }
      : undefined,
    duplicates: batch.duplicates
      ? {
          rows: Number(batch.duplicates?.rows ?? 0),
          orders: Number(batch.duplicates?.orders ?? 0),
        }
      : undefined,
    notes: Array.isArray(batch.notes) ? batch.notes.map(String) : [],
    errorLogs: Array.isArray(batch.errorLogs) ? batch.errorLogs : [],
  };
};

/**
 * GET /api/v1/uploads
 * Lists all previously uploaded file batches with their chronological `fileNumber` and status.
 */
export const getUploadBatches = async (
  config?: ApiRequestConfig
): Promise<UploadBatch[]> => {
  const response = await axiosInstance.get('/uploads', config);
  const raw = unwrapPayload<UploadBatch[] | { batches?: UploadBatch[] }>(
    response.data
  );

  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.batches)
    ? raw.batches
    : [];

  return list.map((batch: any) => ({
    ...batch,
    _id: String(batch._id ?? batch.batchId ?? ''),
    batchId: String(batch.batchId ?? batch._id ?? ''),
    fileNumber: typeof batch.fileNumber === 'number' ? batch.fileNumber : null,
    fileName: batch.fileName || batch.originalName || 'Untitled Dataset',
    status: normalizeBatchStatus(batch.status),
    validRowsInserted: Number(batch.validRowsInserted ?? 0),
    invalidRowsCount: Number(batch.invalidRowsCount ?? 0),
    customers: batch.customers
      ? {
          created: Number(batch.customers?.created ?? 0),
          existing: Number(batch.customers?.existing ?? 0),
        }
      : normalizeEntitySyncCounts(batch.customers),
    products: batch.products
      ? {
          created: Number(batch.products?.created ?? 0),
          existing: Number(batch.products?.existing ?? 0),
        }
      : normalizeEntitySyncCounts(batch.products),
    duplicates: batch.duplicates
      ? {
          rows: Number(batch.duplicates?.rows ?? 0),
          orders: Number(batch.duplicates?.orders ?? 0),
        }
      : normalizeDuplicateCounts(batch.duplicates),
    notes: Array.isArray(batch.notes) ? batch.notes.map(String) : [],
    errorLogs: Array.isArray(batch.errorLogs) ? batch.errorLogs : [],
  }));
};

/**
 * GET /api/v1/uploads/:batchId
 * Retrieves the status, row counts, deduplication metadata, notes, and quarantine errorLogs for a specific upload batch.
 */
export const getUploadBatchById = async (
  batchId: string,
  config?: ApiRequestConfig
): Promise<UploadBatch> => {
  const response = await axiosInstance.get(`/uploads/${batchId}`, config);
  const batch = unwrapPayload<Record<string, any>>(response.data) ?? {};

  return {
    ...(batch as UploadBatch),
    _id: String(batch._id ?? batch.batchId ?? batchId),
    batchId: String(batch.batchId ?? batch._id ?? batchId),
    fileNumber: typeof batch.fileNumber === 'number' ? batch.fileNumber : null,
    fileName: batch.fileName || batch.originalName || 'Uploaded Dataset',
    status: normalizeBatchStatus(batch.status),
    validRowsInserted: Number(batch.validRowsInserted ?? 0),
    invalidRowsCount: Number(batch.invalidRowsCount ?? 0),
    customers: batch.customers
      ? {
          created: Number(batch.customers?.created ?? 0),
          existing: Number(batch.customers?.existing ?? 0),
        }
      : normalizeEntitySyncCounts(batch.customers),
    products: batch.products
      ? {
          created: Number(batch.products?.created ?? 0),
          existing: Number(batch.products?.existing ?? 0),
        }
      : normalizeEntitySyncCounts(batch.products),
    duplicates: batch.duplicates
      ? {
          rows: Number(batch.duplicates?.rows ?? 0),
          orders: Number(batch.duplicates?.orders ?? 0),
        }
      : normalizeDuplicateCounts(batch.duplicates),
    notes: Array.isArray(batch.notes) ? batch.notes.map(String) : [],
    errorLogs: Array.isArray(batch.errorLogs) ? batch.errorLogs : [],
  };
};

/**
 * DELETE /api/v1/uploads/:batchId
 * Deletes an uploaded batch, its associated sales records, and any unshared customers/products.
 */
export const deleteUploadBatch = async (
  batchId: string
): Promise<DeleteBatchResponse> => {
  const response = await axiosInstance.delete(`/uploads/${batchId}`);
  const raw = unwrapPayload<Record<string, any>>(response.data) ?? {};

  return {
    batchId: String(raw.batchId ?? batchId),
    deletedRecords:
      raw.deletedRecords !== undefined ? Number(raw.deletedRecords) : undefined,
    removedCustomers:
      raw.removedCustomers !== undefined
        ? Number(raw.removedCustomers)
        : undefined,
    removedProducts:
      raw.removedProducts !== undefined
        ? Number(raw.removedProducts)
        : undefined,
    message: String(raw.message ?? 'Upload deleted.'),
  };
};

/* ============================================================================
 * 2. DASHBOARD ANALYTICS & FORECASTING ENDPOINTS (/api/v1/analytics/*)
 * ========================================================================== */

/**
 * GET /api/v1/analytics/overview
 * Fetches the 5 core KPIs (Revenue, Orders, Customers, AOV, Growth %) and distinct filter options.
 */
export const getAnalyticsOverview = async (
  params: DashboardFilterParams,
  config?: ApiRequestConfig
): Promise<OverviewResponse> => {
  const response = await axiosInstance.get('/analytics/overview', {
    ...config,
    params: serializeBatchFilterParams(params),
  });

  const raw = unwrapPayload<Record<string, any>>(response.data);
  const kpiSource = raw.kpis ?? raw;
  const filterSource = raw.filterOptions ?? raw.filters ?? raw;

  return {
    kpis: {
      totalRevenue: Number(kpiSource.totalRevenue ?? 0),
      totalOrders: Number(kpiSource.totalOrders ?? 0),
      totalCustomers: Number(kpiSource.totalCustomers ?? 0),
      averageOrderValue: Number(
        kpiSource.averageOrderValue ?? kpiSource.aov ?? 0
      ),
      revenueGrowth: Number(
        kpiSource.revenueGrowth ?? kpiSource.growthPercentage ?? 0
      ),
      previousPeriodRevenue:
        kpiSource.previousPeriodRevenue !== undefined
          ? Number(kpiSource.previousPeriodRevenue)
          : undefined,
    },
    filterOptions: {
      categories: Array.isArray(filterSource.categories)
        ? filterSource.categories
        : [],
      regions: Array.isArray(filterSource.regions) ? filterSource.regions : [],
      minDate: filterSource.minDate ?? null,
      maxDate: filterSource.maxDate ?? null,
    },
  };
};

/**
 * GET /api/v1/analytics/trends
 * Fetches time-series array [{ date, revenue, orders }] for the Revenue Trend Chart.
 */
export const getRevenueTrends = async (
  params: TrendFilterParams,
  config?: ApiRequestConfig
): Promise<RevenueTrendPoint[]> => {
  const response = await axiosInstance.get('/analytics/trends', {
    ...config,
    params: serializeBatchFilterParams({
      ...params,
      granularity: params.granularity ?? 'month',
    }),
  });

  const raw = unwrapPayload<
    | RevenueTrendPoint[]
    | { trends?: RevenueTrendPoint[]; series?: RevenueTrendPoint[] }
  >(response.data);

  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.trends)
    ? raw.trends
    : Array.isArray(raw?.series)
    ? raw.series
    : [];

  return list.map((point: any) => ({
    date: String(point.date ?? point.period ?? point._id ?? ''),
    revenue: Number(point.revenue ?? point.totalRevenue ?? 0),
    orders: Number(point.orders ?? point.totalOrders ?? 0),
    averageOrderValue:
      point.averageOrderValue !== undefined
        ? Number(point.averageOrderValue)
        : undefined,
  }));
};

/**
 * GET /api/v1/analytics/breakdowns
 * Fetches Top 10 Products, Top 10 Customers, Category Share, and Region Share in a single call.
 */
export const getAnalyticsBreakdowns = async (
  params: DashboardFilterParams,
  config?: ApiRequestConfig
): Promise<BreakdownsResponse> => {
  const response = await axiosInstance.get('/analytics/breakdowns', {
    ...config,
    params: serializeBatchFilterParams(params),
  });

  const raw = unwrapPayload<Record<string, any>>(response.data);

  const topProducts = (raw.topProducts ?? raw.products ?? []).map(
    (item: any) => ({
      productId: item.productId ?? item._id,
      productName: String(item.productName ?? item.name ?? 'Unknown Product'),
      category: String(item.category ?? 'Uncategorized'),
      unitsSold: Number(item.unitsSold ?? item.quantity ?? 0),
      totalRevenue: Number(item.totalRevenue ?? item.revenue ?? 0),
      percentageOfSales: Number(
        item.percentageOfSales ?? item.percentage ?? item.share ?? 0
      ),
    })
  );

  const topCustomers = (raw.topCustomers ?? raw.customers ?? []).map(
    (item: any) => ({
      customerId: item.customerId ?? item._id,
      customerName: String(
        item.customerName ?? item.name ?? 'Unknown Customer'
      ),
      totalOrders: Number(item.totalOrders ?? item.orders ?? 0),
      totalSpend: Number(
        item.totalSpend ?? item.totalRevenue ?? item.revenue ?? 0
      ),
      averageOrderValue: Number(item.averageOrderValue ?? item.aov ?? 0),
      lastPurchaseDate: String(
        item.lastPurchaseDate ?? item.lastOrderDate ?? ''
      ),
    })
  );

  const categoryDistribution = (
    raw.categoryDistribution ??
    raw.categories ??
    []
  ).map((item: any) => ({
    name: String(item.category ?? item.name ?? item._id ?? 'Uncategorized'),
    revenue: Number(item.revenue ?? item.totalRevenue ?? 0),
    orders: item.orders !== undefined ? Number(item.orders) : undefined,
    percentage: Number(item.percentage ?? item.share ?? 0),
  }));

  const regionDistribution = (
    raw.regionDistribution ??
    raw.regions ??
    []
  ).map((item: any) => ({
    name: String(item.region ?? item.name ?? item._id ?? 'Unknown'),
    revenue: Number(item.revenue ?? item.totalRevenue ?? 0),
    orders: item.orders !== undefined ? Number(item.orders) : undefined,
    percentage: Number(item.percentage ?? item.share ?? 0),
  }));

  return {
    topProducts,
    topCustomers,
    categoryDistribution,
    regionDistribution,
  };
};

/**
 * GET /api/v1/analytics/forecast
 * Fetches historical monthly revenue + next N predicted months (Linear Regression + WMA blend) + R^2 score.
 */
export const getSalesForecast = async (
  params: ForecastFilterParams,
  config?: ApiRequestConfig
): Promise<ForecastResponse> => {
  const response = await axiosInstance.get('/analytics/forecast', {
    ...config,
    params: serializeBatchFilterParams({
      ...params,
      horizon: params.horizon ?? 3,
    }),
  });

  const raw = unwrapPayload<Record<string, any>>(response.data);

  const historical = (raw.historical ?? raw.history ?? []).map((pt: any) => ({
    date: String(pt.date ?? pt.month ?? pt.period ?? ''),
    revenue: Number(pt.revenue ?? pt.totalRevenue ?? 0),
  }));

  const forecast = (
    raw.forecast ??
    raw.predictions ??
    raw.projected ??
    []
  ).map((pt: any) => {
    const predictedVal = Number(
      pt.predictedRevenue ?? pt.forecastRevenue ?? pt.revenue ?? 0
    );
    return {
      date: String(pt.date ?? pt.month ?? pt.period ?? ''),
      predictedRevenue: predictedVal,
      revenue: predictedVal,
    };
  });

  // Build unified series for Recharts ComposedChart (solid line for actuals, dashed line for predictions)
  const combinedSeries: ForecastDataPoint[] = historical.map(
    (item: { date: string; revenue: number }, index: number) => ({
      date: item.date,
      actualRevenue: item.revenue,
      forecastRevenue:
        index === historical.length - 1 ? item.revenue : null,
      isForecast: false,
    })
  );

  forecast.forEach((item: { date: string; predictedRevenue: number }) => {
    combinedSeries.push({
      date: item.date,
      actualRevenue: null,
      forecastRevenue: item.predictedRevenue,
      isForecast: true,
    });
  });

  const rSquared = Number(raw.rSquared ?? raw.r2 ?? raw.confidence ?? 0);
  const confidenceLabel: ForecastResponse['confidenceLabel'] =
    rSquared >= 0.75 ? 'High' : rSquared >= 0.45 ? 'Moderate' : 'Low';

  return {
    historical,
    forecast,
    combinedSeries,
    trendDirection:
      raw.trendDirection ??
      (Number(raw.slope ?? 0) > 0
        ? 'upward'
        : Number(raw.slope ?? 0) < 0
        ? 'downward'
        : 'flat'),
    slope: Number(raw.slope ?? 0),
    intercept: raw.intercept !== undefined ? Number(raw.intercept) : undefined,
    rSquared,
    confidenceLabel,
    methodUsed: raw.methodUsed ?? '70% OLS Linear Regression + 30% 3-Month WMA',
  };
};

/**
 * GET /api/v1/analytics/new-records
 * Fetches per-file new customers and new products compared against all earlier uploaded files.
 */
export const getNewRecords = async (
  params: NewRecordsParams = {},
  config?: ApiRequestConfig
): Promise<NewRecordsResponse> => {
  const response = await axiosInstance.get('/analytics/new-records', {
    ...config,
    params: {
      batchIds: params.batchIds?.length ? params.batchIds.join(',') : undefined,
      limit: params.limit ?? 100,
    },
  });

  const raw = unwrapPayload<Record<string, any> | FileNewRecords[]>(
    response.data
  );

  const filesRaw = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.files)
    ? raw.files
    : [];

  const files: FileNewRecords[] = filesRaw.map((file: any) => {
    const comparedWith: ComparedFileRef[] = Array.isArray(file?.comparedWith)
      ? file.comparedWith.map((ref: any) => ({
          batchId: String(ref?.batchId ?? ref?._id ?? ''),
          fileNumber: Number(ref?.fileNumber ?? 0),
          fileName: String(ref?.fileName ?? ''),
        }))
      : [];

    const customerItems: NewCustomerItem[] = Array.isArray(
      file?.newCustomers?.items
    )
      ? file.newCustomers.items.map((item: any) => ({
          customerId: String(item?.customerId ?? ''),
          customerName: String(
            item?.customerName ?? item?.customerId ?? 'Unknown Customer'
          ),
          orders: Number(item?.orders ?? 0),
          revenue: Number(item?.revenue ?? 0),
          firstOrderDate: String(item?.firstOrderDate ?? ''),
        }))
      : [];

    const productItems: NewProductItem[] = Array.isArray(
      file?.newProducts?.items
    )
      ? file.newProducts.items.map((item: any) => ({
          productId: String(item?.productId ?? ''),
          productName: String(
            item?.productName ?? item?.productId ?? 'Unknown Product'
          ),
          category: String(item?.category ?? 'Uncategorized'),
          unitsSold: Number(item?.unitsSold ?? 0),
          revenue: Number(item?.revenue ?? 0),
        }))
      : [];

    return {
      batchId: String(file?.batchId ?? file?._id ?? ''),
      fileName: String(file?.fileName ?? 'Untitled Dataset'),
      fileNumber: Number(file?.fileNumber ?? 0),
      uploadedAt: String(file?.uploadedAt ?? ''),
      isFirstFile: Boolean(file?.isFirstFile),
      comparedWith,
      newCustomers: {
        count: Number(file?.newCustomers?.count ?? customerItems.length),
        revenue: Number(file?.newCustomers?.revenue ?? 0),
        truncated: Boolean(file?.newCustomers?.truncated),
        items: customerItems,
      },
      newProducts: {
        count: Number(file?.newProducts?.count ?? productItems.length),
        revenue: Number(file?.newProducts?.revenue ?? 0),
        truncated: Boolean(file?.newProducts?.truncated),
        items: productItems,
      },
    };
  });

  return { files };
};

/* ============================================================================
 * 3. PARALLEL DASHBOARD DATA LOADER HELPER
 * ========================================================================== */

export interface FullDashboardBundle {
  overview: OverviewResponse;
  trends: RevenueTrendPoint[];
  breakdowns: BreakdownsResponse;
  forecast: ForecastResponse;
}

/**
 * Fetches all 4 analytics endpoints in parallel when `batchIds`, `batchId`, or filters change.
 */
export const fetchFullDashboardData = async (
  filters: DashboardFilterParams & {
    granularity?: Granularity;
    horizon?: number;
  },
  signal?: AbortSignal
): Promise<FullDashboardBundle> => {
  const { granularity = 'month', horizon = 3, ...baseFilters } = filters;

  const [overview, trends, breakdowns, forecast] = await Promise.all([
    getAnalyticsOverview(baseFilters, { signal }),
    getRevenueTrends({ ...baseFilters, granularity }, { signal }),
    getAnalyticsBreakdowns(baseFilters, { signal }),
    getSalesForecast(
      {
        batchIds: baseFilters.batchIds,
        batchId: baseFilters.batchId,
        horizon,
        category: baseFilters.category,
        region: baseFilters.region,
      },
      { signal }
    ),
  ]);

  return { overview, trends, breakdowns, forecast };
};
// client/api/analytics.api.ts
import { AxiosRequestConfig } from 'axios';
import axiosInstance from './axiosInstance';
import {
  BreakdownsResponse,
  DashboardFilterParams,
  ForecastDataPoint,
  ForecastFilterParams,
  ForecastResponse,
  Granularity,
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

  const raw = unwrapPayload<Record<string, unknown>>(response.data);

  return {
    batchId: String(raw.batchId ?? raw._id ?? ''),
    jobId: raw.jobId ? String(raw.jobId) : undefined,
    status: (raw.status as UploadInitResponse['status']) ?? 'processing',
    fileName: raw.fileName ? String(raw.fileName) : file.name,
    message: raw.message ? String(raw.message) : undefined,
    inserted:
      typeof raw.inserted === 'number'
        ? raw.inserted
        : typeof raw.validRowsInserted === 'number'
        ? raw.validRowsInserted
        : undefined,
    skipped:
      typeof raw.skipped === 'number'
        ? raw.skipped
        : typeof raw.invalidRowsCount === 'number'
        ? raw.invalidRowsCount
        : undefined,
    errorLogs: Array.isArray(raw.errorLogs) ? raw.errorLogs : [],
  };
};

/**
 * GET /api/v1/uploads
 * Lists all previously uploaded file batches so the user can switch datasets.
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

  return list.map((batch) => ({
    ...batch,
    _id: String(batch._id ?? batch.batchId ?? ''),
    batchId: String(batch.batchId ?? batch._id ?? ''),
    fileName: batch.fileName || batch.originalName || 'Untitled Dataset',
    fileNumber: batch.fileNumber ?? null,
    validRowsInserted: Number(batch.validRowsInserted ?? 0),
    invalidRowsCount: Number(batch.invalidRowsCount ?? 0),
    duplicateRowsSkipped: Number(batch.duplicateRowsSkipped ?? 0),
    duplicateOrdersSkipped: Number(batch.duplicateOrdersSkipped ?? 0),
    // GET /uploads leaves errorLogs out; fetch one batch to read them.
    errorLogs: Array.isArray(batch.errorLogs) ? batch.errorLogs : [],
  }));
};

/**
 * GET /api/v1/uploads/:batchId
 * Retrieves the status, row counts, and quarantine errorLogs for a specific upload batch.
 */
export const getUploadBatchById = async (
  batchId: string,
  config?: ApiRequestConfig
): Promise<UploadBatch> => {
  const response = await axiosInstance.get(`/uploads/${batchId}`, config);
  const batch = unwrapPayload<UploadBatch>(response.data);

  return {
    ...batch,
    _id: String(batch._id ?? batch.batchId ?? batchId),
    batchId: String(batch.batchId ?? batch._id ?? batchId),
    fileName: batch.fileName || batch.originalName || 'Uploaded Dataset',
    fileNumber: batch.fileNumber ?? null,
    validRowsInserted: Number(batch.validRowsInserted ?? 0),
    invalidRowsCount: Number(batch.invalidRowsCount ?? 0),
    duplicateRowsSkipped: Number(batch.duplicateRowsSkipped ?? 0),
    duplicateOrdersSkipped: Number(batch.duplicateOrdersSkipped ?? 0),
    errorLogs: Array.isArray(batch.errorLogs) ? batch.errorLogs : [],
  };
};

export interface DeleteUploadResult {
  message: string;
  batchId: string;
  deletedRecords?: number;
  /** Customers / products only this file used (shared ones are kept). */
  removedCustomers?: number;
  removedProducts?: number;
}

/**
 * DELETE /api/v1/uploads/:batchId
 * Deletes one file and its sales records. Customers and products only this
 * file used are removed too; ones other files still use are kept.
 */
export const deleteUploadBatch = async (
  batchId: string
): Promise<DeleteUploadResult> => {
  const response = await axiosInstance.delete(`/uploads/${batchId}`);
  return unwrapPayload(response.data);
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
    params: { ...params } as Record<string, unknown>,
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
    params: {
      ...params,
      granularity: params.granularity ?? 'month',
    } as Record<string, unknown>,
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
    params: { ...params } as Record<string, unknown>,
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
    params: {
      ...params,
      horizon: params.horizon ?? 3,
    } as Record<string, unknown>,
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
      lower: pt.lower ?? null,
      upper: pt.upper ?? null,
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
 * For each selected file, the customers and products that appear in no earlier
 * file. "Earlier" always means every earlier finished file, not just the
 * selected ones. File 1 returns empty lists (`isFirstFile: true`).
 */
export const getNewRecords = async (
  params: NewRecordsParams = {},
  config?: ApiRequestConfig
): Promise<NewRecordsResponse> => {
  const response = await axiosInstance.get('/analytics/new-records', {
    ...config,
    params: { ...params } as Record<string, unknown>,
  });
  const raw = unwrapPayload<Partial<NewRecordsResponse>>(response.data);
  const files = Array.isArray(raw?.files) ? raw.files : [];

  const group = (g: any) => ({
    count: Number(g?.count ?? 0),
    revenue: Number(g?.revenue ?? 0),
    items: Array.isArray(g?.items) ? g.items : [],
    truncated: Boolean(g?.truncated),
  });

  return {
    files: files.map((f: any) => ({
      ...f,
      batchId: String(f.batchId),
      fileNumber: Number(f.fileNumber ?? 0),
      isFirstFile: Boolean(f.isFirstFile),
      comparedWith: Array.isArray(f.comparedWith) ? f.comparedWith : [],
      newCustomers: group(f.newCustomers),
      newProducts: group(f.newProducts),
    })),
  };
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
 * Fetches all 4 analytics endpoints in parallel when the file selection or
 * filters change. An empty / missing `batchIds` means every finished file
 * combined (the running dataset).
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
        horizon,
        category: baseFilters.category,
        region: baseFilters.region,
      },
      { signal }
    ),
  ]);

  return { overview, trends, breakdowns, forecast };
};
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
  NewCustomerItem,
  NewEntitiesFileGroup,
  NewEntitiesFilterParams,
  NewEntitiesResponse,
  NewProductItem,
  OverviewResponse,
  RevenueTrendPoint,
  TrendFilterParams,
  UploadBatch,
  UploadInitResponse,
  ValidationErrorLog,
} from '@/types/dashboard.types';

/**
 * Omits 'params' and 'paramsSerializer' from AxiosRequestConfig to prevent
 * Axios generic P invariance conflicts when spreading `...config`.
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
 * Normalizes a log entry ({ rowNumber, field, message })
 */
const normalizeLogItem = (item: unknown): ValidationErrorLog => {
  const raw = (item && typeof item === 'object' ? item : {}) as Record<
    string,
    unknown
  >;
  const messageText = String(
    raw.message ?? raw.reason ?? 'Invalid or duplicate record'
  );
  return {
    rowNumber:
      typeof raw.rowNumber === 'number'
        ? raw.rowNumber
        : typeof raw.row === 'number'
        ? raw.row
        : undefined,
    row:
      typeof raw.row === 'number'
        ? raw.row
        : typeof raw.rowNumber === 'number'
        ? raw.rowNumber
        : undefined,
    field: raw.field ? String(raw.field) : undefined,
    message: messageText,
    reason: raw.reason ? String(raw.reason) : messageText,
    rawValue: raw.rawValue,
  };
};

/**
 * Normalizes an UploadBatch object from GET /uploads or GET /uploads/:batchId
 */
const normalizeUploadBatch = (
  rawBatch: unknown,
  fallbackSequence = 1
): UploadBatch => {
  const batch = (
    rawBatch && typeof rawBatch === 'object' ? rawBatch : {}
  ) as Record<string, unknown>;

  const resolvedId = String(batch.batchId ?? batch._id ?? '');
  const errorLogsRaw = Array.isArray(batch.errorLogs) ? batch.errorLogs : [];
  const duplicateLogsRaw = Array.isArray(batch.duplicateLogs)
    ? batch.duplicateLogs
    : [];

  return {
    _id: resolvedId,
    batchId: resolvedId,
    sequence: Number(batch.sequence ?? fallbackSequence),
    fileName: String(
      batch.fileName ?? batch.originalName ?? 'Untitled Dataset'
    ),
    originalName: batch.originalName ? String(batch.originalName) : undefined,
    status:
      (batch.status as UploadBatch['status']) ??
      ('queued' as UploadBatch['status']),
    totalRows: Number(batch.totalRows ?? batch.totalRowsRead ?? 0),
    validRowsInserted: Number(batch.validRowsInserted ?? batch.inserted ?? 0),
    invalidRowsCount: Number(batch.invalidRowsCount ?? batch.skipped ?? 0),
    duplicateRowsCount: Number(
      batch.duplicateRowsCount ?? batch.duplicates ?? 0
    ),
    newCustomersCount: Number(
      batch.newCustomersCount ?? batch.newCustomers ?? 0
    ),
    newProductsCount: Number(batch.newProductsCount ?? batch.newProducts ?? 0),
    errorLogs: errorLogsRaw.map(normalizeLogItem),
    duplicateLogs: duplicateLogsRaw.map(normalizeLogItem),
    errorLogsTruncated: Boolean(batch.errorLogsTruncated),
    duplicateLogsTruncated: Boolean(batch.duplicateLogsTruncated),
    failureReason: batch.failureReason
      ? String(batch.failureReason)
      : undefined,
    dateOrder: batch.dateOrder ? String(batch.dateOrder) : undefined,
    notes: Array.isArray(batch.notes) ? batch.notes.map(String) : undefined,
    uploadedAt: batch.uploadedAt ? String(batch.uploadedAt) : undefined,
    createdAt: batch.createdAt ? String(batch.createdAt) : undefined,
    updatedAt: batch.updatedAt ? String(batch.updatedAt) : undefined,
  };
};

/**
 * Serializes filter params for analytics endpoints:
 * - Serializes `batchIds` as a comma-separated string; omits when empty/undefined.
 * - Never sends the legacy `batchId` parameter.
 * - Omits empty strings, null, or empty arrays for date/category/region.
 */
export const serializeAnalyticsParams = (
  params: DashboardFilterParams & {
    granularity?: Granularity;
    horizon?: number;
    limit?: number;
  }
): Record<string, string | number | string[]> => {
  const query: Record<string, string | number | string[]> = {};

  if (Array.isArray(params.batchIds)) {
    const cleanIds = params.batchIds
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    if (cleanIds.length > 0) {
      query.batchIds = cleanIds.join(',');
    }
  }

  if (params.startDate) {
    query.startDate = params.startDate;
  }
  if (params.endDate) {
    query.endDate = params.endDate;
  }

  if (Array.isArray(params.category)) {
    const cleanCategories = params.category.filter(Boolean);
    if (cleanCategories.length > 0) {
      query.category = cleanCategories;
    }
  } else if (typeof params.category === 'string' && params.category.trim()) {
    query.category = params.category.trim();
  }

  if (Array.isArray(params.region)) {
    const cleanRegions = params.region.filter(Boolean);
    if (cleanRegions.length > 0) {
      query.region = cleanRegions;
    }
  } else if (typeof params.region === 'string' && params.region.trim()) {
    query.region = params.region.trim();
  }

  if (params.granularity) {
    query.granularity = params.granularity;
  }
  if (typeof params.horizon === 'number') {
    query.horizon = params.horizon;
  }
  if (typeof params.limit === 'number') {
    query.limit = params.limit;
  }

  return query;
};

/* ============================================================================
 * 1. FILE UPLOAD & DATASET BATCH MANAGEMENT ENDPOINTS (/api/v1/uploads)
 * ========================================================================== */

/**
 * POST /api/v1/uploads
 * Uploads a .csv or .xlsx sales file, enqueues the BullMQ job, and returns { batchId, sequence, fileName, status }.
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
    sequence: Number(raw.sequence ?? 1),
    jobId: raw.jobId ? String(raw.jobId) : undefined,
    status: (raw.status as UploadInitResponse['status']) ?? 'queued',
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
    duplicates:
      typeof raw.duplicates === 'number'
        ? raw.duplicates
        : typeof raw.duplicateRowsCount === 'number'
        ? raw.duplicateRowsCount
        : undefined,
    newCustomers:
      typeof raw.newCustomers === 'number'
        ? raw.newCustomers
        : typeof raw.newCustomersCount === 'number'
        ? raw.newCustomersCount
        : undefined,
    newProducts:
      typeof raw.newProducts === 'number'
        ? raw.newProducts
        : typeof raw.newProductsCount === 'number'
        ? raw.newProductsCount
        : undefined,
    errorLogs: Array.isArray(raw.errorLogs)
      ? raw.errorLogs.map(normalizeLogItem)
      : [],
    duplicateLogs: Array.isArray(raw.duplicateLogs)
      ? raw.duplicateLogs.map(normalizeLogItem)
      : [],
  };
};

/**
 * GET /api/v1/uploads
 * Lists all uploaded files ordered File 1, File 2, ... by sequence.
 */
export const getUploadBatches = async (
  config?: ApiRequestConfig
): Promise<UploadBatch[]> => {
  const response = await axiosInstance.get('/uploads', config);
  const raw = unwrapPayload<unknown[] | { batches?: unknown[] }>(response.data);

  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray(raw.batches)
    ? raw.batches
    : [];

  return list
    .map((batch, index) => normalizeUploadBatch(batch, index + 1))
    .sort((a, b) => a.sequence - b.sequence);
};

/**
 * GET /api/v1/uploads/:batchId
 * Retrieves full metadata plus errorLogs[] and duplicateLogs[] for a specific batch.
 */
export const getUploadBatchById = async (
  batchId: string,
  config?: ApiRequestConfig
): Promise<UploadBatch> => {
  const response = await axiosInstance.get(`/uploads/${batchId}`, config);
  const raw = unwrapPayload<Record<string, unknown>>(response.data);
  return normalizeUploadBatch({ ...raw, batchId: raw.batchId ?? batchId });
};

/**
 * DELETE /api/v1/uploads/:batchId
 * Deletes an uploaded file batch and its associated sales records & exclusive entities.
 */
export const deleteUploadBatch = async (
  batchId: string
): Promise<{ message: string; batchId: string }> => {
  const response = await axiosInstance.delete(`/uploads/${batchId}`);
  return unwrapPayload(response.data);
};

/* ============================================================================
 * 2. DASHBOARD ANALYTICS & FORECASTING ENDPOINTS (/api/v1/analytics/*)
 * ========================================================================== */

/**
 * GET /api/v1/analytics/overview
 * Fetches the 5 core KPIs and distinct filter options across the selected files.
 */
export const getAnalyticsOverview = async (
  params: DashboardFilterParams,
  config?: ApiRequestConfig
): Promise<OverviewResponse> => {
  const response = await axiosInstance.get('/analytics/overview', {
    ...config,
    params: serializeAnalyticsParams(params),
  });

  const raw = unwrapPayload<Record<string, unknown>>(response.data);
  const kpiSource = (
    raw.kpis && typeof raw.kpis === 'object' ? raw.kpis : raw
  ) as Record<string, unknown>;
  const filterSource = (
    raw.filterOptions && typeof raw.filterOptions === 'object'
      ? raw.filterOptions
      : raw.filters && typeof raw.filters === 'object'
      ? raw.filters
      : raw.options && typeof raw.options === 'object'
      ? raw.options
      : raw
  ) as Record<string, unknown>;

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
        ? filterSource.categories.map(String)
        : [],
      regions: Array.isArray(filterSource.regions)
        ? filterSource.regions.map(String)
        : [],
      minDate: filterSource.minDate ? String(filterSource.minDate) : null,
      maxDate: filterSource.maxDate ? String(filterSource.maxDate) : null,
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
    params: serializeAnalyticsParams({
      ...params,
      granularity: params.granularity ?? 'month',
    }),
  });

  const raw = unwrapPayload<
    unknown[] | { trends?: unknown[]; series?: unknown[] }
  >(response.data);

  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray(raw.trends)
    ? raw.trends
    : raw && typeof raw === 'object' && Array.isArray(raw.series)
    ? raw.series
    : [];

  return list.map((item) => {
    const point = (item && typeof item === 'object' ? item : {}) as Record<
      string,
      unknown
    >;
    return {
      date: String(point.date ?? point.period ?? point._id ?? ''),
      revenue: Number(point.revenue ?? point.totalRevenue ?? 0),
      orders: Number(point.orders ?? point.totalOrders ?? 0),
      averageOrderValue:
        point.averageOrderValue !== undefined
          ? Number(point.averageOrderValue)
          : undefined,
    };
  });
};

/**
 * GET /api/v1/analytics/breakdowns
 * Fetches Top 10 Products, Top 10 Customers, Category Share, and Region Share.
 */
export const getAnalyticsBreakdowns = async (
  params: DashboardFilterParams,
  config?: ApiRequestConfig
): Promise<BreakdownsResponse> => {
  const response = await axiosInstance.get('/analytics/breakdowns', {
    ...config,
    params: serializeAnalyticsParams(params),
  });

  const raw = unwrapPayload<Record<string, unknown>>(response.data);

  const rawProducts = Array.isArray(raw.topProducts)
    ? raw.topProducts
    : Array.isArray(raw.products)
    ? raw.products
    : [];

  const topProducts = rawProducts.map((entry) => {
    const item = (entry && typeof entry === 'object' ? entry : {}) as Record<
      string,
      unknown
    >;
    return {
      productId: item.productId
        ? String(item.productId)
        : item._id
        ? String(item._id)
        : undefined,
      productName: String(item.productName ?? item.name ?? 'Unknown Product'),
      category: String(item.category ?? 'Uncategorized'),
      unitsSold: Number(item.unitsSold ?? item.quantity ?? 0),
      totalRevenue: Number(item.totalRevenue ?? item.revenue ?? 0),
      percentageOfSales: Number(
        item.percentageOfSales ??
          item.percentOfTotal ??
          item.percentage ??
          item.share ??
          0
      ),
    };
  });

  const rawCustomers = Array.isArray(raw.topCustomers)
    ? raw.topCustomers
    : Array.isArray(raw.customers)
    ? raw.customers
    : [];

  const topCustomers = rawCustomers.map((entry) => {
    const item = (entry && typeof entry === 'object' ? entry : {}) as Record<
      string,
      unknown
    >;
    return {
      customerId: item.customerId
        ? String(item.customerId)
        : item._id
        ? String(item._id)
        : undefined,
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
    };
  });

  const rawCategories = Array.isArray(raw.categoryDistribution)
    ? raw.categoryDistribution
    : Array.isArray(raw.categories)
    ? raw.categories
    : [];

  const categoryDistribution = rawCategories.map((entry) => {
    const item = (entry && typeof entry === 'object' ? entry : {}) as Record<
      string,
      unknown
    >;
    return {
      name: String(item.category ?? item.name ?? item._id ?? 'Uncategorized'),
      revenue: Number(item.revenue ?? item.totalRevenue ?? 0),
      orders: item.orders !== undefined ? Number(item.orders) : undefined,
      percentage: Number(
        item.percentage ?? item.percentOfTotal ?? item.share ?? 0
      ),
    };
  });

  const rawRegions = Array.isArray(raw.regionDistribution)
    ? raw.regionDistribution
    : Array.isArray(raw.regions)
    ? raw.regions
    : [];

  const regionDistribution = rawRegions.map((entry) => {
    const item = (entry && typeof entry === 'object' ? entry : {}) as Record<
      string,
      unknown
    >;
    return {
      name: String(item.region ?? item.name ?? item._id ?? 'Unknown'),
      revenue: Number(item.revenue ?? item.totalRevenue ?? 0),
      orders: item.orders !== undefined ? Number(item.orders) : undefined,
      percentage: Number(
        item.percentage ?? item.percentOfTotal ?? item.share ?? 0
      ),
    };
  });

  return {
    topProducts,
    topCustomers,
    categoryDistribution,
    regionDistribution,
  };
};

/**
 * GET /api/v1/analytics/forecast
 * Fetches historical monthly revenue + next N predicted months + R^2 score.
 */
export const getSalesForecast = async (
  params: ForecastFilterParams,
  config?: ApiRequestConfig
): Promise<ForecastResponse> => {
  const response = await axiosInstance.get('/analytics/forecast', {
    ...config,
    params: serializeAnalyticsParams({
      batchIds: params.batchIds,
      category: params.category,
      region: params.region,
      horizon: params.horizon ?? 3,
    }),
  });

  const raw = unwrapPayload<Record<string, unknown>>(response.data);

  const rawHistorical = Array.isArray(raw.historical)
    ? raw.historical
    : Array.isArray(raw.history)
    ? raw.history
    : [];

  const historical = rawHistorical.map((entry) => {
    const pt = (entry && typeof entry === 'object' ? entry : {}) as Record<
      string,
      unknown
    >;
    return {
      date: String(pt.date ?? pt.month ?? pt.period ?? ''),
      revenue: Number(pt.revenue ?? pt.totalRevenue ?? 0),
    };
  });

  const rawForecast = Array.isArray(raw.forecast)
    ? raw.forecast
    : Array.isArray(raw.predictions)
    ? raw.predictions
    : Array.isArray(raw.projected)
    ? raw.projected
    : [];

  const forecast = rawForecast.map((entry) => {
    const pt = (entry && typeof entry === 'object' ? entry : {}) as Record<
      string,
      unknown
    >;
    const predictedVal = Number(
      pt.predictedRevenue ?? pt.forecastRevenue ?? pt.revenue ?? 0
    );
    return {
      date: String(pt.date ?? pt.month ?? pt.period ?? ''),
      predictedRevenue: predictedVal,
      revenue: predictedVal,
      lower:
        pt.lower !== undefined && pt.lower !== null ? Number(pt.lower) : null,
      upper:
        pt.upper !== undefined && pt.upper !== null ? Number(pt.upper) : null,
    };
  });

  const combinedSeries: ForecastDataPoint[] = historical.map((item, index) => ({
    date: item.date,
    actualRevenue: item.revenue,
    forecastRevenue: index === historical.length - 1 ? item.revenue : null,
    isForecast: false,
  }));

  forecast.forEach((item) => {
    combinedSeries.push({
      date: item.date,
      actualRevenue: null,
      forecastRevenue: item.predictedRevenue,
      lower: item.lower,
      upper: item.upper,
      isForecast: true,
    });
  });

  const rSquared = Number(raw.rSquared ?? raw.r2 ?? raw.confidence ?? 0);
  const confidenceLabel: ForecastResponse['confidenceLabel'] =
    rSquared >= 0.75 ? 'High' : rSquared >= 0.45 ? 'Moderate' : 'Low';

  const rawTrend = raw.trendDirection ?? raw.trend;
  const trendDirection: ForecastResponse['trendDirection'] =
    rawTrend === 'upward' || rawTrend === 'downward' || rawTrend === 'flat'
      ? rawTrend
      : Number(raw.slope ?? 0) > 0
      ? 'upward'
      : Number(raw.slope ?? 0) < 0
      ? 'downward'
      : 'flat';

  return {
    historical,
    forecast,
    combinedSeries,
    trendDirection,
    slope: Number(raw.slope ?? 0),
    intercept: raw.intercept !== undefined ? Number(raw.intercept) : undefined,
    rSquared,
    confidenceLabel,
    methodUsed: String(
      raw.methodUsed ??
        raw.method ??
        '70% OLS Linear Regression + 30% 3-Month WMA'
    ),
    note: raw.note ? String(raw.note) : undefined,
  };
};

/**
 * GET /api/v1/analytics/new-entities
 * Returns customers and products introduced in each file relative to earlier files.
 */
export const getNewEntities = async (
  params: NewEntitiesFilterParams = {},
  config?: ApiRequestConfig
): Promise<NewEntitiesResponse> => {
  const response = await axiosInstance.get('/analytics/new-entities', {
    ...config,
    params: serializeAnalyticsParams({
      ...params,
      limit: params.limit ?? 200,
    }),
  });

  const raw = unwrapPayload<Record<string, unknown> | unknown[]>(response.data);
  const rawFiles = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray(raw.files)
    ? raw.files
    : [];

  const files: NewEntitiesFileGroup[] = rawFiles.map((entry, idx) => {
    const fileObj = (
      entry && typeof entry === 'object' ? entry : {}
    ) as Record<string, unknown>;

    const rawCustomers = Array.isArray(fileObj.newCustomers)
      ? fileObj.newCustomers
      : [];
    const rawProducts = Array.isArray(fileObj.newProducts)
      ? fileObj.newProducts
      : [];

    const newCustomers: NewCustomerItem[] = rawCustomers.map((c) => {
      const item = (c && typeof c === 'object' ? c : {}) as Record<
        string,
        unknown
      >;
      return {
        customerId: String(item.customerId ?? ''),
        customerName: String(item.customerName ?? item.customerId ?? 'Unknown'),
        totalOrders: Number(item.totalOrders ?? 0),
        totalRevenue: Number(item.totalRevenue ?? 0),
        invoices: Array.isArray(item.invoices)
          ? item.invoices.map(String)
          : [],
        invoicesTruncated: Boolean(item.invoicesTruncated),
      };
    });

    const newProducts: NewProductItem[] = rawProducts.map((p) => {
      const item = (p && typeof p === 'object' ? p : {}) as Record<
        string,
        unknown
      >;
      return {
        productId: String(item.productId ?? ''),
        productName: String(item.productName ?? item.productId ?? 'Unknown'),
        category: String(item.category ?? 'Uncategorized'),
        unitsSold: Number(item.unitsSold ?? 0),
        totalOrders: Number(item.totalOrders ?? 0),
        totalRevenue: Number(item.totalRevenue ?? 0),
        invoices: Array.isArray(item.invoices)
          ? item.invoices.map(String)
          : [],
        invoicesTruncated: Boolean(item.invoicesTruncated),
      };
    });

    return {
      batchId: String(fileObj.batchId ?? fileObj._id ?? ''),
      fileName: String(fileObj.fileName ?? `File ${idx + 1}`),
      sequence: Number(fileObj.sequence ?? idx + 1),
      isBaseline: Boolean(fileObj.isBaseline),
      newCustomersCount: Number(
        fileObj.newCustomersCount ?? newCustomers.length
      ),
      newProductsCount: Number(fileObj.newProductsCount ?? newProducts.length),
      truncated: Boolean(fileObj.truncated),
      newCustomers,
      newProducts,
    };
  });

  return {
    files: files.sort((a, b) => a.sequence - b.sequence),
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
  newEntities: NewEntitiesResponse;
}

/**
 * Fetches all 5 analytics endpoints in parallel when selected files or filters change.
 */
export const fetchFullDashboardData = async (
  filters: DashboardFilterParams & {
    granularity?: Granularity;
    horizon?: number;
  },
  signal?: AbortSignal
): Promise<FullDashboardBundle> => {
  const { granularity = 'month', horizon = 3, ...baseFilters } = filters;

  const [overview, trends, breakdowns, forecast, newEntities] =
    await Promise.all([
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
      getNewEntities(baseFilters, { signal }),
    ]);

  return { overview, trends, breakdowns, forecast, newEntities };
};
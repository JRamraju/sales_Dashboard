// client/types/dashboard.types.ts

export type Granularity = 'day' | 'week' | 'month';
export type TrendDirection = 'upward' | 'downward' | 'flat';
export type BatchStatus =
  | 'queued'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';

/**
 * Quarantine error log or duplicate row log entry
 */
export interface ValidationErrorLog {
  rowNumber?: number;
  row?: number;
  field?: string;
  message: string;
  reason?: string;
  rawValue?: unknown;
}

/**
 * Metadata per uploaded file batch (UploadBatch model)
 * Ordered File 1, File 2, ... by sequence.
 */
export interface UploadBatch {
  _id: string;
  batchId: string;
  /** File 1, File 2, ... by upload order. null while queued/processing/failed. */
  fileNumber?: number | null;
  fileName: string;
  originalName?: string;
  status: BatchStatus;
  totalRows: number;
  validRowsInserted: number;
  invalidRowsCount: number;
  /** Rows skipped because their order_id was already in an earlier file (also counted in invalidRowsCount). */
  duplicateRowsSkipped?: number;
  duplicateOrdersSkipped?: number;
  /** Customers / products this file created vs. linked to existing ones. */
  newCustomersCreated?: number;
  existingCustomersLinked?: number;
  newProductsCreated?: number;
  existingProductsLinked?: number;
  /** Skipped rows (invalid + duplicate). Only present on GET /uploads/:id. */
  errorLogs: ValidationErrorLog[];
  failureReason?: string;
  dateOrder?: string;
  notes?: string[];
  uploadedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Response from POST /api/v1/uploads (202 Accepted)
 */
export interface UploadInitResponse {
  batchId: string;
  jobId?: string;
  status: BatchStatus;
  fileName: string;
  message?: string;
  inserted?: number;
  skipped?: number;
  errorLogs?: ValidationErrorLog[];
}

/**
 * Real-time WebSocket Event Payloads
 */
export interface UploadProgressEvent {
  batchId: string;
  progress: number; // 0 to 100
  processedRows: number;
  totalRows?: number;
}

export interface CreatedVsLinked {
  created: number;
  existing: number;
}

export interface DuplicateSummary {
  /** Rows skipped because the order was already in an earlier file. */
  rows: number;
  /** Distinct orders those rows belong to. */
  orders: number;
}

export interface UploadCompletedEvent {
  batchId: string;
  fileName?: string;
  totalRows?: number;
  inserted: number;
  /** All skipped rows: invalid rows + duplicate-order rows. */
  skipped: number;
  errorLogs: ValidationErrorLog[];
  errorLogsTruncated?: boolean;
  dateOrder?: string;
  notes?: string[];
  customers?: CreatedVsLinked;
  products?: CreatedVsLinked;
  duplicates?: DuplicateSummary;
}

export interface UploadFailedEvent {
  batchId: string;
  reason?: string;
  error: string;
}

/**
 * Global Dashboard Query Filter Parameters
 * When `batchIds` is omitted or empty, the server uses ALL completed files.
 */
export interface DashboardFilterParams {
  batchIds?: string[];
  startDate?: string | null;
  endDate?: string | null;
  category?: string | string[] | null;
  region?: string | string[] | null;
}

export interface TrendFilterParams extends DashboardFilterParams {
  granularity?: Granularity;
}

export interface ForecastFilterParams {
  batchIds?: string[];
  horizon?: number; // Default 3 months
  category?: string | string[] | null;
  region?: string | string[] | null;
}

export interface NewRecordsParams {
  batchIds?: string[];
  limit?: number; // Default 100, max 500
}

/**
 * 1. GET /api/v1/analytics/overview Response
 */
export interface KpiMetrics {
  totalRevenue: number;
  totalOrders: number;
  totalCustomers: number;
  averageOrderValue: number;
  revenueGrowth: number; // Percentage (%)
  previousPeriodRevenue?: number;
}

export interface FilterOptions {
  categories: string[];
  regions: string[];
  minDate?: string | null;
  maxDate?: string | null;
}

export interface OverviewResponse {
  kpis: KpiMetrics;
  filterOptions: FilterOptions;
}

/**
 * 2. GET /api/v1/analytics/trends Response
 */
export interface RevenueTrendPoint {
  date: string;
  revenue: number;
  orders: number;
  averageOrderValue?: number;
}

/**
 * 3. GET /api/v1/analytics/breakdowns Response
 */
export interface ProductPerformanceItem {
  productId?: string;
  productName: string;
  category: string;
  unitsSold: number;
  totalRevenue: number;
  percentageOfSales: number;
}

export interface CustomerLeaderboardItem {
  customerId?: string;
  customerName: string;
  totalOrders: number;
  totalSpend: number;
  averageOrderValue: number;
  lastPurchaseDate: string;
}

export interface DimensionDistributionItem {
  name: string; // Category or Region name
  revenue: number;
  orders?: number;
  percentage: number;
}

export interface BreakdownsResponse {
  topProducts: ProductPerformanceItem[];
  topCustomers: CustomerLeaderboardItem[];
  categoryDistribution: DimensionDistributionItem[];
  regionDistribution: DimensionDistributionItem[];
}

/**
 * 4. GET /api/v1/analytics/forecast Response
 */
export interface ForecastDataPoint {
  date: string; // YYYY-MM
  actualRevenue?: number | null;
  forecastRevenue?: number | null;
  lower?: number | null;
  upper?: number | null;
  isForecast?: boolean;
}

export interface ForecastResponse {
  historical: { date: string; revenue: number }[];
  forecast: {
    date: string;
    predictedRevenue: number;
    revenue?: number;
    lower?: number | null;
    upper?: number | null;
  }[];
  combinedSeries?: ForecastDataPoint[];
  trendDirection: TrendDirection;
  slope: number;
  intercept?: number;
  rSquared: number; // Coefficient of determination (R^2)
  confidenceLabel?: 'High' | 'Moderate' | 'Low';
  methodUsed?: string;
  note?: string;
}

/**
 * 5. GET /api/v1/analytics/new-records Response
 * For each file: the customers / products in it that are in no earlier file.
 */
export interface NewCustomerRecord {
  customerId: string;
  customerName: string;
  orders: number;
  revenue: number;
  firstOrderDate?: string | null;
}

export interface NewProductRecord {
  productId: string;
  productName: string;
  category: string;
  unitsSold: number;
  revenue: number;
}

export interface NewRecordsGroup<T> {
  /** Total new records (may be larger than items.length when truncated). */
  count: number;
  /** Revenue from ALL new records, not just the listed ones. */
  revenue: number;
  items: T[];
  truncated: boolean;
}

export interface NewRecordsFile {
  batchId: string;
  fileName: string;
  fileNumber: number;
  uploadedAt?: string;
  /** File 1 has nothing earlier to compare with, so its lists are empty. */
  isFirstFile: boolean;
  comparedWith: { batchId: string; fileNumber: number; fileName: string }[];
  newCustomers: NewRecordsGroup<NewCustomerRecord>;
  newProducts: NewRecordsGroup<NewProductRecord>;
}

export interface NewRecordsResponse {
  files: NewRecordsFile[];
}
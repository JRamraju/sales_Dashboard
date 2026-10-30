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
  sequence: number;
  fileName: string;
  originalName?: string;
  status: BatchStatus;
  totalRows: number;
  validRowsInserted: number;
  invalidRowsCount: number;
  duplicateRowsCount: number;
  newCustomersCount: number;
  newProductsCount: number;
  errorLogs: ValidationErrorLog[];
  duplicateLogs: ValidationErrorLog[];
  errorLogsTruncated?: boolean;
  duplicateLogsTruncated?: boolean;
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
  sequence: number;
  jobId?: string;
  status: BatchStatus;
  fileName: string;
  message?: string;
  inserted?: number;
  skipped?: number;
  duplicates?: number;
  newCustomers?: number;
  newProducts?: number;
  errorLogs?: ValidationErrorLog[];
  duplicateLogs?: ValidationErrorLog[];
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

export interface UploadCompletedEvent {
  batchId: string;
  sequence?: number;
  fileName?: string;
  totalRows?: number;
  inserted: number;
  skipped: number;
  duplicates: number;
  newCustomers: number;
  newProducts: number;
  errorLogs: ValidationErrorLog[];
  errorLogsTruncated?: boolean;
  duplicateLogs: ValidationErrorLog[];
  duplicateLogsTruncated?: boolean;
  dateOrder?: string;
  notes?: string[];
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

export interface NewEntitiesFilterParams extends DashboardFilterParams {
  limit?: number; // Default 200
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
 * 5. GET /api/v1/analytics/new-entities Response
 */
export interface NewCustomerItem {
  customerId: string;
  customerName: string;
  totalOrders: number;
  totalRevenue: number;
  invoices: string[];
  invoicesTruncated: boolean;
}

export interface NewProductItem {
  productId: string;
  productName: string;
  category: string;
  unitsSold: number;
  totalOrders: number;
  totalRevenue: number;
  invoices: string[];
  invoicesTruncated: boolean;
}

export interface NewEntitiesFileGroup {
  batchId: string;
  fileName: string;
  sequence: number;
  isBaseline: boolean;
  newCustomersCount: number;
  newProductsCount: number;
  truncated: boolean;
  newCustomers: NewCustomerItem[];
  newProducts: NewProductItem[];
}

export interface NewEntitiesResponse {
  files: NewEntitiesFileGroup[];
}

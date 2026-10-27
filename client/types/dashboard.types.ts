// client/types/dashboard.types.ts

export type Granularity = 'day' | 'week' | 'month';
export type TrendDirection = 'upward' | 'downward' | 'flat';
export type BatchStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Quarantine error log entry for invalid/skipped rows
 */
export interface ValidationErrorLog {
  rowNumber?: number;
  row?: number;
  field?: string;
  message: string;
  rawValue?: unknown;
}

/**
 * Metadata per uploaded file batch (UploadBatch model)
 */
export interface UploadBatch {
  _id: string;
  batchId?: string;
  fileName: string;
  originalName?: string;
  status: BatchStatus;
  totalRows?: number;
  validRowsInserted: number;
  invalidRowsCount: number;
  errorLogs: ValidationErrorLog[];
  uploadedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Response from POST /api/v1/uploads
 */
export interface UploadInitResponse {
  batchId: string;
  jobId?: string;
  status: BatchStatus;
  fileName?: string;
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

export interface UploadCompletedEvent {
  batchId: string;
  fileName?: string;
  inserted: number;
  skipped: number;
  errorLogs: ValidationErrorLog[];
}

export interface UploadFailedEvent {
  batchId: string;
  error: string;
}

/**
 * Global Dashboard Query Filter Parameters
 */
export interface DashboardFilterParams {
  batchId: string;
  startDate?: string | null;
  endDate?: string | null;
  category?: string | string[] | null;
  region?: string | string[] | null;
}

export interface TrendFilterParams extends DashboardFilterParams {
  granularity?: Granularity;
}

export interface ForecastFilterParams {
  batchId: string;
  horizon?: number; // Default 3 months
  category?: string | string[] | null;
  region?: string | string[] | null;
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
  isForecast?: boolean;
}

export interface ForecastResponse {
  historical: { date: string; revenue: number }[];
  forecast: { date: string; predictedRevenue: number; revenue?: number }[];
  combinedSeries?: ForecastDataPoint[];
  trendDirection: TrendDirection;
  slope: number;
  intercept?: number;
  rSquared: number; // Coefficient of determination (R^2)
  confidenceLabel?: 'High' | 'Moderate' | 'Low';
  methodUsed?: string;
}
// client/types/dashboard.types.ts

export type Granularity = 'day' | 'week' | 'month';
export type TrendDirection = 'upward' | 'downward' | 'flat';
export type BatchStatus = 'queued' | 'processing' | 'completed' | 'failed';

/**
 * Master-data synchronization counts per uploaded file
 */
export interface EntitySyncCounts {
  created: number;
  existing: number;
}

/**
 * Cross-file and intra-file duplicate order/row counts
 */
export interface DuplicateCounts {
  rows: number;
  orders: number;
}

/**
 * Quarantine error log entry for invalid/skipped rows
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
 */
export interface UploadBatch {
  _id: string;
  batchId?: string;
  fileName: string;
  originalName?: string;
  fileNumber?: number | null;
  status: BatchStatus;
  totalRows?: number;
  validRowsInserted: number;
  invalidRowsCount: number;
  customers?: EntitySyncCounts;
  products?: EntitySyncCounts;
  duplicates?: DuplicateCounts;
  notes?: string[];
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
  fileNumber?: number | null;
  message?: string;
  inserted?: number;
  skipped?: number;
  customers?: EntitySyncCounts;
  products?: EntitySyncCounts;
  duplicates?: DuplicateCounts;
  notes?: string[];
  errorLogs?: ValidationErrorLog[];
}

/**
 * Response from DELETE /api/v1/uploads/:batchId
 */
export interface DeleteBatchResponse {
  batchId: string;
  deletedRecords?: number;
  removedCustomers?: number;
  removedProducts?: number;
  message: string;
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
  fileNumber?: number | null;
  inserted: number;
  skipped: number;
  customers?: EntitySyncCounts;
  products?: EntitySyncCounts;
  duplicates?: DuplicateCounts;
  notes?: string[];
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
  batchId?: string;
  batchIds?: string[];
  startDate?: string | null;
  endDate?: string | null;
  category?: string | string[] | null;
  region?: string | string[] | null;
}

export interface TrendFilterParams extends DashboardFilterParams {
  batchId?: string;
  batchIds?: string[];
  granularity?: Granularity;
}

export interface ForecastFilterParams {
  batchId?: string;
  batchIds?: string[];
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

/**
 * 5. GET /api/v1/analytics/new-records Types
 */
export interface ComparedFileRef {
  batchId: string;
  fileNumber: number;
  fileName: string;
}

export interface NewCustomerItem {
  customerId: string;
  customerName: string;
  orders: number;
  revenue: number;
  firstOrderDate: string;
}

export interface NewProductItem {
  productId: string;
  productName: string;
  category: string;
  unitsSold: number;
  revenue: number;
}

export interface NewRecordsGroup<T> {
  count: number;
  revenue: number;
  truncated: boolean;
  items: T[];
}

export interface FileNewRecords {
  batchId: string;
  fileName: string;
  fileNumber: number;
  uploadedAt: string;
  isFirstFile: boolean;
  comparedWith: ComparedFileRef[];
  newCustomers: NewRecordsGroup<NewCustomerItem>;
  newProducts: NewRecordsGroup<NewProductItem>;
}

export interface NewRecordsResponse {
  files: FileNewRecords[];
}

export interface NewRecordsParams {
  batchIds?: string[];
  limit?: number;
}
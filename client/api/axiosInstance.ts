// client/api/axiosInstance.ts
import axios, {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'https://sales-dashboard-ee4e.onrender.com/api/v1';

/**
 * Normalized API Error class for consistent frontend error handling
 */
export class ApiClientError extends Error {
  public statusCode: number;
  public details?: unknown;

  constructor(message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Custom query parameter serializer:
 * - Removes null, undefined, or empty string parameters
 * - Joins array filters (e.g., category=['Electronics', 'Apparel']) as comma-separated strings
 */
const serializeQueryParams = (params: Record<string, unknown>): string => {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    if (Array.isArray(value)) {
      const validItems = value.filter(
        (item) => item !== undefined && item !== null && String(item).trim() !== ''
      );
      if (validItems.length > 0) {
        searchParams.append(key, validItems.join(','));
      }
      return;
    }

    searchParams.append(key, String(value));
  });

  return searchParams.toString();
};

/**
 * Core Axios Singleton Instance
 */
const axiosInstance: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 60000, // 60s timeout to accommodate large file uploads & aggregations
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
  paramsSerializer: {
    serialize: serializeQueryParams,
  },
});

/**
 * Request Interceptor:
 * Automatically lets the browser set the correct multipart boundary
 * when uploading a FormData instance (CSV / Excel files).
 */
axiosInstance.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (config.data instanceof FormData && config.headers) {
      delete config.headers['Content-Type'];
    }
    return config;
  },
  (error: AxiosError) => Promise.reject(error)
);

/**
 * Response & Error Interceptor:
 * Extracts readable error messages from Express error middleware responses.
 */
axiosInstance.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError<{ message?: string; error?: string; errors?: unknown }>) => {
    // Handle request cancellation gracefully
    if (axios.isCancel(error)) {
      return Promise.reject(error);
    }

    const statusCode = error.response?.status ?? 500;
    const responseData = error.response?.data;

    let errorMessage =
      responseData?.message ||
      responseData?.error ||
      error.message ||
      'An unexpected network error occurred.';

    if (error.code === 'ECONNABORTED') {
      errorMessage =
        'Request timed out. The server might be processing a very large dataset.';
    } else if (!error.response) {
      errorMessage =
        'Unable to reach the analytics server. Please ensure the backend is running on port 5000.';
    }

    return Promise.reject(
      new ApiClientError(errorMessage, statusCode, responseData?.errors ?? responseData)
    );
  }
);

export default axiosInstance;
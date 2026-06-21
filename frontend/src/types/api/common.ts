export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  code?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
}

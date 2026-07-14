export interface ApiResponse<T = unknown> {
  success: boolean;
  /**
   * Backend business code. Do not render this directly as UI copy.
   * Use feature-local text or a dedicated translation dictionary instead.
   */
  message?: string;
  data?: T;
  code?: string;
  error?: string;
  request_id?: string;
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

export interface CursorPage<T, Cursor = string | number | null> {
  items: T[];
  next_cursor: Cursor;
}

export interface OffsetPage<T> {
  items: T[];
  limit: number;
  offset: number;
  has_more: boolean;
}

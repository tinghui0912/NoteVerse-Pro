'use client';

/**
 * 统一 API 客户端
 * 处理 JWT Token 自动附加、统一错误处理、响应类型定义
 */

// API 基础 URL
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';

// Token 存储键名
const TOKEN_KEY = 'access_token';

// 类型定义统一从 @/types/api 导入并重导出，避免重复定义
export type { ApiResponse, PaginatedResponse } from '@/types/api';

/**
 * API 错误类
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * 获取存储的 Token
 */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * 保存 Token
 */
export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
}

/**
 * 清除 Token
 */
export function clearToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * 构建请求头
 */
function buildHeaders(customHeaders?: HeadersInit): Headers {
  const headers = new Headers(customHeaders);

  // 默认 Content-Type
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // 附加 JWT Token
  const token = getToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return headers;
}

/**
 * 处理响应
 */
async function handleResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type');

  // 处理非 JSON 响应（如文件下载）
  if (contentType && !contentType.includes('application/json')) {
    if (!response.ok) {
      throw new ApiError(response.status, 'REQUEST_FAILED', `Request failed: ${response.statusText}`);
    }
    return response as unknown as T;
  }

  const data = await response.json();

  if (!response.ok) {
    // 处理 401 未授权
    if (response.status === 401) {
      clearToken();
      // 只有不在登录页时才重定向，并带上 returnUrl
      if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
        const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?returnUrl=${returnUrl}`;
      }
    }

    throw new ApiError(
      response.status,
      data.code || 'REQUEST_FAILED',
      data.error || data.message || 'REQUEST_FAILED',
      data.details
    );
  }

  return data as T;
}

/**
 * GET 请求
 */
async function get<T>(url: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const queryString = params
    ? '?' + new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ).toString()
    : '';

  const response = await fetch(`${API_BASE_URL}${url}${queryString}`, {
    method: 'GET',
    headers: buildHeaders(),
  });

  return handleResponse<T>(response);
}

/**
 * POST 请求
 */
async function post<T>(url: string, data?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${url}`, {
    method: 'POST',
    headers: buildHeaders(),
    body: data ? JSON.stringify(data) : undefined,
  });

  return handleResponse<T>(response);
}

/**
 * PUT 请求
 */
async function put<T>(url: string, data?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${url}`, {
    method: 'PUT',
    headers: buildHeaders(),
    body: data ? JSON.stringify(data) : undefined,
  });

  return handleResponse<T>(response);
}

/**
 * PATCH 请求
 */
async function patch<T>(url: string, data?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${url}`, {
    method: 'PATCH',
    headers: buildHeaders(),
    body: data ? JSON.stringify(data) : undefined,
  });

  return handleResponse<T>(response);
}

/**
 * DELETE 请求
 */
async function del<T>(url: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${url}`, {
    method: 'DELETE',
    headers: buildHeaders(),
  });

  return handleResponse<T>(response);
}

/**
 * 文件上传请求
 */
async function upload<T>(url: string, file: File, fieldName: string = 'file'): Promise<T> {
  const formData = new FormData();
  formData.append(fieldName, file);

  // 上传时不设置 Content-Type，让浏览器自动设置 boundary
  const headers = new Headers();
  const token = getToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${url}`, {
    method: 'POST',
    headers,
    body: formData,
  });

  return handleResponse<T>(response);
}

/**
 * 文件下载请求（返回 Blob）
 */
async function download(url: string): Promise<Blob> {
  const headers = buildHeaders();
  headers.delete('Content-Type'); // 下载不需要 Content-Type

  const response = await fetch(`${API_BASE_URL}${url}`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    throw new ApiError(response.status, 'DOWNLOAD_FAILED', 'DOWNLOAD_FAILED');
  }

  return response.blob();
}

/**
 * 表单登录请求 (OAuth2 格式)
 */
async function postForm<T>(url: string, data: Record<string, string>): Promise<T> {
  const headers = new Headers();
  headers.set('Content-Type', 'application/x-www-form-urlencoded');

  const response = await fetch(`${API_BASE_URL}${url}`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(data),
  });

  return handleResponse<T>(response);
}

/**
 * POST 请求下载文件（返回 Blob）
 */
async function postDownload(url: string, data?: unknown): Promise<Response> {
  const headers = buildHeaders();

  const response = await fetch(`${API_BASE_URL}${url}`, {
    method: 'POST',
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  if (!response.ok) {
    // 尝试解析 JSON 错误信息
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const errorData = await response.json();
      throw new ApiError(
        response.status,
        errorData.code || 'REQUEST_FAILED',
        errorData.error || errorData.message || 'REQUEST_FAILED',
        errorData.details
      );
    }
    throw new ApiError(response.status, 'REQUEST_FAILED', `Request failed: ${response.statusText}`);
  }

  return response;
}

/**
 * GET 请求（返回原始 Response，用于需要自定义处理响应的场景）
 */
async function getRaw(url: string, params?: Record<string, string | number | boolean | undefined>): Promise<Response> {
  const queryString = params
    ? '?' + new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ).toString()
    : '';

  const headers = buildHeaders();

  const response = await fetch(`${API_BASE_URL}${url}${queryString}`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
        const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?returnUrl=${returnUrl}`;
      }
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const errorData = await response.json();
      throw new ApiError(
        response.status,
        errorData.code || 'REQUEST_FAILED',
        errorData.error || errorData.message || 'REQUEST_FAILED',
        errorData.details
      );
    }

    throw new ApiError(response.status, 'REQUEST_FAILED', `Request failed: ${response.statusText}`);
  }

  return response;
}

/**
 * API 客户端
 */
export const apiClient = {
  get,
  getRaw,
  post,
  postDownload,
  put,
  patch,
  delete: del,
  upload,
  download,
  postForm,
};

export default apiClient;

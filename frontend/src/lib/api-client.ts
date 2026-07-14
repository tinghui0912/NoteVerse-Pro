'use client';

import { getCurrentLoginHref } from '@/lib/auth/return-url';
import { requiredEnvValue } from '@/lib/env';

export const API_BASE_URL = requiredEnvValue(
  process.env.NEXT_PUBLIC_API_BASE_URL,
  'NEXT_PUBLIC_API_BASE_URL'
);
const CSRF_COOKIE_NAME = requiredEnvValue(
  process.env.NEXT_PUBLIC_CSRF_COOKIE_NAME,
  'NEXT_PUBLIC_CSRF_COOKIE_NAME'
);
const CSRF_HEADER_NAME = requiredEnvValue(
  process.env.NEXT_PUBLIC_CSRF_HEADER_NAME,
  'NEXT_PUBLIC_CSRF_HEADER_NAME'
);

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

interface RequestOptions {
  headers?: HeadersInit;
  suppressAuthRedirect?: boolean;
  signal?: AbortSignal;
}

export type { ApiResponse, PaginatedResponse } from '@/types/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
    public requestId?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function buildHeaders(customHeaders?: HeadersInit): Headers {
  const headers = new Headers(customHeaders);

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return headers;
}

function getCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;

  return document.cookie
    .split('; ')
    .map((cookie) => cookie.split('='))
    .find(([key]) => key === name)
    ?.[1];
}

function addCsrfHeader(headers: Headers, options?: { overwrite?: boolean }): Headers {
  const csrfToken = getCookie(CSRF_COOKIE_NAME);
  if (csrfToken && (options?.overwrite || !headers.has(CSRF_HEADER_NAME))) {
    headers.set(CSRF_HEADER_NAME, decodeURIComponent(csrfToken));
  }
  return headers;
}

function isUnsafeMethod(method?: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes((method ?? 'GET').toUpperCase());
}

function shouldSkipRefresh(url: string): boolean {
  return (
    url.endsWith('/auth/refresh') ||
    url.endsWith('/auth/login') ||
    url.endsWith('/auth/register') ||
    url.includes('/auth/email/') ||
    url.includes('/auth/password/')
  );
}

function redirectToLoginIfNeeded(options?: RequestOptions): void {
  if (options?.suppressAuthRedirect || typeof window === 'undefined') return;

  const { pathname } = window.location;
  if (pathname.endsWith('/auth/login')) return;

  window.location.href = getCurrentLoginHref();
}

async function readJsonSafely(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function createApiError(
  response: Response,
  data: Record<string, unknown>,
  fallbackCode = 'REQUEST_FAILED',
  fallbackMessage = `Request failed: ${response.statusText}`
): ApiError {
  return new ApiError(
    response.status,
    typeof data.code === 'string' ? data.code : fallbackCode,
    typeof data.error === 'string'
      ? data.error
      : typeof data.message === 'string'
        ? data.message
        : fallbackMessage,
    typeof data.details === 'object' && data.details !== null
      ? (data.details as Record<string, unknown>)
      : undefined,
    typeof data.request_id === 'string'
      ? data.request_id
      : response.headers.get('X-Request-ID') ?? undefined
  );
}

async function handleResponse<T>(response: Response, options?: RequestOptions): Promise<T> {
  const contentType = response.headers.get('content-type');

  if (response.status === 401) {
    redirectToLoginIfNeeded(options);
  }

  if (contentType && !contentType.includes('application/json')) {
    if (!response.ok) {
      throw new ApiError(
        response.status,
        'REQUEST_FAILED',
        `Request failed: ${response.statusText}`,
        undefined,
        response.headers.get('X-Request-ID') ?? undefined
      );
    }
    return response as T;
  }

  const data = await readJsonSafely(response);

  if (!response.ok) {
    throw createApiError(response, data);
  }

  return data as T;
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    const headers = addCsrfHeader(buildHeaders());
    refreshPromise = fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers,
      credentials: 'include',
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

async function fetchWithAuthRetry(
  url: string,
  init: RequestInit
): Promise<Response> {
  if (isUnsafeMethod(init.method) && !getCookie(CSRF_COOKIE_NAME) && !shouldSkipRefresh(url)) {
    await refreshSession();
    if (init.headers instanceof Headers) {
      addCsrfHeader(init.headers, { overwrite: true });
    }
  }

  const response = await fetch(url, init);

  if (
    response.status !== 401 ||
    shouldSkipRefresh(url)
  ) {
    return response;
  }

  const refreshed = await refreshSession();
  if (!refreshed) {
    return response;
  }

  if (init.headers instanceof Headers) {
    addCsrfHeader(init.headers, { overwrite: true });
  }

  return fetch(url, init);
}

function toQueryString(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return '';

  const query = new URLSearchParams(
    Object.entries(params)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)])
  );

  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

async function get<T>(
  url: string,
  params?: Record<string, string | number | boolean | undefined>,
  options?: RequestOptions
): Promise<T> {
  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}${toQueryString(params)}`, {
    method: 'GET',
    headers: addCsrfHeader(buildHeaders()),
    credentials: 'include',
    signal: options?.signal,
  });

  return handleResponse<T>(response, options);
}

async function post<T>(url: string, data?: unknown, options?: RequestOptions): Promise<T> {
  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
    method: 'POST',
    headers: addCsrfHeader(buildHeaders(options?.headers)),
    body: data ? JSON.stringify(data) : undefined,
    credentials: 'include',
  });

  return handleResponse<T>(response, options);
}

async function put<T>(url: string, data?: unknown): Promise<T> {
  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
    method: 'PUT',
    headers: addCsrfHeader(buildHeaders()),
    body: data ? JSON.stringify(data) : undefined,
    credentials: 'include',
  });

  return handleResponse<T>(response);
}

async function patch<T>(url: string, data?: unknown): Promise<T> {
  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
    method: 'PATCH',
    headers: addCsrfHeader(buildHeaders()),
    body: data ? JSON.stringify(data) : undefined,
    credentials: 'include',
  });

  return handleResponse<T>(response);
}

async function del<T>(url: string): Promise<T> {
  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
    method: 'DELETE',
    headers: addCsrfHeader(buildHeaders()),
    credentials: 'include',
  });

  return handleResponse<T>(response);
}

async function upload<T>(url: string, file: File, fieldName = 'file'): Promise<T> {
  const formData = new FormData();
  formData.append(fieldName, file);

  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
    method: 'POST',
    headers: addCsrfHeader(new Headers()),
    body: formData,
    credentials: 'include',
  });

  return handleResponse<T>(response);
}

async function download(url: string, options?: RequestOptions): Promise<Blob> {
  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
    method: 'GET',
    headers: addCsrfHeader(new Headers()),
    credentials: 'include',
    signal: options?.signal,
  });

  if (response.status === 401) {
    redirectToLoginIfNeeded();
  }

  if (!response.ok) {
    const data = response.headers.get('content-type')?.includes('application/json')
      ? await readJsonSafely(response)
      : {};
    throw createApiError(response, data, 'file_read_failed', 'file_read_failed');
  }

  return response.blob();
}

async function postForm<T>(url: string, data: Record<string, string>): Promise<T> {
  const headers = new Headers();
  headers.set('Content-Type', 'application/x-www-form-urlencoded');

  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
    method: 'POST',
    headers: addCsrfHeader(headers),
    body: new URLSearchParams(data),
    credentials: 'include',
  });

  return handleResponse<T>(response);
}

async function postDownload(url: string, data?: unknown): Promise<Response> {
  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
    method: 'POST',
    headers: addCsrfHeader(buildHeaders()),
    body: data ? JSON.stringify(data) : undefined,
    credentials: 'include',
  });

  if (response.status === 401) {
    redirectToLoginIfNeeded();
  }

  if (!response.ok) {
    const contentType = response.headers.get('content-type');
    const errorData = contentType?.includes('application/json')
      ? await readJsonSafely(response)
      : {};

    throw createApiError(
      response,
      errorData,
      'REQUEST_FAILED',
      `Request failed: ${response.statusText}`
    );
  }

  return response;
}

async function getRaw(
  url: string,
  params?: Record<string, string | number | boolean | undefined>,
  options?: RequestOptions
): Promise<Response> {
  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}${toQueryString(params)}`, {
    method: 'GET',
    headers: addCsrfHeader(buildHeaders()),
    credentials: 'include',
    signal: options?.signal,
  });

  if (response.status === 401) {
    redirectToLoginIfNeeded(options);
  }

  if (!response.ok) {
    const contentType = response.headers.get('content-type');
    const errorData = contentType?.includes('application/json')
      ? await readJsonSafely(response)
      : {};

    throw createApiError(
      response,
      errorData,
      'REQUEST_FAILED',
      `Request failed: ${response.statusText}`
    );
  }

  return response;
}

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

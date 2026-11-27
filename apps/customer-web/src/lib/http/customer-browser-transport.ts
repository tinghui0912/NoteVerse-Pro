'use client';

import { type CustomerErrorCode, type ApiErrorResponse } from '@/generated/api';
import { createClient, type RequestResult } from '@/generated/api/client';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/generated/browser-protocol';
import { isCustomerErrorCode } from '@/lib/i18n/customer-error-codes';
import { getCurrentLoginHref } from '@/features/authentication/return-url';
import { invalidateSession } from './session-invalidation';
import { reportClientError } from '@/lib/observability';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: CustomerErrorCode,
    public requestId?: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

function isRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.exec(value)?.[0] === value
  );
}

function isApplicationError(value: unknown): value is ApiErrorResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    Object.keys(payload).length === 2 &&
    Object.hasOwn(payload, 'code') &&
    Object.hasOwn(payload, 'request_id') &&
    isCustomerErrorCode(payload.code) &&
    isRequestId(payload.request_id)
  );
}

function cookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const value = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.slice(name.length + 1)) : undefined;
}

function redirectToLogin(): void {
  if (typeof window !== 'undefined' && !window.location.pathname.endsWith('/auth/login')) {
    window.location.href = getCurrentLoginHref();
  }
}

function safePath(url: string): string {
  return new URL(url).pathname.replace(/(\/guest-previews\/)[^/]+/, '$1[redacted]');
}

/** Policy profiles contain no Customer operation method, path or encoding. */
export function createCustomerBrowserTransport(
  options: {
    baseUrl?: string;
    fetch?: typeof fetch;
    onUnauthorized?: () => void;
  } = {},
) {
  const baseUrl =
    options.baseUrl ??
    (typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  const send = options.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const onUnauthorized = options.onUnauthorized ?? redirectToLogin;
  function makeClient(authenticated: boolean) {
    const client = createClient({
      baseUrl,
      credentials: 'include',
      fetch: async (input, init) => {
        const request = new Request(input, { ...init, credentials: 'include' });
        const signal = request.signal;
        signal.throwIfAborted();
        const unsafe = !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(request.method);
        const csrf = cookie(CSRF_COOKIE_NAME);
        if (unsafe && csrf) request.headers.set(CSRF_HEADER_NAME, csrf);
        const observedSend = async (outgoing: Request) => {
          signal.throwIfAborted();
          try {
            return await send(outgoing);
          } catch (error) {
            if (!signal.aborted)
              reportClientError(error, {
                area: 'customer_http',
                action: 'fetch',
                method: outgoing.method,
                path: safePath(outgoing.url),
              });
            throw error;
          }
        };
        const response = await observedSend(request);
        signal.throwIfAborted();
        if (response.status === 401 && authenticated) {
          invalidateSession();
          onUnauthorized();
        }
        return response;
      },
    });
    client.interceptors.error.use((error, response) => {
      if (!response) return error;
      if (isApplicationError(error)) {
        return new ApiError(response.status, error.code, error.request_id);
      }
      return new ApiError(
        response.status,
        response.status >= 500 ? 'internal_error' : 'unknown_error',
        isRequestId(response.headers.get('X-Request-ID'))
          ? response.headers.get('X-Request-ID')!
          : undefined,
      );
    });
    return client;
  }

  return {
    authenticated: { client: makeClient(true), throwOnError: true } as const,
    public: { client: makeClient(false), throwOnError: true } as const,
    silent: { client: makeClient(false), throwOnError: true } as const,
  };
}

export const customerTransport = createCustomerBrowserTransport();

/** Project SDK result metadata away while retaining the generated success payload. */
export async function responseBody<T>(
  request: RequestResult<Record<string, T>, unknown, true>,
): Promise<T> {
  return (await request).data;
}

/** Await an acknowledged command without exposing generated result metadata. */
export async function responseComplete(request: PromiseLike<unknown>): Promise<void> {
  await request;
}

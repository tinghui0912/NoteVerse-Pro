import { createClient } from "../generated/api/client";
import type { ControlPlaneErrorResponse } from "../generated/api/types.gen";
import { OPERATOR_CSRF_COOKIE_NAME, OPERATOR_CSRF_HEADER_NAME } from "../generated/browser-protocol";

export class ControlPlaneRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly requestId?: string) {
    super("Control Plane request failed.");
    this.name = "ControlPlaneRequestError";
  }
}

function isControlPlaneError(value: unknown): value is ControlPlaneErrorResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 2 &&
    typeof record.code === "string" && record.code.length > 0 && record.code.length <= 128 &&
    typeof record.request_id === "string" && record.request_id.length > 0 && record.request_id.length <= 128;
}

function csrfToken(): string | undefined {
  if (typeof document === "undefined") return;
  const entry = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith(`${OPERATOR_CSRF_COOKIE_NAME}=`));
  if (!entry) return;
  try { return decodeURIComponent(entry.slice(OPERATOR_CSRF_COOKIE_NAME.length + 1)); }
  catch { return; }
}

export function createControlPlaneBrowserClient() {
  const client = createClient({
    baseUrl: typeof window === "undefined" ? "" : window.location.origin,
    credentials: "same-origin",
    fetch: request => globalThis.fetch(request),
  });
  client.interceptors.request.use(request => {
    if (!["GET", "HEAD", "OPTIONS", "TRACE"].includes(request.method.toUpperCase())) {
      const token = csrfToken();
      if (token) request.headers.set(OPERATOR_CSRF_HEADER_NAME, token);
    }
    return request;
  });
  client.interceptors.error.use((error, response) => {
    if (error instanceof DOMException && error.name === "AbortError") return error;
    const status = response?.status ?? 0;
    return isControlPlaneError(error)
      ? new ControlPlaneRequestError(status, error.code, error.request_id)
      : new ControlPlaneRequestError(status, status ? "internal_error" : "unknown_error");
  });
  return client;
}

export const controlPlaneBrowserClient = createControlPlaneBrowserClient();

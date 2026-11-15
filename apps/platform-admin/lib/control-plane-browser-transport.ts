import { createClient } from "../generated/api/client";
import type { ControlPlaneErrorResponse } from "../generated/api/types.gen";
import { ControlPlaneErrorResponseSchema } from "../generated/api/schemas.gen";
import { OPERATOR_CSRF_COOKIE_NAME, OPERATOR_CSRF_HEADER_NAME } from "../generated/browser-protocol";

const requestFailureMessage = "Control Plane request failed.";

export class ControlPlaneApplicationError extends Error {
  readonly kind = "application";

  constructor(
    public readonly status: number,
    public readonly code: ControlPlaneErrorResponse["code"],
    public readonly requestId: ControlPlaneErrorResponse["request_id"],
  ) {
    super(requestFailureMessage);
    this.name = "ControlPlaneApplicationError";
  }
}

export class ControlPlaneHttpError extends Error {
  readonly kind = "http";
  declare readonly requestId?: string;

  constructor(public readonly status: number, requestId?: string) {
    super(requestFailureMessage);
    this.name = "ControlPlaneHttpError";
    if (requestId !== undefined) this.requestId = requestId;
  }
}

export class ControlPlaneNetworkError extends Error {
  readonly kind = "network";

  constructor() {
    super(requestFailureMessage);
    this.name = "ControlPlaneNetworkError";
  }
}

const requestIdSchema = ControlPlaneErrorResponseSchema.properties.request_id;
const requestIdPattern = new RegExp(requestIdSchema.pattern);

function isRequestId(value: unknown): value is ControlPlaneErrorResponse["request_id"] {
  return typeof value === "string" &&
    value.length >= requestIdSchema.minLength && value.length <= requestIdSchema.maxLength &&
    requestIdPattern.exec(value)?.[0] === value;
}

function isControlPlaneError(value: unknown): value is ControlPlaneErrorResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ControlPlaneErrorResponseSchema.required.every(key => Object.hasOwn(record, key)) &&
    Object.keys(record).every(key => Object.hasOwn(ControlPlaneErrorResponseSchema.properties, key)) &&
    typeof record.code === "string" && isRequestId(record.request_id);
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
    if (error instanceof Error && error.name === "AbortError") return error;
    if (!response) return new ControlPlaneNetworkError();
    if (!response.ok && isControlPlaneError(error)) {
      return new ControlPlaneApplicationError(response.status, error.code, error.request_id);
    }
    const correlation = response.headers.get("X-Request-ID");
    return new ControlPlaneHttpError(response.status, isRequestId(correlation) ? correlation : undefined);
  });
  return client;
}

export const controlPlaneBrowserClient = createControlPlaneBrowserClient();

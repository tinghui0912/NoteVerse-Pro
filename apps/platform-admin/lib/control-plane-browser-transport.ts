import { createClient } from "../generated/api/client";
import type { ControlPlaneErrorResponse } from "../generated/api/types.gen";
import {
  ControlPlaneErrorCodeSchema,
  ControlPlaneErrorResponseSchema,
} from "../generated/api/schemas.gen";

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

  constructor(
    public readonly status: number,
    requestId?: string,
  ) {
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

function isRequestId(
  value: unknown,
): value is ControlPlaneErrorResponse["request_id"] {
  return (
    typeof value === "string" &&
    value.length >= requestIdSchema.minLength &&
    value.length <= requestIdSchema.maxLength &&
    requestIdPattern.exec(value)?.[0] === value
  );
}

function isControlPlaneError(
  value: unknown,
): value is ControlPlaneErrorResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    ControlPlaneErrorResponseSchema.required.every((key) =>
      Object.hasOwn(record, key),
    ) &&
    Object.keys(record).every((key) =>
      Object.hasOwn(ControlPlaneErrorResponseSchema.properties, key),
    ) &&
    ControlPlaneErrorCodeSchema.enum.some((code) => code === record.code) &&
    isRequestId(record.request_id)
  );
}

const unauthorizedListeners = new Set<() => void>();
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

export function isUnauthorized(error: unknown): boolean {
  return (
    (error instanceof ControlPlaneApplicationError ||
      error instanceof ControlPlaneHttpError) &&
    error.status === 401
  );
}

export function requestErrorMessage(error: unknown): string {
  if (error instanceof ControlPlaneApplicationError) {
    const messages: Record<ControlPlaneErrorResponse["code"], string> = {
      invalid_credentials:
        "Verification failed. Check your credentials or start a new sign-in.",
      token_invalid_expired: "Your sign-in has expired. Sign in again.",
      no_access: "You do not have permission to perform this action.",
      unauthorized: "You do not have permission to perform this action.",
      auth_failed: "Authentication failed. Sign in again.",
      validation_error: "Check the submitted fields and reason.",
      resource_not_found: "The requested resource is not available.",
      unsupported_media_type: "Submit a supported request format.",
      rate_limit_exceeded: "Too many attempts. Wait before trying again.",
      rate_limit_unavailable:
        "Sign-in protection is temporarily unavailable. Try again shortly.",
      request_origin_invalid: "The request origin is not allowed.",
      unknown_error: "The request could not be completed.",
      internal_error: "The service is temporarily unavailable.",
    };
    return messages[error.code];
  }
  return "The service is temporarily unavailable. Try again.";
}

export function createControlPlaneBrowserClient() {
  const client = createClient({
    baseUrl: typeof window === "undefined" ? "" : window.location.origin,
    credentials: "same-origin",
    fetch: (request) => globalThis.fetch(request),
  });
  client.interceptors.error.use((error, response) => {
    if (error instanceof Error && error.name === "AbortError") return error;
    if (!response) return new ControlPlaneNetworkError();
    if (response.status === 401)
      unauthorizedListeners.forEach((listener) => listener());
    if (!response.ok && isControlPlaneError(error)) {
      return new ControlPlaneApplicationError(
        response.status,
        error.code,
        error.request_id,
      );
    }
    const correlation = response.headers.get("X-Request-ID");
    return new ControlPlaneHttpError(
      response.status,
      isRequestId(correlation) ? correlation : undefined,
    );
  });
  return client;
}

export const controlPlaneBrowserClient = createControlPlaneBrowserClient();

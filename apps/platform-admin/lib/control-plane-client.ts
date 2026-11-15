export type AsyncOperation = {
  operation_id: string;
  kind: string;
  resource_type: string;
  status: "queued" | "dispatched" | "processing" | "retrying" | "succeeded" | "failed" | "superseded";
  attempts: number;
  max_attempts: number | null;
  updated_at: string | null;
  failure: { code: string; stage: string; classification: "transient" | "permanent" | "user_error" | "system_error"; retryable: boolean; detail: string | null } | null;
};

type SuccessResponse<T> = { success: true; data: T };

export type OperationsPage = {
  items: AsyncOperation[];
  limit: number;
  offset: number;
  has_more: boolean;
};

export type CurrentOperator = {
  operator_id: string;
  display_name: string;
  role: string;
};

export class ControlPlaneRequestError extends Error {
  constructor(public readonly status: number) {
    super("Control Plane request failed.");
    this.name = "ControlPlaneRequestError";
  }
}

function requiredCsrfConfig(): { cookieName: string; headerName: string } {
  const cookieName = process.env.NEXT_PUBLIC_CONTROL_PLANE_CSRF_COOKIE_NAME;
  const headerName = process.env.NEXT_PUBLIC_CONTROL_PLANE_CSRF_HEADER_NAME;
  if (!cookieName || !headerName) {
    throw new Error("Control Plane CSRF configuration is required.");
  }
  return { cookieName, headerName };
}

const csrfConfig = requiredCsrfConfig();

function csrfHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  const csrfToken = document.cookie
    .split("; ")
    .map((cookie) => cookie.split("="))
    .find(([name]) => name === csrfConfig.cookieName)?.[1];
  if (csrfToken) {
    headers.set(csrfConfig.headerName, decodeURIComponent(csrfToken));
  }
  return headers;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    ...init,
    headers: init?.method && !["GET", "HEAD", "OPTIONS", "TRACE"].includes(init.method.toUpperCase())
      ? csrfHeaders(init)
      : init?.headers,
  });
  if (!response.ok) {
    throw new ControlPlaneRequestError(response.status);
  }
  const payload = await response.json() as SuccessResponse<T>;
  return payload.data;
}

async function requestPayload<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { credentials: "same-origin" });
  if (!response.ok) {
    throw new ControlPlaneRequestError(response.status);
  }
  return response.json() as Promise<T>;
}

export type OperationFilters = {
  kind?: string;
  status?: AsyncOperation["status"];
  failure_class?: NonNullable<AsyncOperation["failure"]>["classification"];
  resource_type?: string;
  created_after?: string;
  updated_before?: string;
};

export function listAsyncOperations(offset = 0, filters: OperationFilters = {}): Promise<OperationsPage> {
  const query = new URLSearchParams({ limit: "50", offset: String(offset) });
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) query.set(key, value);
  }
  return request<OperationsPage>(`/ops/async-operations?${query}`);
}

export function getCurrentOperator(): Promise<CurrentOperator> {
  return requestPayload<CurrentOperator>("/auth/me");
}

export function signOut(): Promise<unknown> {
  return request<unknown>("/auth/logout", { method: "POST" });
}

export type AsyncOperation = {
  operation_id: string;
  kind: string;
  resource_type: string;
  status: string;
  attempts: number;
  max_attempts: number | null;
  updated_at: string | null;
  diagnostic?: { code: string | null } | null;
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

export function listAsyncOperations(offset = 0): Promise<OperationsPage> {
  return request<OperationsPage>(`/ops/async-operations?limit=50&offset=${offset}`);
}

export function getCurrentOperator(): Promise<CurrentOperator> {
  return requestPayload<CurrentOperator>("/auth/me");
}

export function signOut(): Promise<unknown> {
  return request<unknown>("/auth/logout", { method: "POST" });
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const csrfCookieName = "noteverse_operator_csrf";
const csrfHeaderName = "x-operator-csrf-token";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function loadClient() {
  vi.resetModules();
  process.env.NEXT_PUBLIC_CONTROL_PLANE_CSRF_COOKIE_NAME = csrfCookieName;
  process.env.NEXT_PUBLIC_CONTROL_PLANE_CSRF_HEADER_NAME = csrfHeaderName;

  return import("./control-plane-client");
}

describe("Control Plane client", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { cookie: `${csrfCookieName}=csrf-token` },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_CONTROL_PLANE_CSRF_COOKIE_NAME;
    delete process.env.NEXT_PUBLIC_CONTROL_PLANE_CSRF_HEADER_NAME;
  });

  it("lists asynchronous operations through the same-origin proxy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      data: { items: [], limit: 50, offset: 50, has_more: false },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { listAsyncOperations } = await loadClient();

    await expect(listAsyncOperations(50)).resolves.toEqual({
      items: [],
      limit: 50,
      offset: 50,
      has_more: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/ops/async-operations?limit=50&offset=50",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("adds the operator CSRF token to sign-out requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: null }));
    vi.stubGlobal("fetch", fetchMock);

    const { signOut } = await loadClient();

    await signOut();

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.method).toBe("POST");
    expect(request.credentials).toBe("same-origin");
    expect(new Headers(request.headers).get(csrfHeaderName)).toBe("csrf-token");
  });

  it("exposes only an HTTP status for failed control-plane requests", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("internal detail", { status: 503 })));
    const { ControlPlaneRequestError, getCurrentOperator } = await loadClient();

    await expect(getCurrentOperator()).rejects.toEqual(expect.objectContaining({
      status: 503,
      name: ControlPlaneRequestError.name,
    }));
  });
});

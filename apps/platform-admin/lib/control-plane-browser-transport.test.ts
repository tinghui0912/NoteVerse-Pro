import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { OPERATOR_CSRF_COOKIE_NAME, OPERATOR_CSRF_HEADER_NAME } from "../generated/browser-protocol";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("window", { location: { origin: "http://control.test" } });
  vi.stubGlobal("document", { cookie: `${OPERATOR_CSRF_COOKIE_NAME}=exact%20token` });
});
afterEach(() => vi.unstubAllGlobals());

it("returns a generated direct page with same-origin credentials and generated filters", async () => {
  const page = { items: [], limit: 50, offset: 50, has_more: false };
  const fetch = vi.fn().mockResolvedValue(json(page));
  vi.stubGlobal("fetch", fetch);
  const api = await import("./control-plane-api");
  await expect(api.listAsyncOperations({ limit: 50, offset: 50, status: "retrying", failure_class: "system_error" })).resolves.toEqual(page);
  const request = fetch.mock.calls[0][0] as Request;
  expect(request.credentials).toBe("same-origin");
  expect(request.method).toBe("GET");
  expect(new URL(request.url).origin).toBe(window.location.origin);
  expect(new URL(request.url).searchParams.get("failure_class")).toBe("system_error");
  expect(request.headers.has(OPERATOR_CSRF_HEADER_NAME)).toBe(false);
});

it("login uses the generated JSON command and accepts a bodyless 204 without a CSRF cookie", async () => {
  document.cookie = "";
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const api = await import("./control-plane-api");
  await expect(api.login({ username: "operator", password: "password" })).resolves.toBeUndefined();
  const request = fetch.mock.calls[0][0] as Request;
  expect(request.method).toBe("POST");
  expect(await request.json()).toEqual({ username: "operator", password: "password" });
  expect(request.headers.has(OPERATOR_CSRF_HEADER_NAME)).toBe(false);
});

it("logout and retry inject the generated CSRF identity through authenticated transport", async () => {
  const take = { operation_id: "operation", status: "queued" };
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(json(take));
  vi.stubGlobal("fetch", fetch);
  const api = await import("./control-plane-api");
  await api.logout();
  await expect(api.retryAsyncOperation({ kind: "render", operation_id: "operation" }, { reason: "Provider recovered" })).resolves.toEqual(take);
  for (const [request] of fetch.mock.calls as [Request][]) {
    expect(request.credentials).toBe("same-origin");
    expect(request.headers.get(OPERATOR_CSRF_HEADER_NAME)).toBe("exact token");
  }
});

it("current operator, summary and audit return generated representations", async () => {
  const representations = [{ operator_id: "id", display_name: "Operator", role: "platform_operator" }, { total: 0, kinds: [], statuses: [] }, { items: [], limit: 100, offset: 0, has_more: false }];
  const fetch = vi.fn();
  for (const representation of representations) fetch.mockResolvedValueOnce(json(representation));
  vi.stubGlobal("fetch", fetch);
  const api = await import("./control-plane-api");
  expect(await api.currentOperator()).toEqual(representations[0]);
  expect(await api.asyncOperationsSummary()).toEqual(representations[1]);
  expect(await api.listOpsAuditEvents()).toEqual(representations[2]);
});

it("normalizes typed errors with server correlation and leaves 401 to the caller", async () => {
  const fetch = vi.fn().mockResolvedValue(json({ code: "token_invalid_expired", request_id: "server-request" }, 401));
  vi.stubGlobal("fetch", fetch);
  const api = await import("./control-plane-api");
  await expect(api.currentOperator()).rejects.toMatchObject({ status: 401, code: "token_invalid_expired", requestId: "server-request" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([new Response("<html>private proxy detail</html>", { status: 502 }), json({ detail: "private traceback", code: "x", request_id: "untrusted" }, 500), json({ code: "x".repeat(5000), request_id: "request" }, 500)])("bounds malformed and proxy failures without inventing correlation", async response => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  const api = await import("./control-plane-api");
  await expect(api.currentOperator()).rejects.toMatchObject({ code: "internal_error", requestId: undefined, message: "Control Plane request failed." });
});

it("normalizes network failure without replaying a request", async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError("private network detail"));
  vi.stubGlobal("fetch", fetch);
  const api = await import("./control-plane-api");
  await expect(api.currentOperator()).rejects.toMatchObject({ status: 0, code: "unknown_error", requestId: undefined });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("propagates cancellation", async () => {
  const error = new DOMException("Cancelled", "AbortError");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
  const api = await import("./control-plane-api");
  await expect(api.currentOperator()).rejects.toBe(error);
});

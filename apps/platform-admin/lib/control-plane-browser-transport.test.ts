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

it.each([
  { code: "token_invalid_expired", request_id: "server-request" },
])("preserves canonical application failure facts from the server", async body => {
  const fetch = vi.fn().mockResolvedValue(json(body, 401));
  vi.stubGlobal("fetch", fetch);
  const api = await import("./control-plane-api");
  await expect(api.currentOperator()).rejects.toMatchObject({ kind: "application", status: 401, code: body.code, requestId: body.request_id });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([
  () => json({ code: "", request_id: "a" }, 401),
  () => json({ code: "server_code", request_id: "a" }, 401),
  () => json({ code: "server_code".repeat(500), request_id: "a".repeat(128) }, 401),
  () => json({ code: "validation_error", request_id: "_invalid" }, 422),
  () => json({ code: "validation_error", request_id: "a", private: "secret" }, 422),
  () => new Response("<html>private proxy detail</html>", { status: 502 }),
  () => new Response("{invalid private JSON", { status: 503, headers: { "content-type": "application/json" } }),
  () => json({ detail: "private traceback", code: "server_code", request_id: "forged-body-correlation" }, 500),
  () => json({ code: "server_code", request_id: "" }, 500),
  () => json({ code: "server_code", request_id: "_invalid" }, 500),
  () => json({ code: "server_code", request_id: "a".repeat(129) }, 500),
  () => json({ code: "server_code", request_id: "request\n" }, 500),
  () => json({ code: 42, request_id: "forged-body-correlation" }, 500),
  () => json({ request_id: "forged-body-correlation" }, 500),
])("classifies a noncanonical HTTP response without application facts or body disclosure", async response => {
  const result = response();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(result));
  const api = await import("./control-plane-api");
  const error = await api.currentOperator().catch(error => error);
  expect(error).toMatchObject({ kind: "http", status: result.status, message: "Control Plane request failed." });
  expect(error).not.toHaveProperty("code");
  expect(error).not.toHaveProperty("requestId");
  expect(error.message).not.toContain("private");
});

it("retains validated response-header correlation for a noncanonical HTTP failure", async () => {
  const response = json({ code: "server_code", request_id: "forged-body", private: "detail" }, 502);
  response.headers.set("X-Request-ID", "ingress-request.1:_-token");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  const api = await import("./control-plane-api");
  const error = await api.currentOperator().catch(error => error);
  expect(error).toMatchObject({ kind: "http", status: 502, requestId: "ingress-request.1:_-token" });
  expect(error).not.toHaveProperty("code");
});

it.each(["bad value", "_invalid", "a".repeat(129)])("accepts only ingress-valid response-header correlation", async requestId => {
  const response = new Response("private proxy body", { status: 502, headers: { "X-Request-ID": requestId } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  const api = await import("./control-plane-api");
  const error = await api.currentOperator().catch(error => error);
  expect(error).toMatchObject({ kind: "http", status: 502 });
  expect(error).not.toHaveProperty("requestId");
  expect(error).not.toHaveProperty("code");
});

it.each([new TypeError("private network detail"), { code: "forged_network_code", request_id: "forged-correlation" }])("classifies failure before an HTTP response as network failure without replay", async cause => {
  const fetch = vi.fn().mockRejectedValue(cause);
  vi.stubGlobal("fetch", fetch);
  const api = await import("./control-plane-api");
  const error = await api.currentOperator().catch(error => error);
  expect(error).toMatchObject({ kind: "network", message: "Control Plane request failed." });
  for (const property of ["status", "code", "requestId"]) expect(error).not.toHaveProperty(property);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([new DOMException("Cancelled", "AbortError"), Object.assign(new Error("Cancelled"), { name: "AbortError" })])("propagates the exact cancellation error", async error => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
  const api = await import("./control-plane-api");
  await expect(api.currentOperator()).rejects.toBe(error);
});

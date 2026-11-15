// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControlPlaneApplicationError, ControlPlaneHttpError, ControlPlaneNetworkError } from "../../lib/control-plane-browser-transport";
const { api, router } = vi.hoisted(() => ({ api: { currentOperator: vi.fn(), listAsyncOperations: vi.fn(), logout: vi.fn() }, router: { replace: vi.fn() } }));
vi.mock("../../lib/control-plane-api", () => api);
vi.mock("next/navigation", () => ({ useRouter: () => router }));
import OperationsPage from "./page";
import type { AsyncOperationRead } from "../../generated/api/types.gen";
const operation: AsyncOperationRead = { operation_id: "operation", kind: "render", resource_type: "score_revision", resource_id: "operation", status: "retrying", attempts: 1, max_attempts: 3, next_attempt_at: null, created_at: null, updated_at: null, failure: { code: "render_execution_failed", stage: "render", classification: "system_error", retryable: true, detail: null } };
beforeEach(() => {
  vi.clearAllMocks();
  api.currentOperator.mockResolvedValue({ operator_id: "id", display_name: "Operator", role: "platform_operator" });
  api.listAsyncOperations.mockResolvedValue({ items: [operation], limit: 50, offset: 0, has_more: true });
  api.logout.mockResolvedValue(undefined);
});
afterEach(cleanup);
it("renders the generated operation representation and requests the next page", async () => {
  render(<OperationsPage />);
  await screen.findByText("render_execution_failed");
  expect(api.listAsyncOperations).toHaveBeenCalledWith({ limit: 50, offset: 0 });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(api.listAsyncOperations).toHaveBeenCalledWith({ limit: 50, offset: 50 }));
});
it.each([new ControlPlaneApplicationError(401, "token_invalid_expired", "server-request"), new ControlPlaneHttpError(401)])("hands authentication failure to login navigation", async error => {
  api.currentOperator.mockRejectedValue(error);
  render(<OperationsPage />);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
});
it.each([new ControlPlaneApplicationError(403, "no_access", "server-request"), new ControlPlaneHttpError(502), new ControlPlaneNetworkError()])("presents unavailability for other request failures", async error => {
  api.currentOperator.mockRejectedValue(error);
  render(<OperationsPage />);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Operations are temporarily unavailable."));
  expect(router.replace).not.toHaveBeenCalled();
});
it("logs out through the operation adapter", async () => {
  render(<OperationsPage />);
  await screen.findByText("render_execution_failed");
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
  expect(api.logout).toHaveBeenCalledOnce();
});

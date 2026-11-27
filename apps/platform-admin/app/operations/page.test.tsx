// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControlPlaneApplicationError, ControlPlaneHttpError, ControlPlaneNetworkError } from "../../lib/control-plane-browser-transport";
const { api, router } = vi.hoisted(() => ({ api: { currentOperator: vi.fn(), listAsyncOperations: vi.fn(), logout: vi.fn(), retryAsyncOperation: vi.fn() }, router: { replace: vi.fn() } }));
vi.mock("../../lib/control-plane-api", () => api);
vi.mock("next/navigation", () => ({ useRouter: () => router }));
import OperationsPage from "./page";
import type { AsyncOperationRead } from "../../generated/api/types.gen";
const operation: AsyncOperationRead = { operation_id: "operation", kind: "revision_render", resource_type: "score_revision", resource_id: "operation", status: "retrying", attempts: 1, max_attempts: 3, next_attempt_at: null, created_at: null, updated_at: null, failure: { code: "render_execution_failed", stage: "render", classification: "system_error", retryable: true, detail: null } };
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

it("shows account erasure diagnostics and requires a reason before audited retry", async () => {
  const erasure: AsyncOperationRead = {...operation, kind: "account_deletion", resource_type: "account_erasure", operation_id: "erase-account", status: "failed", can_retry: true, attempts: 5, max_attempts: 5, failure: {code: "account_deletion_integrity_violation", stage: "takes", classification: "permanent", retryable: false, detail: "Repair the recorded invariant."}};
  api.listAsyncOperations.mockResolvedValueOnce({items: [erasure], has_more: false});
  api.listAsyncOperations.mockResolvedValue({items: [{...erasure, status: "queued", can_retry: false, failure: null}], has_more: false});
  api.retryAsyncOperation.mockResolvedValue({...erasure, status: "queued"});
  render(<OperationsPage />);
  await screen.findByText("account_deletion_integrity_violation");
  expect(screen.getByText("takes")).toBeTruthy();
  expect(screen.getByText("permanent")).toBeTruthy();
  expect(screen.getByText("Repair the recorded invariant.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name: "Retry"}));
  const confirm = screen.getByRole("button", {name: "Confirm retry"}) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Recovery reason"), {target: {value: "Repaired the invariant"}});
  fireEvent.click(confirm);
  await waitFor(() => expect(api.retryAsyncOperation).toHaveBeenCalledWith({kind: "account_deletion", operation_id: "erase-account"}, {reason: "Repaired the invariant"}));
  await screen.findByText("queued");
  expect(api.listAsyncOperations).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("button", {name: "Retry"})).toBeNull();
});
it("renders cancelled retirement without offering reactivation", async () => {
  api.listAsyncOperations.mockResolvedValue({items: [{...operation, kind: "stored_object_retirement", resource_type: "stored_object", status: "cancelled", can_retry: false, failure: null}], has_more: false});
  render(<OperationsPage />);
  await screen.findByText("cancelled");
  expect(screen.getByText("stored_object_retirement")).toBeTruthy();
  expect(screen.queryByRole("button", {name: "Retry"})).toBeNull();
});
it("keeps a rejected operator retry visible with a safe error", async () => {
  api.listAsyncOperations.mockResolvedValue({items: [{...operation, can_retry: true}], has_more: false});
  api.retryAsyncOperation.mockRejectedValue(new ControlPlaneHttpError(409));
  render(<OperationsPage />);
  await screen.findByText("render_execution_failed");
  fireEvent.click(screen.getByRole("button", {name: "Retry"}));
  fireEvent.change(screen.getByLabelText("Recovery reason"), {target: {value: "Verified repair"}});
  fireEvent.click(screen.getByRole("button", {name: "Confirm retry"}));
  await screen.findByRole("alert");
  expect(screen.getByRole("form", {name: "Operator recovery"})).toBeTruthy();
});

it("shows the saved erasure execution stage while work is queued", async () => {
  api.listAsyncOperations.mockResolvedValue({items: [{...operation, kind: "account_deletion", status: "queued", execution_stage: "takes", failure: null, can_retry: false}], has_more: false});
  render(<OperationsPage />);
  await screen.findByText("takes");
  expect(screen.getByText("Execution stage")).toBeTruthy();
  expect(screen.getByText("queued")).toBeTruthy();
});

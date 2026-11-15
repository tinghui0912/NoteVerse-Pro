// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControlPlaneApplicationError, ControlPlaneHttpError, ControlPlaneNetworkError } from "../../lib/control-plane-browser-transport";
const { login, router } = vi.hoisted(() => ({ login: vi.fn(), router: { replace: vi.fn() } }));
vi.mock("../../lib/control-plane-api", () => ({ login }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
import LoginPage from "./page";
beforeEach(() => { login.mockReset(); router.replace.mockReset(); });
afterEach(cleanup);
function submit() {
  render(<LoginPage />);
  fireEvent.change(screen.getByLabelText("Operator username"), { target: { value: "operator" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password" } });
  fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);
}
it("submits the operator command and navigates after acknowledgement", async () => {
  login.mockResolvedValue(undefined);
  submit();
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/operations"));
  expect(login).toHaveBeenCalledWith({ username: "operator", password: "password" });
});
it.each([401, 403, 422])("presents credential copy for a canonical %s application failure", async status => {
  login.mockRejectedValue(new ControlPlaneApplicationError(status, "server_code", "server-request"));
  submit();
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Sign-in failed. Check your operator credentials."));
  expect(router.replace).not.toHaveBeenCalled();
});
it.each([new ControlPlaneHttpError(401), new ControlPlaneHttpError(503), new ControlPlaneNetworkError()])("presents temporary unavailability for transport failure", async error => {
  login.mockRejectedValue(error);
  submit();
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Sign-in is temporarily unavailable."));
  expect(router.replace).not.toHaveBeenCalled();
});

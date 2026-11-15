// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControlPlaneRequestError } from "../../lib/control-plane-browser-transport";
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
it.each([[401, "Sign-in failed. Check your operator credentials."], [0, "Sign-in is temporarily unavailable."]])("presents local copy for a %s failure", async (status, copy) => {
  login.mockRejectedValue(new ControlPlaneRequestError(status, "auth_failed"));
  submit();
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(copy));
  expect(router.replace).not.toHaveBeenCalled();
});

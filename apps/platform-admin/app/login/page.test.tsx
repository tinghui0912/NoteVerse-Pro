// @vitest-environment jsdom
import { StrictMode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ControlPlaneApplicationError,
  ControlPlaneHttpError,
} from "../../lib/control-plane-browser-transport";
import { AdminSessionProvider } from "../../components/admin-session";
import { operatorFor } from "../../tests/support";
const { api, router } = vi.hoisted(() => ({
  api: {
    login: vi.fn(),
    currentOperator: vi.fn(),
    startMfaEnrollment: vi.fn(),
    confirmMfaEnrollment: vi.fn(),
    verifyMfa: vi.fn(),
  },
  router: { replace: vi.fn() },
}));
vi.mock("../../lib/control-plane-api", () => api);
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/login",
}));
import LoginPage from "./page";
const secret = "JBSWY3DPEHPK3PXP";
const codes = Array.from(
  { length: 10 },
  (_, i) => `${String(i).padStart(5, "0")}-ABCDE-12345-67890`,
);
const challenge = (purpose = "ENROLLMENT_REQUIRED") => ({
  purpose,
  expires_at: new Date(Date.now() + 300000).toISOString(),
});
beforeEach(() => {
  vi.resetAllMocks();
  api.currentOperator.mockRejectedValue(new ControlPlaneHttpError(401));
  api.login.mockResolvedValue(challenge());
  api.startMfaEnrollment.mockResolvedValue({
    secret,
    otpauth_uri: `otpauth://totp/NoteVerse%20Admin:admin@example.com?secret=${secret}&issuer=NoteVerse%20Admin`,
  });
  api.confirmMfaEnrollment.mockResolvedValue({
    operator: operatorFor(),
    recovery_codes: codes,
  });
  api.verifyMfa.mockResolvedValue({
    operator: operatorFor(),
    recovery_codes_remaining: 8,
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function mount() {
  return render(
    <StrictMode>
      <AdminSessionProvider>
        <LoginPage />
      </AdminSessionProvider>
    </StrictMode>,
  );
}
async function passwordLogin() {
  mount();
  await screen.findByLabelText("Operator email");
  fireEvent.change(screen.getByLabelText("Operator email"), {
    target: { value: "admin@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "a-long-operator-password" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Continue" }).closest("form")!,
  );
}
function submitCode(code = "123456") {
  fireEvent.change(screen.getByLabelText("Authenticator code"), {
    target: { value: code },
  });
  fireEvent.submit(
    screen
      .getByRole("button", { name: /Confirm enrollment|Verify and sign in/ })
      .closest("form")!,
  );
}
it("enrolls once in Strict Mode with a local SVG and requires recovery acknowledgment before entering the console", async () => {
  const local = vi.spyOn(Storage.prototype, "setItem");
  await passwordLogin();
  await screen.findByRole("img", { name: "Authenticator enrollment QR code" });
  expect(api.login).toHaveBeenCalledExactlyOnceWith({
    email: "admin@example.com",
    password: "a-long-operator-password",
  });
  expect(api.startMfaEnrollment).toHaveBeenCalledOnce();
  expect(
    document.querySelector("svg path")?.getAttribute("d")?.length,
  ).toBeGreaterThan(100);
  expect(
    document.querySelector('img[src^="http"], image[href^="http"]'),
  ).toBeNull();
  expect(
    (screen.getByLabelText("Manual setup key") as HTMLInputElement).value,
  ).toBe(secret);
  fireEvent.click(screen.getByRole("button", { name: "Copy manual key" }));
  await waitFor(() =>
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(secret),
  );
  submitCode();
  await screen.findByRole("heading", { name: "Save your recovery codes" });
  expect(api.confirmMfaEnrollment).toHaveBeenCalledExactlyOnceWith({
    code: "123456",
  });
  for (const code of codes) expect(screen.getByText(code)).toBeTruthy();
  expect(screen.queryByLabelText("Manual setup key")).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Enter console" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(router.replace).not.toHaveBeenCalledWith("/operations");
  fireEvent.click(screen.getByRole("button", { name: "Copy recovery codes" }));
  await waitFor(() =>
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      codes.join("\n"),
    ),
  );
  fireEvent.click(
    screen.getByLabelText("I have stored these recovery codes securely."),
  );
  fireEvent.click(screen.getByRole("button", { name: "Enter console" }));
  await waitFor(() =>
    expect(router.replace).toHaveBeenCalledWith("/operations"),
  );
  for (const code of codes) expect(screen.queryByText(code)).toBeNull();
  expect(local).not.toHaveBeenCalled();
  local.mockRestore();
});
it("exports recovery codes only on explicit download and revokes the transient object URL", async () => {
  const create = vi.fn().mockReturnValue("blob:local-codes");
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  await passwordLogin();
  await screen.findByLabelText("Manual setup key");
  submitCode();
  await screen.findByText(codes[0]);
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Download .txt" }));
  expect(create).toHaveBeenCalledOnce();
  expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
  expect(click).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledWith("blob:local-codes");
  click.mockRestore();
});
it.each([false, true])(
  "verifies exactly one code variant (recovery=%s)",
  async (recovery) => {
    api.login.mockResolvedValue(challenge("VERIFICATION_REQUIRED"));
    await passwordLogin();
    await screen.findByRole("heading", { name: "Verify your identity" });
    if (recovery) {
      fireEvent.click(screen.getByRole("button", { name: "Recovery code" }));
      fireEvent.change(screen.getByLabelText("One-time recovery code"), {
        target: { value: codes[0] },
      });
      fireEvent.submit(
        screen
          .getByRole("button", { name: "Verify and sign in" })
          .closest("form")!,
      );
    } else submitCode();
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/operations"),
    );
    expect(api.verifyMfa).toHaveBeenCalledExactlyOnceWith(
      recovery ? { recovery_code: codes[0] } : { code: "123456" },
    );
    expect(api.startMfaEnrollment).not.toHaveBeenCalled();
  },
);
it("returns to password login after five unsuccessful verification attempts", async () => {
  api.login.mockResolvedValue(challenge("VERIFICATION_REQUIRED"));
  api.verifyMfa.mockRejectedValue(
    new ControlPlaneApplicationError(401, "invalid_credentials", "request"),
  );
  await passwordLogin();
  await screen.findByRole("heading", { name: "Verify your identity" });
  for (let i = 0; i < 5; i++) {
    submitCode();
    await waitFor(() => expect(api.verifyMfa).toHaveBeenCalledTimes(i + 1));
    if (i < 4)
      await waitFor(() =>
        expect(
          (
            screen.getByRole("button", {
              name: "Verify and sign in",
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(false),
      );
  }
  await screen.findByLabelText("Operator email");
  expect(screen.getByRole("alert").textContent).toContain(
    "expired or reached its attempt limit",
  );
});
it("expires a challenge without another verification request", async () => {
  vi.useFakeTimers();
  mount();
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Operator email"), {
    target: { value: "admin@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "a-long-operator-password" },
  });
  await act(async () => {
    fireEvent.submit(
      screen.getByRole("button", { name: "Continue" }).closest("form")!,
    );
  });
  await act(async () => {
    vi.advanceTimersByTime(300001);
  });
  expect(screen.getByLabelText("Operator email")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("challenge expired");
  expect(api.confirmMfaEnrollment).not.toHaveBeenCalled();
});
it("clears enrollment secrets when restarting sign-in", async () => {
  await passwordLogin();
  await screen.findByLabelText("Manual setup key");
  fireEvent.click(screen.getByRole("button", { name: "Restart sign-in" }));
  expect(screen.queryByLabelText("Manual setup key")).toBeNull();
  expect(screen.queryByRole("img")).toBeNull();
});
it("shows a bounded credential error for failed password verification", async () => {
  api.login.mockRejectedValue(
    new ControlPlaneApplicationError(401, "invalid_credentials", "request"),
  );
  await passwordLogin();
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain(
    "Verification failed",
  );
  expect(api.startMfaEnrollment).not.toHaveBeenCalled();
  expect(api.verifyMfa).not.toHaveBeenCalled();
});
it("preserves enrollment state when clipboard access is denied", async () => {
  vi.mocked(navigator.clipboard.writeText).mockRejectedValue(
    new Error("denied"),
  );
  await passwordLogin();
  await screen.findByLabelText("Manual setup key");
  fireEvent.click(screen.getByRole("button", { name: "Copy manual key" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Select and copy",
  );
  expect(screen.getByLabelText("Manual setup key")).toBeTruthy();
});

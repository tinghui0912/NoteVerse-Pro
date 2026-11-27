// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { ControlPlaneApplicationError } from "../lib/control-plane-browser-transport";
import { renderConsole, operatorFor, installDialog } from "./support";
const { api, router } = vi.hoisted(() => ({
  api: {
    currentOperator: vi.fn(),
    listOperators: vi.fn(),
    createOperator: vi.fn(),
    updateOperator: vi.fn(),
    resetOperatorMfa: vi.fn(),
    resetOperatorPassword: vi.fn(),
    listUsers: vi.fn(),
    updateUserStatus: vi.fn(),
    listAuditLogs: vi.fn(),
    logout: vi.fn(),
  },
  router: { replace: vi.fn() },
}));
vi.mock("../lib/control-plane-api", () => api);
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/operators",
}));
import OperatorsPage from "../app/(console)/operators/page";
import UsersPage from "../app/(console)/users/page";
import AuditLogsPage from "../app/(console)/audit-logs/page";
const other = {
  ...operatorFor("PLATFORM_OPERATOR"),
  operator_id: "00000000-0000-0000-0000-000000000002",
  display_name: "Other",
  email: "other@example.com",
};
const page = (items: unknown[], has_more = false) => ({
  items,
  limit: 50,
  offset: 0,
  has_more,
});
beforeEach(() => {
  vi.resetAllMocks();
  installDialog();
  api.currentOperator.mockResolvedValue(operatorFor());
  api.listOperators.mockResolvedValue(page([other]));
  api.listUsers.mockResolvedValue(
    page([
      {
        user_id: 7,
        email: "user@example.com",
        display_name: "User",
        is_active: true,
      },
    ]),
  );
  api.listAuditLogs.mockResolvedValue(
    page(
      [
        {
          event_id: "event",
          actor_operator_id: 3,
          action: "operator.create",
          target_type: "operator",
          target_id: "operator-uuid",
          reason: "Expand support",
          outcome: "succeeded",
          metadata_json: { role: "SUPPORT_READONLY" },
          ip_address: "127.0.0.1",
          user_agent: "Browser",
          created_at: "2026-11-27T10:00:00Z",
          request_id: "request",
          previous_state: null,
          new_state: null,
          error_code: null,
        },
      ],
      true,
    ),
  );
});
afterEach(cleanup);
function reason(value = "  Reviewed access  ") {
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value } });
}
function confirm() {
  fireEvent.submit(
    screen.getByRole("button", { name: "Confirm change" }).closest("form")!,
  );
}
it("creates an operator with normalized password and a trimmed audited reason", async () => {
  api.createOperator.mockResolvedValue(other);
  renderConsole(<OperatorsPage />);
  await screen.findByText(/other@example.com/);
  fireEvent.click(screen.getByRole("button", { name: "Create operator" }));
  expect(
    (
      screen.getByRole("button", {
        name: "Confirm change",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "new@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Display name"), {
    target: { value: "New operator" },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "e\u0301".repeat(12) },
  });
  reason();
  confirm();
  await waitFor(() =>
    expect(api.createOperator).toHaveBeenCalledWith({
      email: "new@example.com",
      display_name: "New operator",
      role: "SUPPORT_READONLY",
      password: "é".repeat(12),
      reason: "Reviewed access",
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.listOperators).toHaveBeenCalledTimes(2);
});
it.each(["short", " ".repeat(12), "x".repeat(129)])(
  "rejects invalid operator creation passwords",
  async (password) => {
    renderConsole(<OperatorsPage />);
    await screen.findByText(/other@example.com/);
    fireEvent.click(screen.getByRole("button", { name: "Create operator" }));
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "New" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: password },
    });
    reason();
    confirm();
    expect(api.createOperator).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Use 12–128 characters; the password must not be blank.",
      ),
    ).toBeTruthy();
  },
);
it("updates operator access and presents a safe last-administrator rejection", async () => {
  api.updateOperator.mockRejectedValue(
    new ControlPlaneApplicationError(409, "no_access", "request"),
  );
  renderConsole(<OperatorsPage />);
  await screen.findByText(/other@example.com/);
  fireEvent.click(screen.getByRole("button", { name: "Edit access" }));
  fireEvent.change(screen.getByLabelText("Role"), {
    target: { value: "SUPPORT_READONLY" },
  });
  fireEvent.change(screen.getByLabelText("Status"), {
    target: { value: "disabled" },
  });
  reason();
  confirm();
  await waitFor(() =>
    expect(api.updateOperator).toHaveBeenCalledWith(
      { operator_id: other.operator_id },
      {
        role: "SUPPORT_READONLY",
        status: "disabled",
        reason: "Reviewed access",
      },
    ),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "last active super administrator",
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
});
it("resets a password only when both reason and password satisfy the shared policy", async () => {
  api.resetOperatorPassword.mockResolvedValue(undefined);
  renderConsole(<OperatorsPage />);
  await screen.findByText(/other@example.com/);
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  reason();
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "short" },
  });
  confirm();
  expect(api.resetOperatorPassword).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "x".repeat(128) },
  });
  confirm();
  await waitFor(() =>
    expect(api.resetOperatorPassword).toHaveBeenCalledWith(
      { operator_id: other.operator_id },
      { password: "x".repeat(128), reason: "Reviewed access" },
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByLabelText("New password")).toBeNull();
});
it("requires explicit confirmation and reason for MFA reset", async () => {
  api.resetOperatorMfa.mockResolvedValue(undefined);
  renderConsole(<OperatorsPage />);
  await screen.findByText(/other@example.com/);
  fireEvent.click(screen.getByRole("button", { name: "Reset MFA" }));
  expect(screen.getByRole("dialog").textContent).toContain(
    "active sessions and pending sign-ins will be revoked",
  );
  confirm();
  expect(api.resetOperatorMfa).not.toHaveBeenCalled();
  reason();
  confirm();
  await waitFor(() =>
    expect(api.resetOperatorMfa).toHaveBeenCalledWith(
      { operator_id: other.operator_id },
      { reason: "Reviewed access" },
    ),
  );
});
it("clears the console identity when an operator resets their own MFA", async () => {
  api.listOperators.mockResolvedValue(page([operatorFor()]));
  api.resetOperatorMfa.mockResolvedValue(undefined);
  renderConsole(<OperatorsPage />);
  await screen.findByText(/admin@example.com/);
  fireEvent.click(screen.getByRole("button", { name: "Reset MFA" }));
  reason();
  confirm();
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
  expect(screen.queryByRole("navigation")).toBeNull();
});
it.each(["SUPPORT_READONLY", "PLATFORM_OPERATOR", "SUPER_ADMIN"] as const)(
  "gates navigation and management for %s",
  async (role) => {
    api.currentOperator.mockResolvedValue(operatorFor(role));
    renderConsole(<OperatorsPage />);
    await screen.findByRole("navigation");
    expect(screen.getByRole("link", { name: "Operations" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Users" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Audit logs" })).toBeTruthy();
    if (role === "SUPER_ADMIN") {
      expect(screen.getByRole("link", { name: "Operators" })).toBeTruthy();
      await screen.findByRole("button", { name: "Create operator" });
    } else {
      expect(screen.queryByRole("link", { name: "Operators" })).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Create operator" }),
      ).toBeNull();
      expect(api.listOperators).not.toHaveBeenCalled();
      expect(screen.getByText("Access restricted")).toBeTruthy();
    }
  },
);
it.each(["SUPPORT_READONLY", "PLATFORM_OPERATOR", "SUPER_ADMIN"] as const)(
  "gates user status controls for %s",
  async (role) => {
    api.currentOperator.mockResolvedValue(operatorFor(role));
    renderConsole(<UsersPage />);
    await screen.findByRole("cell", { name: "user@example.com" });
    expect(!!screen.queryByRole("button", { name: "Suspend" })).toBe(
      role === "SUPER_ADMIN",
    );
  },
);
it.each([true, false])(
  "mutates user status (active=%s) with reason and refreshes results",
  async (active) => {
    api.listUsers.mockResolvedValue(
      page([
        {
          user_id: 7,
          email: "user@example.com",
          display_name: "User",
          is_active: active,
        },
      ]),
    );
    api.updateUserStatus.mockResolvedValue(undefined);
    renderConsole(<UsersPage />);
    await screen.findByRole("cell", { name: "user@example.com" });
    fireEvent.click(
      screen.getByRole("button", { name: active ? "Suspend" : "Reactivate" }),
    );
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Confirm status change" })
        .closest("form")!,
    );
    expect(api.updateUserStatus).not.toHaveBeenCalled();
    reason();
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Confirm status change" })
        .closest("form")!,
    );
    await waitFor(() =>
      expect(api.updateUserStatus).toHaveBeenCalledWith(
        { user_id: 7 },
        { is_active: !active, reason: "Reviewed access" },
      ),
    );
    await waitFor(() => expect(api.listUsers).toHaveBeenCalledTimes(2));
  },
);
it.each(["ab", "   ", "x".repeat(501)])(
  "rejects invalid reasons on operator and user commands",
  async (value) => {
    const mounted = renderConsole(<OperatorsPage />);
    await screen.findByText(/other@example.com/);
    fireEvent.click(screen.getByRole("button", { name: "Reset MFA" }));
    reason(value);
    confirm();
    expect(api.resetOperatorMfa).not.toHaveBeenCalled();
    mounted.unmount();
    renderConsole(<UsersPage />);
    await screen.findByRole("cell", { name: "user@example.com" });
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    reason(value);
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Confirm status change" })
        .closest("form")!,
    );
    expect(api.updateUserStatus).not.toHaveBeenCalled();
  },
);
it("renders audit evidence, submits exact supported filters and paginates", async () => {
  renderConsole(<AuditLogsPage />);
  await screen.findByText("operator.create");
  const filters = screen.getByRole("form", { name: "Audit filters" });
  fireEvent.change(within(filters).getByLabelText("Actor operator ID"), {
    target: { value: "3" },
  });
  fireEvent.change(within(filters).getByLabelText("Action"), {
    target: { value: "operator.create" },
  });
  fireEvent.change(within(filters).getByLabelText("Target type"), {
    target: { value: "operator" },
  });
  fireEvent.change(within(filters).getByLabelText("Target ID"), {
    target: { value: "operator-uuid" },
  });
  fireEvent.change(within(filters).getByLabelText("Outcome"), {
    target: { value: "succeeded" },
  });
  fireEvent.change(within(filters).getByLabelText("Created after"), {
    target: { value: "2026-11-01T12:00" },
  });
  fireEvent.change(within(filters).getByLabelText("Created before"), {
    target: { value: "2026-11-27T12:00" },
  });
  fireEvent.submit(filters);
  const expected = {
    actor_operator_id: 3,
    action: "operator.create",
    target_type: "operator",
    target_id: "operator-uuid",
    outcome: "succeeded",
    created_after: new Date("2026-11-01T12:00").toISOString(),
    created_before: new Date("2026-11-27T12:00").toISOString(),
    limit: 50,
    offset: 0,
  };
  await waitFor(() =>
    expect(api.listAuditLogs).toHaveBeenLastCalledWith(expected),
  );
  await screen.findByText("Expand support");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() =>
    expect(api.listAuditLogs).toHaveBeenLastCalledWith({
      ...expected,
      offset: 50,
    }),
  );
});
it("rejects inverted audit time filters without making another request", async () => {
  renderConsole(<AuditLogsPage />);
  await screen.findByText("operator.create");
  const form = screen.getByRole("form", { name: "Audit filters" });
  fireEvent.change(screen.getByLabelText("Created after"), {
    target: { value: "2026-11-27T12:00" },
  });
  fireEvent.change(screen.getByLabelText("Created before"), {
    target: { value: "2026-11-01T12:00" },
  });
  fireEvent.submit(form);
  expect(screen.getByRole("alert").textContent).toContain("start time");
  expect(api.listAuditLogs).toHaveBeenCalledOnce();
});

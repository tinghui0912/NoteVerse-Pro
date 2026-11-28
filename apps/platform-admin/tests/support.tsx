import { render } from "@testing-library/react";
import { vi } from "vitest";
import type { OperatorRead, OperatorRole } from "../generated/api/types.gen";
import { AdminSessionProvider } from "../components/admin-session";
import { AdminConsole } from "../components/admin-console";

export function operatorFor(role: OperatorRole = "SUPER_ADMIN"): OperatorRead {
  const permissions: OperatorRead["permissions"] = [
    "operations.read",
    "users.read",
    "audit.read",
  ];
  if (role !== "SUPPORT_READONLY") permissions.push("operations.retry");
  if (role === "SUPER_ADMIN")
    permissions.push("users.suspend", "operators.manage");
  return {
    operator_id: "00000000-0000-0000-0000-000000000001",
    email: "admin@example.com",
    display_name: "Admin",
    role,
    status: "active",
    permissions,
    totp_enabled: true,
  };
}
export function renderConsole(element: React.ReactNode) {
  return render(
    <AdminSessionProvider>
      <AdminConsole>{element}</AdminConsole>
    </AdminSessionProvider>,
  );
}
export function installDialog() {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    }),
  });
}

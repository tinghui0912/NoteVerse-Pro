import type {
  OperatorPermission,
  OperatorRead,
} from "../generated/api/types.gen";

export function hasPermission(
  operator: OperatorRead | null,
  permission: OperatorPermission,
): boolean {
  return operator?.permissions.includes(permission) ?? false;
}

export const consoleNavigation: ReadonlyArray<{
  href: string;
  label: string;
  permission: OperatorPermission;
}> = [
  { href: "/operations", label: "Operations", permission: "operations.read" },
  { href: "/users", label: "Users", permission: "users.read" },
  { href: "/audit-logs", label: "Audit logs", permission: "audit.read" },
  { href: "/operators", label: "Operators", permission: "operators.manage" },
];

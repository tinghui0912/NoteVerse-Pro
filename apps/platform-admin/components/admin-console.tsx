"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { OperatorPermission } from "../generated/api/types.gen";
import { logout } from "../lib/control-plane-api";
import { requestErrorMessage } from "../lib/control-plane-browser-transport";
import { consoleNavigation, hasPermission } from "../lib/permissions";
import { useAdminSession } from "./admin-session";

export function AdminConsole({ children }: { children: React.ReactNode }) {
  const session = useAdminSession();
  const router = useRouter();
  const pathname = usePathname();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (session.status === "anonymous") router.replace("/login");
  }, [session.status, router]);
  if (session.status === "loading")
    return (
      <main className="admin-shell" aria-busy="true">
        <p role="status">Checking operator session...</p>
      </main>
    );
  if (session.status === "error")
    return (
      <main className="admin-shell">
        <p role="alert">The console is temporarily unavailable.</p>
        <button onClick={session.reload}>Try again</button>
      </main>
    );
  if (session.status !== "authenticated") return null;
  async function signOut() {
    setPending(true);
    setError(null);
    try {
      await logout();
      session.clear();
      router.replace("/login");
    } catch (cause) {
      setError(requestErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="console-layout">
      <aside className="sidebar">
        <p className="eyebrow">NoteVerse</p>
        <h2>Platform control</h2>
        <nav aria-label="Console navigation">
          {consoleNavigation
            .filter((item) => hasPermission(session.operator, item.permission))
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={pathname === item.href ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
        </nav>
      </aside>
      <div className="console-content">
        <div className="console-header">
          <div>
            <strong>{session.operator.display_name}</strong>
            <span>{session.operator.role}</span>
          </div>
          <button
            className="secondary-button"
            onClick={signOut}
            disabled={pending}
          >
            Sign out
          </button>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {session.lowRecoveryCodes !== null && (
          <div role="status" className="warning-banner">
            {session.lowRecoveryCodes} recovery codes remain. Ask a super
            administrator to reset MFA before you run out.
            <button
              className="secondary-button"
              onClick={session.dismissRecoveryWarning}
            >
              Dismiss
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function PermissionBoundary({
  permission,
  children,
}: {
  permission: OperatorPermission;
  children: React.ReactNode;
}) {
  const { operator } = useAdminSession();
  if (!hasPermission(operator, permission))
    return (
      <main className="admin-shell">
        <h1>Access restricted</h1>
        <p role="alert">You do not have permission to view this page.</p>
      </main>
    );
  return <>{children}</>;
}

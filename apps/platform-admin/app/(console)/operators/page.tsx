"use client";

import { FormEvent, useCallback, useState } from "react";

import { useRouter } from "next/navigation";

import type {
  OperatorRead,
  OperatorRole,
  OperatorStatus,
} from "../../../generated/api/types.gen";

import {
  listOperators,
  createOperator,
  updateOperator,
  resetOperatorMfa,
  resetOperatorPassword,
} from "../../../lib/control-plane-api";

import {
  ControlPlaneApplicationError,
  requestErrorMessage,
} from "../../../lib/control-plane-browser-transport";

import { hasPermission } from "../../../lib/permissions";

import {
  normalizedPassword,
  passwordError,
  reasonError,
} from "../../../lib/validation";

import { useAdminQuery } from "../../../lib/use-admin-query";

import { useAdminSession } from "../../../components/admin-session";

import { PermissionBoundary } from "../../../components/admin-console";

import { Pagination } from "../../../components/pagination";

import { ReasonField } from "../../../components/reason-field";

import { CommandDialog } from "../../../components/command-dialog";

type Action =
  | { kind: "create" }
  | { kind: "update" | "password" | "mfa"; operator: OperatorRead };

const roles: ReadonlyArray<OperatorRole> = [
  "SUPPORT_READONLY",
  "PLATFORM_OPERATOR",
  "SUPER_ADMIN",
];

const statuses: ReadonlyArray<OperatorStatus> = ["active", "disabled"];

export default function OperatorsPage() {
  return (
    <PermissionBoundary permission="operators.manage">
      <OperatorsView />
    </PermissionBoundary>
  );
}

function OperatorsView() {
  const session = useAdminSession();
  const router = useRouter();
  const [offset, setOffset] = useState(0);

  const load = useCallback(
    () => listOperators({ limit: 50, offset }),
    [offset],
  );
  const { data, error, loading, refresh } = useAdminQuery(load);

  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function saved() {
    if (
      action &&
      action.kind !== "create" &&
      action.operator.operator_id === session.operator?.operator_id
    ) {
      setAction(null);
      session.clear();
      router.replace("/login");
      return;
    }

    setAction(null);
    setNotice("Operator change saved and audited.");
    refresh();
  }

  return (
    <main className="admin-shell">
      <header>
        <div>
          <p className="eyebrow">Privileged identities</p>
          <h1>Operators</h1>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => setAction({ kind: "create" })}>
            Create operator
          </button>
          <button className="secondary-button" onClick={refresh}>
            Refresh
          </button>
        </div>
      </header>

      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading operators...</p>}

      {action && (
        <OperatorCommandDialog
          key={
            action.kind === "create"
              ? "create"
              : `${action.kind}:${action.operator.operator_id}`
          }
          action={action}
          onClose={() => setAction(null)}
          onSaved={saved}
        />
      )}

      {data && (
        <section className="table-wrap" aria-label="Operators">
          <table>
            <thead>
              <tr>
                <th>Name / email</th>
                <th>Role</th>
                <th>Status</th>
                <th>MFA</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((operator) => (
                <tr key={operator.operator_id}>
                  <td>
                    {operator.display_name}
                    <br />
                    {operator.email}
                  </td>
                  <td>{operator.role}</td>
                  <td>{operator.status}</td>
                  <td>
                    {operator.totp_enabled ? "Enrolled" : "Enrollment required"}
                  </td>

                  <td>
                    <div className="button-row">
                      <button
                        type="button"
                        onClick={() => setAction({ kind: "update", operator })}
                      >
                        Edit access
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setAction({ kind: "password", operator })
                        }
                      >
                        Reset password
                      </button>
                      <button
                        type="button"
                        onClick={() => setAction({ kind: "mfa", operator })}
                      >
                        Reset MFA
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.items.length && <p className="status">No operators found.</p>}
          <Pagination
            offset={offset}
            count={data.items.length}
            hasMore={data.has_more}
            onChange={setOffset}
          />
        </section>
      )}
    </main>
  );
}

function OperatorCommandDialog({
  action,
  onClose,
  onSaved,
}: {
  action: Action;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { operator } = useAdminSession();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");

  const [role, setRole] = useState<OperatorRole>(
    action.kind === "create" ? "SUPPORT_READONLY" : action.operator.role,
  );

  const [status, setStatus] = useState<OperatorStatus>(
    action.kind === "create" ? "active" : action.operator.status,
  );

  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsPassword = action.kind === "create" || action.kind === "password";

  const invalidPassword = needsPassword ? passwordError(password) : null;

  const invalidReason = reasonError(reason);

  const title = {
    create: "Create operator",
    update: "Edit operator access",
    password: "Reset operator password",
    mfa: "Reset operator MFA",
  }[action.kind];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      pending ||
      invalidPassword ||
      invalidReason ||
      !hasPermission(operator, "operators.manage")
    )
      return;

    setPending(true);
    setError(null);

    try {
      if (action.kind === "create")
        await createOperator({
          email: email.trim(),
          display_name: displayName.trim(),
          password: normalizedPassword(password),
          role,
          reason: reason.trim(),
        });
      else {
        const path = { operator_id: action.operator.operator_id };

        if (action.kind === "update")
          await updateOperator(path, { role, status, reason: reason.trim() });
        else if (action.kind === "password")
          await resetOperatorPassword(path, {
            password: normalizedPassword(password),
            reason: reason.trim(),
          });
        else await resetOperatorMfa(path, { reason: reason.trim() });
      }

      setPassword("");
      onSaved();
    } catch (cause) {
      setPassword("");
      setError(
        action.kind === "update" &&
          cause instanceof ControlPlaneApplicationError &&
          cause.status === 409 &&
          cause.code === "no_access"
          ? "The last active super administrator must remain active with that role."
          : requestErrorMessage(cause),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <CommandDialog title={title} pending={pending} onClose={onClose}>
      <form onSubmit={submit}>
        {action.kind !== "create" && <p>{action.operator.email}</p>}

        {action.kind === "create" && (
          <>
            <label>
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={pending}
                autoComplete="off"
              />
            </label>
            <label>
              Display name
              <input
                required
                maxLength={128}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                disabled={pending}
              />
            </label>
          </>
        )}

        {(action.kind === "create" || action.kind === "update") && (
          <label>
            Role
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as OperatorRole)}
              disabled={pending}
            >
              {roles.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        )}

        {action.kind === "update" && (
          <>
            <label>
              Status
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as OperatorStatus)
                }
                disabled={pending}
              >
                {statuses.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <p>
              The last active super administrator must remain active with that
              role. Changing access revokes active sessions and pending
              sign-ins.
            </p>
          </>
        )}

        {needsPassword && (
          <label>
            New password
            <input
              type="password"
              aria-label="New password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending}
              autoComplete="new-password"
              aria-describedby="operator-password-help"
              aria-invalid={!!invalidPassword}
            />
            <small
              id="operator-password-help"
              className={invalidPassword ? "form-error" : "muted"}
            >
              {invalidPassword ?? "Password meets the 12–128 character policy."}
            </small>
          </label>
        )}

        {action.kind === "create" && (
          <p>The operator must enroll an authenticator on first sign-in.</p>
        )}

        {action.kind === "password" && (
          <p>
            Resetting the password revokes active sessions and pending sign-ins.
          </p>
        )}

        {action.kind === "mfa" && (
          <p>
            Confirm MFA reset: active sessions and pending sign-ins will be
            revoked. The authenticator and recovery codes are removed. The
            operator must enroll again on their next sign-in.
          </p>
        )}

        <ReasonField value={reason} onChange={setReason} disabled={pending} />
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={
            pending ||
            !!invalidReason ||
            !!invalidPassword ||
            (action.kind === "create" && (!email.trim() || !displayName.trim()))
          }
        >
          {pending ? "Saving..." : "Confirm change"}
        </button>
      </form>
    </CommandDialog>
  );
}

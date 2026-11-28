"use client";

import { FormEvent, useCallback, useState } from "react";

import type { CustomerDirectoryRead } from "../../../generated/api/types.gen";

import { listUsers, updateUserStatus } from "../../../lib/control-plane-api";

import { requestErrorMessage } from "../../../lib/control-plane-browser-transport";

import { hasPermission } from "../../../lib/permissions";

import { reasonError } from "../../../lib/validation";

import { useAdminQuery } from "../../../lib/use-admin-query";

import { useAdminSession } from "../../../components/admin-session";

import { PermissionBoundary } from "../../../components/admin-console";

import { Pagination } from "../../../components/pagination";

import { ReasonField } from "../../../components/reason-field";

import { CommandDialog } from "../../../components/command-dialog";

export default function UsersPage() {
  return (
    <PermissionBoundary permission="users.read">
      <UsersView />
    </PermissionBoundary>
  );
}

function UsersView() {
  const { operator } = useAdminSession();
  const [offset, setOffset] = useState(0);

  const load = useCallback(() => listUsers({ limit: 50, offset }), [offset]);

  const { data, error, loading, refresh } = useAdminQuery(load);

  const [target, setTarget] = useState<CustomerDirectoryRead | null>(null);

  const [notice, setNotice] = useState<string | null>(null);

  return (
    <main className="admin-shell">
      <header>
        <div>
          <p className="eyebrow">Customer accounts</p>
          <h1>Users</h1>
        </div>
        <button className="secondary-button" onClick={refresh}>
          Refresh
        </button>
      </header>

      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading users...</p>}

      {target && (
        <UserStatusDialog
          user={target}
          onClose={() => setTarget(null)}
          onSaved={() => {
            setNotice(
              "User status updated. Existing sessions remain expired after suspension.",
            );
            setTarget(null);
            refresh();
          }}
        />
      )}

      {data && (
        <section className="table-wrap" aria-label="User directory">
          <table>
            <thead>
              <tr>
                <th>User ID</th>
                <th>Email</th>
                <th>Display name</th>
                <th>Status</th>
                <th>Details and actions</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((user) => (
                <tr key={user.user_id}>
                  <td>{user.user_id}</td>
                  <td>{user.email}</td>
                  <td>{user.display_name ?? "—"}</td>
                  <td>{user.is_active ? "Active" : "Suspended / inactive"}</td>
                  <td>
                    <details>
                      <summary>View user details</summary>
                      <dl>
                        <dt>User ID</dt>
                        <dd>{user.user_id}</dd>
                        <dt>Email</dt>
                        <dd>{user.email}</dd>
                        <dt>Display name</dt>
                        <dd>{user.display_name ?? "—"}</dd>
                        <dt>Account status</dt>
                        <dd>{user.is_active ? "Active" : "Inactive"}</dd>
                      </dl>
                    </details>

                    {hasPermission(operator, "users.suspend") && (
                      <button type="button" onClick={() => setTarget(user)}>
                        {user.is_active ? "Suspend" : "Reactivate"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.items.length && <p className="status">No users found.</p>}
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

function UserStatusDialog({
  user,
  onClose,
  onSaved,
}: {
  user: CustomerDirectoryRead;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { operator } = useAdminSession();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      pending ||
      reasonError(reason) ||
      !hasPermission(operator, "users.suspend")
    )
      return;
    setPending(true);
    setError(null);

    try {
      await updateUserStatus(
        { user_id: user.user_id },
        { is_active: !user.is_active, reason: reason.trim() },
      );
      onSaved();
    } catch (cause) {
      setError(requestErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <CommandDialog
      title={user.is_active ? "Suspend user" : "Reactivate user"}
      pending={pending}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <p>{user.email}</p>
        <p>
          {user.is_active
            ? "Suspension immediately prevents access and expires active sessions."
            : "Reactivation permits sign-in but does not restore expired sessions. Closed accounts cannot be reactivated."}
        </p>

        <ReasonField value={reason} onChange={setReason} disabled={pending} />
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        <button type="submit" disabled={pending || !!reasonError(reason)}>
          {pending ? "Saving..." : "Confirm status change"}
        </button>
      </form>
    </CommandDialog>
  );
}

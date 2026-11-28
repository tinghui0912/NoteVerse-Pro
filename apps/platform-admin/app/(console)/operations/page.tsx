"use client";

import { useCallback, useState } from "react";
import type { AsyncOperationRead } from "../../../generated/api/types.gen";
import {
  listAsyncOperations,
  retryAsyncOperation,
} from "../../../lib/control-plane-api";
import { requestErrorMessage } from "../../../lib/control-plane-browser-transport";
import { hasPermission } from "../../../lib/permissions";
import { reasonError } from "../../../lib/validation";
import { useAdminQuery } from "../../../lib/use-admin-query";
import { useAdminSession } from "../../../components/admin-session";
import { PermissionBoundary } from "../../../components/admin-console";
import { Pagination } from "../../../components/pagination";
import { ReasonField } from "../../../components/reason-field";

export default function OperationsPage() {
  return (
    <PermissionBoundary permission="operations.read">
      <OperationsView />
    </PermissionBoundary>
  );
}

function OperationsView() {
  const { operator } = useAdminSession();
  const [offset, setOffset] = useState(0);
  const load = useCallback(
    () => listAsyncOperations({ limit: 50, offset }),
    [offset],
  );
  const { data, error: loadError, loading, refresh } = useAdminQuery(load);
  const operations = data?.items ?? [];
  const [error, setError] = useState<string | null>(null);
  const [retryTarget, setRetryTarget] = useState<AsyncOperationRead | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [retryPending, setRetryPending] = useState(false);
  async function retry(event: React.FormEvent) {
    event.preventDefault();
    if (
      !retryTarget ||
      reasonError(reason) ||
      retryPending ||
      !hasPermission(operator, "operations.retry")
    )
      return;
    setRetryPending(true);
    setError(null);
    try {
      await retryAsyncOperation(
        { kind: retryTarget.kind, operation_id: retryTarget.operation_id },
        { reason: reason.trim() },
      );
      setRetryTarget(null);
      setReason("");
      refresh();
    } catch (cause) {
      setError(requestErrorMessage(cause));
    } finally {
      setRetryPending(false);
    }
  }
  return (
    <main className="admin-shell">
      <header>
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Async operations</h1>
        </div>
        <button className="secondary-button" onClick={refresh}>
          Refresh
        </button>
      </header>
      {loading ? <p className="status">Loading operations...</p> : null}
      {error || loadError ? (
        <p className="status error" role="alert">
          {error ?? loadError}
        </p>
      ) : null}
      {retryTarget ? (
        <form onSubmit={retry} aria-label="Operator recovery">
          <p>
            Retry {retryTarget.kind}: {retryTarget.operation_id}
          </p>
          <ReasonField
            value={reason}
            onChange={setReason}
            label="Recovery reason"
            disabled={retryPending}
          />
          <button
            type="submit"
            disabled={retryPending || !!reasonError(reason)}
          >
            Confirm retry
          </button>
          <button
            type="button"
            disabled={retryPending}
            onClick={() => setRetryTarget(null)}
          >
            Cancel
          </button>
        </form>
      ) : null}
      {!loading ? (
        <section className="table-wrap" aria-label="Asynchronous operations">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Resource</th>
                <th>Operation ID</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Updated</th>
                <th>Next attempt</th>
                <th>Code</th>
                <th>Execution stage</th>
                <th>Failure stage</th>
                <th>Classification</th>
                <th>Automatic retry</th>
                <th>Safe detail</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {operations.map((operation) => (
                <tr key={`${operation.kind}:${operation.operation_id}`}>
                  <td>{operation.kind}</td>
                  <td>{operation.resource_type}</td>
                  <td>{operation.operation_id}</td>
                  <td>{operation.status}</td>
                  <td>
                    {operation.attempts}/{operation.max_attempts ?? "-"}
                  </td>
                  <td>
                    {operation.updated_at
                      ? new Date(operation.updated_at).toLocaleString()
                      : "-"}
                  </td>
                  <td>
                    {operation.next_attempt_at
                      ? new Date(operation.next_attempt_at).toLocaleString()
                      : "-"}
                  </td>
                  <td>{operation.failure?.code ?? "-"}</td>
                  <td>{operation.execution_stage ?? "-"}</td>
                  <td>{operation.failure?.stage ?? "-"}</td>
                  <td>{operation.failure?.classification ?? "-"}</td>
                  <td>
                    {operation.failure
                      ? String(operation.failure.retryable)
                      : "-"}
                  </td>
                  <td>{operation.failure?.detail ?? "-"}</td>
                  <td>
                    {operation.can_retry &&
                    hasPermission(operator, "operations.retry") ? (
                      <button
                        type="button"
                        disabled={retryPending}
                        onClick={() => {
                          setRetryTarget(operation);
                          setReason("");
                        }}
                      >
                        Retry
                      </button>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {operations.length === 0 ? (
            <p className="status">No operations match the current query.</p>
          ) : null}
          <Pagination
            offset={offset}
            count={operations.length}
            hasMore={data?.has_more ?? false}
            onChange={setOffset}
          />
        </section>
      ) : null}
    </main>
  );
}

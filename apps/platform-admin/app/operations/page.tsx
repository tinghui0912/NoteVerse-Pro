"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ControlPlaneApplicationError, ControlPlaneHttpError } from "../../lib/control-plane-browser-transport";
import type { AsyncOperationRead } from "../../generated/api/types.gen";
import {
  currentOperator,
  listAsyncOperations,
  logout,
  retryAsyncOperation,
} from "../../lib/control-plane-api";

export default function OperationsPage() {
  const router = useRouter();
  const [operations, setOperations] = useState<AsyncOperationRead[]>([]);
  const [operatorName, setOperatorName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [retryTarget, setRetryTarget] = useState<AsyncOperationRead | null>(null);
  const [reason, setReason] = useState("");
  const [retryPending, setRetryPending] = useState(false);

  async function retry(event: React.FormEvent) {
    event.preventDefault();
    if (!retryTarget || reason.trim().length < 3 || retryPending) return;
    setRetryPending(true);
    setError(null);
    let accepted = false;
    try {
      await retryAsyncOperation({kind: retryTarget.kind, operation_id: retryTarget.operation_id}, {reason: reason.trim()});
      accepted = true;
      const page = await listAsyncOperations({limit: 50, offset});
      setOperations(page.items);
      setHasMore(page.has_more);
      setRetryTarget(null);
      setReason("");
    } catch (cause) {
      if ((cause instanceof ControlPlaneApplicationError || cause instanceof ControlPlaneHttpError) && cause.status === 401) router.replace("/login");
      else setError(accepted ? "Retry accepted, but refreshing operations failed. Reload the list." : "Retry was not accepted. Check the operation and your permissions.");
    } finally {
      setRetryPending(false);
    }
  }

  function changeOffset(nextOffset: number) {
    setLoading(true);
    setError(null);
    setOffset(nextOffset);
  }

  useEffect(() => {
    void Promise.all([listAsyncOperations({ limit: 50, offset }), currentOperator()])
      .then(([operationsPage, operator]) => {
        setOperations(operationsPage.items);
        setHasMore(operationsPage.has_more);
        setOperatorName(operator.display_name);
      })
      .catch((requestError: unknown) => {
        if ((requestError instanceof ControlPlaneApplicationError || requestError instanceof ControlPlaneHttpError) && requestError.status === 401) {
          router.replace("/login");
          return;
        }
        setError("Operations are temporarily unavailable.");
      })
      .finally(() => setLoading(false));
  }, [offset, router]);

  return (
    <main className="admin-shell">
      <header>
        <div><p className="eyebrow">NoteVerse</p><h1>Async operations</h1></div>
        <div className="header-actions">
          <span className="environment">{operatorName ? `${operatorName} · Control plane` : "Control plane"}</span>
          <button className="secondary-button" type="button" onClick={() => {
            void logout().finally(() => router.replace("/login"));
          }}>Sign out</button>
        </div>
      </header>
      {loading ? <p className="status">Loading operations...</p> : null}
      {error ? <p className="status error" role="alert">{error}</p> : null}
      {retryTarget ? <form onSubmit={retry} aria-label="Operator recovery">
        <p>Retry {retryTarget.kind}: {retryTarget.operation_id}</p>
        <label htmlFor="retry-reason">Recovery reason</label>
        <input id="retry-reason" value={reason} onChange={event => setReason(event.target.value)} required minLength={3} maxLength={500} disabled={retryPending} />
        <button type="submit" disabled={retryPending || reason.trim().length < 3}>Confirm retry</button>
        <button type="button" disabled={retryPending} onClick={() => setRetryTarget(null)}>Cancel</button>
      </form> : null}
      {!loading ? (
        <section className="table-wrap" aria-label="Asynchronous operations">
          <table><thead><tr><th>Type</th><th>Resource</th><th>Operation ID</th><th>Status</th><th>Attempts</th><th>Updated</th><th>Next attempt</th><th>Code</th><th>Execution stage</th><th>Failure stage</th><th>Classification</th><th>Automatic retry</th><th>Safe detail</th><th>Action</th></tr></thead>
            <tbody>{operations.map((operation) => <tr key={`${operation.kind}:${operation.operation_id}`}>
              <td>{operation.kind}</td><td>{operation.resource_type}</td><td>{operation.operation_id}</td>
              <td>{operation.status}</td><td>{operation.attempts}/{operation.max_attempts ?? "-"}</td>
              <td>{operation.updated_at ? new Date(operation.updated_at).toLocaleString() : "-"}</td>
              <td>{operation.next_attempt_at ? new Date(operation.next_attempt_at).toLocaleString() : "-"}</td>
              <td>{operation.failure?.code ?? "-"}</td><td>{operation.execution_stage ?? "-"}</td><td>{operation.failure?.stage ?? "-"}</td>
              <td>{operation.failure?.classification ?? "-"}</td><td>{operation.failure ? String(operation.failure.retryable) : "-"}</td>
              <td>{operation.failure?.detail ?? "-"}</td>
              <td>{operation.can_retry ? <button type="button" disabled={retryPending} onClick={() => {setRetryTarget(operation); setReason("");}}>Retry</button> : "-"}</td>
            </tr>)}</tbody>
          </table>
          {operations.length === 0 ? <p className="status">No operations match the current query.</p> : null}
          <footer className="pagination">
            <button className="secondary-button" type="button" disabled={offset === 0} onClick={() => changeOffset(Math.max(offset - 50, 0))}>Previous</button>
            <span>{operations.length === 0 ? "No results" : `Showing ${offset + 1}-${offset + operations.length}`}</span>
            <button className="secondary-button" type="button" disabled={!hasMore} onClick={() => changeOffset(offset + 50)}>Next</button>
          </footer>
        </section>
      ) : null}
    </main>
  );
}

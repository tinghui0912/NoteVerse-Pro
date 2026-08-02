"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ControlPlaneRequestError,
  getCurrentOperator,
  listAsyncOperations,
  signOut,
  type AsyncOperation,
} from "../../lib/control-plane-client";

export default function OperationsPage() {
  const router = useRouter();
  const [operations, setOperations] = useState<AsyncOperation[]>([]);
  const [operatorName, setOperatorName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  function changeOffset(nextOffset: number) {
    setLoading(true);
    setError(null);
    setOffset(nextOffset);
  }

  useEffect(() => {
    void Promise.all([listAsyncOperations(offset), getCurrentOperator()])
      .then(([operationsPage, operator]) => {
        setOperations(operationsPage.items);
        setHasMore(operationsPage.has_more);
        setOperatorName(operator.display_name);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof ControlPlaneRequestError && requestError.status === 401) {
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
            void signOut().finally(() => router.replace("/login"));
          }}>Sign out</button>
        </div>
      </header>
      {loading ? <p className="status">Loading operations...</p> : null}
      {error ? <p className="status error" role="alert">{error}</p> : null}
      {!loading && !error ? (
        <section className="table-wrap" aria-label="Asynchronous operations">
          <table><thead><tr><th>Type</th><th>Resource</th><th>Status</th><th>Attempts</th><th>Updated</th><th>Code</th></tr></thead>
            <tbody>{operations.map((operation) => <tr key={`${operation.kind}:${operation.operation_id}`}><td>{operation.kind}</td><td>{operation.resource_type}</td><td>{operation.status}</td><td>{operation.attempts}/{operation.max_attempts ?? "-"}</td><td>{operation.updated_at ? new Date(operation.updated_at).toLocaleString() : "-"}</td><td>{operation.diagnostic?.code ?? "-"}</td></tr>)}</tbody>
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

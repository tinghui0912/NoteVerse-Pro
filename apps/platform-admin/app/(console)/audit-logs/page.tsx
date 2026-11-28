"use client";

import { FormEvent, useCallback, useState } from "react";

import type { AuditLogsListData } from "../../../generated/api/types.gen";

import { listAuditLogs } from "../../../lib/control-plane-api";

import { useAdminQuery } from "../../../lib/use-admin-query";

import { PermissionBoundary } from "../../../components/admin-console";

import { Pagination } from "../../../components/pagination";

type Filters = NonNullable<AuditLogsListData["query"]>;

export default function AuditLogsPage() {
  return (
    <PermissionBoundary permission="audit.read">
      <AuditLogsView />
    </PermissionBoundary>
  );
}

function AuditLogsView() {
  const [filters, setFilters] = useState<Filters>({});

  const [offset, setOffset] = useState(0);

  const [validation, setValidation] = useState<string | null>(null);

  const load = useCallback(
    () => listAuditLogs({ ...filters, limit: 50, offset }),
    [filters, offset],
  );

  const { data, loading, error, refresh } = useAdminQuery(load);

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const value = (name: string) => String(form.get(name) ?? "").trim();

    const after = value("created_after"),
      before = value("created_before");

    if (after && before && Date.parse(after) > Date.parse(before)) {
      setValidation("The start time must not be after the end time.");
      return;
    }

    const outcome = value("outcome");

    setFilters({
      actor_operator_id: value("actor") ? Number(value("actor")) : undefined,
      action: value("action") || undefined,

      target_type: value("target_type") || undefined,
      target_id: value("target_id") || undefined,

      outcome:
        outcome === "succeeded" || outcome === "failed" ? outcome : undefined,

      created_after: after ? new Date(after).toISOString() : undefined,
      created_before: before ? new Date(before).toISOString() : undefined,
    });

    setOffset(0);
    setValidation(null);
  }

  return (
    <main className="admin-shell">
      <header>
        <div>
          <p className="eyebrow">Security and operations</p>
          <h1>Audit logs</h1>
        </div>
        <button className="secondary-button" onClick={refresh}>
          Refresh
        </button>
      </header>

      <form className="filters" onSubmit={filter} aria-label="Audit filters">
        <label>
          Actor operator ID
          <input name="actor" type="number" min="1" step="1" />
        </label>
        <label>
          Action
          <input name="action" maxLength={64} />
        </label>

        <label>
          Target type
          <input name="target_type" maxLength={128} />
        </label>
        <label>
          Target ID
          <input name="target_id" maxLength={128} />
        </label>

        <label>
          Outcome
          <select name="outcome">
            <option value="">All outcomes</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
          </select>
        </label>

        <label>
          Created after
          <input name="created_after" type="datetime-local" />
        </label>
        <label>
          Created before
          <input name="created_before" type="datetime-local" />
        </label>

        <button type="submit">Apply filters</button>
      </form>

      {(error || validation) && (
        <p role="alert" className="form-error">
          {validation ?? error}
        </p>
      )}

      {loading && <p role="status">Loading audit logs...</p>}

      {data && (
        <section className="table-wrap" aria-label="Audit log results">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Outcome</th>
                <th>Reason</th>
                <th>Request ID</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((event) => (
                <tr key={event.event_id}>
                  <td>{new Date(event.created_at).toLocaleString()}</td>
                  <td>{event.actor_operator_id ?? "System / unknown"}</td>
                  <td>{event.action}</td>
                  <td>
                    {event.target_type}: {event.target_id}
                  </td>
                  <td>{event.outcome}</td>
                  <td>{event.reason}</td>
                  <td>{event.request_id ?? "—"}</td>

                  <td>
                    <details>
                      <summary>View evidence</summary>
                      <dl>
                        <dt>IP address</dt>
                        <dd>{event.ip_address ?? "—"}</dd>
                        <dt>User agent</dt>
                        <dd>{event.user_agent ?? "—"}</dd>
                        <dt>State</dt>
                        <dd>
                          {event.previous_state ?? "—"} →{" "}
                          {event.new_state ?? "—"}
                        </dd>
                        <dt>Error code</dt>
                        <dd>{event.error_code ?? "—"}</dd>
                      </dl>
                      <pre>{JSON.stringify(event.metadata_json, null, 2)}</pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.items.length === 0 && (
            <p className="status">No audit logs match the current filters.</p>
          )}
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

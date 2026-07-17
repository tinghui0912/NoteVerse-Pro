# Grafana Dashboard Requirements

This document defines the first production dashboard set for NoteVerse Pro.
The target deployment is Kubernetes with Prometheus, Loki, Tempo, and Grafana.

## Principles

- Dashboards show product and platform health, not implementation details to
  end users.
- Labels must remain low-cardinality. Do not chart raw `score_id`,
  `revision_id`, `job_id`, user email, or storage object keys.
- Logs are collected by Fluent Bit, stored in Loki, and explored in Grafana.
  Grafana panels should link to logs through request IDs or operation IDs when
  the platform supports it. Operator query workflows are documented in
  `docs/grafana-loki-query-runbook.md`.
- Loki labels must stay low-cardinality. Use labels such as `service`,
  `environment`, `namespace`, `container`, and `level`. Keep
  `request_id`, `originating_request_id`, `score_id`, `revision_id`, `job_id`,
  `outbox_id`, pod names, emails, storage keys, and file hashes in the structured log body.
  See `docs/k8s-logging-loki-fluent-bit-plan.md` for the full label policy.
- Distributed traces will use OpenTelemetry and Tempo once request/outbox
  correlation is stable enough to justify trace sampling and retention policy.
  See `docs/opentelemetry-tempo-tracing-plan.md`.
- Sentry is not part of the planned stack.
- Alerts should page only for user-impacting or operator-actionable failures.

## API Health

Panels:

- API request rate by route and status class.
- API p95 and p99 latency by route.
- API 5xx rate.
- API 4xx rate, separated from 5xx so user/business errors do not look like
  platform failures.

PromQL starting points:

```promql
sum by (route, status_code) (rate(noteverse_http_requests_total[5m]))
histogram_quantile(
  0.95,
  sum by (route, le) (rate(noteverse_http_request_duration_seconds_bucket[5m]))
)
sum(rate(noteverse_http_requests_total{status_code=~"5.."}[5m]))
```

Suggested alerts:

- API 5xx rate stays above a small threshold for 5 minutes.
- p95 latency for core routes stays above the product SLO for 10 minutes.

## Async Operations

Panels:

- Import jobs by state.
- Render, playback, and mail outbox records by status.
- Score deletion cleanup records by status.
- Failed/exhausted operations by kind.
- Oldest open async operation age by kind.
- Oldest processing async operation age by kind.
- Average completed async operation duration by kind over the last 24 hours.

PromQL starting points:

```promql
sum by (state) (noteverse_import_jobs_by_state)
sum by (kind, status) (noteverse_outbox_records_by_status)
sum by (status) (noteverse_score_deletions_by_status)
noteverse_async_operation_oldest_open_age_seconds
noteverse_async_operation_oldest_processing_age_seconds
noteverse_async_operation_completed_duration_average_seconds
```

Suggested alerts:

- Pending import jobs grow continuously for 10 minutes.
- Render or playback failed records exceed the retry budget.
- Mail permanent failures rise above baseline.
- Score deletion records remain in deleting state beyond the cleanup SLO.
- Oldest open operation age exceeds its product SLO.
- Processing age exceeds the worker timeout plus retry grace window.

## Realtime

Panels:

- Active app SSE connections.
- Active practice WebSocket connections.
- Connection count trend by channel.

PromQL starting points:

```promql
noteverse_realtime_active_connections
sum by (channel) (noteverse_realtime_active_connections)
```

Suggested alerts:

- Active realtime connections drop to zero unexpectedly during normal traffic.
- Practice WebSocket connections grow unusually and do not return to baseline.

## Storage And Quota

Panels to add after quota metrics are implemented:

- Storage usage by category.
- Quota reservation failures by category.
- Storage cleanup backlog.

Suggested alerts:

- Quota enforcement failures occur.
- Cleanup backlog grows for more than one retention window.

## Dashboard Layout

1. Overview row:
   - API request rate
   - API error rate
   - p95 latency
   - async backlog summary
2. Async row:
- import jobs by state
- outbox by kind/status
- score deletion status
- oldest open/processing operation age
- completed duration average
3. Realtime row:
   - active app SSE
   - active practice WebSocket
4. Storage row:
   - reserved for storage/quota metrics

## Next Metrics To Add

- Storage quota and cleanup gauges.
- Mail send latency and delivery outcome counters.

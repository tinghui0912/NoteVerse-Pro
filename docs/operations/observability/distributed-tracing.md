# Distributed Tracing

Backend tracing is explicitly configured and exports OTLP to an OpenTelemetry
Collector. Collector batching and resource configuration feed Tempo; Grafana
correlates traces with structured logs. Missing/disabled configuration never
selects an implicit external endpoint. Export failures must not fail business work.

## Context and attempts

`X-Request-ID` is a bounded support identifier, distinct from W3C `traceparent`
and `tracestate`. Logs expose trace/span IDs only for a valid active span. API
instrumentation excludes health and metrics traffic.

Durable import, render, playback and mail work records preserve validated W3C
context. Relay publication and consumer execution have separate spans. Each
delivery/attempt has its own Celery execution identity; retry does not reuse an
execution span. Missing or invalid parent context starts a safe independent root.

Scheduler cycles start their own context after lock acquisition. Empty scans
discard their spans and clear context rather than exporting idle background
traffic. Unit contracts cover async isolation, malformed context, retries,
worker initialization and idle filtering. They do not prove delivery in a live
Collector/Loki/Tempo installation.

## Privacy and operation

Span names and attributes describe bounded operations, routes and status. Never
attach bodies, MusicXML, OCR text, credentials, email addresses, storage keys,
raw exceptions or media. Opaque business identifiers are diagnostic fields,
not metric or Loki labels. The backend field policy and Collector configuration
both apply; downstream filtering is not a reason to emit secrets upstream.

Sampling, timeout, batch size, exporter endpoints and resource identities are
environment configuration. Head sampling cannot promise retention of every
failure discovered after a sampling decision. Browser code uses its existing
observability facade; remote browser tracing is not implied by backend support.

Use [Log Event Schema](log-event-schema.md), [Grafana/Loki Queries](grafana-loki-query-runbook.md)
and the checked-in Collector/Grafana values to diagnose correlation. A controlled
retry is required to qualify a deployed end-to-end trace chain.

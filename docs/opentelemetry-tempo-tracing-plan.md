# OpenTelemetry + Tempo Tracing Plan

This document defines the future distributed tracing model for NoteVerse Pro.
It is intentionally a design plan first. Do not add tracing SDKs or exporters
until logging, metrics, request IDs, and async operation correlation remain
stable under staging traffic.

## Target Architecture

```text
Browser
  |
  | traceparent / tracestate (future)
  v
Next.js frontend
  |
  | HTTP / SSE / WebSocket
  v
FastAPI backend
  |
  | DB / Redis / storage / mail / outbox enqueue
  v
Celery worker / beat
  |
  | render / playback / import / cleanup
  v
Tempo
  |
  v
Grafana traces + logs + metrics correlation
```

## Goals

- Trace one user-visible action across frontend, API, durable async outbox, and
  worker execution.
- Correlate traces with Loki logs through `trace_id`, `span_id`, `request_id`,
  and `originating_request_id`.
- Correlate traces with Prometheus metrics through exemplars later, not in the
  first implementation.
- Keep ordinary users insulated from tracing details.

## Non-goals

- Do not replace structured logs with traces.
- Do not use Tempo as audit storage.
- Do not attach request/response bodies, MusicXML content, OCR text, email
  addresses, access tokens, storage object contents, or file hashes to spans.
- Do not make high-cardinality values into Loki labels or Prometheus labels.
- Do not introduce Sentry.

## Trace Boundaries

### Frontend

Future frontend spans:

- `frontend.route.render`
- `frontend.api.request`
- `frontend.auth.submit`
- `frontend.score.save`
- `frontend.score.play_preview`

Initial frontend tracing should be conservative. The current frontend
observability facade should remain the product integration point. OpenTelemetry
should be added behind that facade, not scattered across components.

### Backend API

Automatic instrumentation candidates:

- FastAPI request span.
- SQLAlchemy DB spans.
- Redis spans if the library instrumentation is stable in the chosen runtime.
- HTTP client spans for outbound mail/provider calls if applicable.

Manual backend spans:

- `auth.login`
- `score.detail.load`
- `score.revision.create`
- `score.restore`
- `score.delete.request`
- `upload.create`
- `import.confirm`
- `share.create`
- `practice.session.create`

### Realtime

SSE and WebSocket are long-lived connections, so avoid one giant span that
stays open for the whole connection.

Recommended spans:

- `realtime.sse.connect`
- `realtime.sse.catchup`
- `realtime.event.deliver`
- `practice.websocket.connect`
- `practice.audio.chunk.process` only when sampled or diagnostic mode is on.

High-volume audio chunks must not create unsampled spans in production.

### Async Outbox And Workers

Outbox creation should carry current trace context into durable records.

Relevant tables already carry request correlation such as
`originating_request_id`. Future tracing should add trace context fields only
after a migration is planned.

Recommended durable fields:

- `trace_id`
- `parent_span_id`
- `traceparent`

Recommended worker spans:

- `import_job.process`
- `import_pipeline.step`
- `render_outbox.process`
- `playback_outbox.process`
- `mail_outbox.send`
- `score_deletion.cleanup`
- `derived_asset_retention.cleanup`

The worker span should link to the originating API span through W3C trace
context when available. If trace context is unavailable, logs must still be
queryable by `originating_request_id`.

## Span Naming

Use stable semantic names, not raw URLs or user content.

Good:

```text
http.server.request
score.revision.create
render_outbox.process
playback_outbox.process
import_pipeline.step
```

Avoid:

```text
GET /api/v1/scores/8c0640f7-a946-469b-b759-94c3ac0d541a
render Once Again v31
process user@example.com upload
```

## Span Attribute Policy

Allowed low-cardinality attributes:

- `service.name`
- `deployment.environment`
- `http.method`
- `http.route`
- `http.status_code`
- `operation.kind`
- `operation.status`
- `outbox.kind`
- `outbox.status`
- `import.step`
- `render.engine`
- `playback.engine`
- `storage.backend`
- `public_code`

Allowed high-cardinality attributes only when needed for incident debugging:

- `request_id`
- `originating_request_id`
- `job_id`
- `score_id`
- `revision_id`
- `outbox_id`

These are acceptable in Tempo span attributes, but must not become Prometheus or
Loki labels.

Forbidden span attributes:

- email addresses
- user display names
- raw access/refresh/reset/verification tokens
- password or password hashes
- MusicXML content
- OCR-recognized text
- raw audio data
- request/response body
- full storage object contents
- full file hashes

## Sampling Strategy

Initial production recommendation:

- Head sampling:
  - sample 1% of successful normal API requests;
  - sample 100% of API 5xx;
  - sample 100% of async terminal failures;
  - sample 100% of explicit diagnostic windows.
- Keep practice audio chunk spans disabled by default.
- Keep import/render/playback worker traces sampled when they fail or exceed
  SLO thresholds.

Longer-term option:

- Use tail sampling in the OpenTelemetry Collector to retain traces with:
  - error status;
  - high latency;
  - async operation failure;
  - selected `public_code` values.

Tail sampling is more powerful but operationally more complex. Do not start
there unless the cluster already runs a reliable collector tier.

## Context Propagation

### HTTP

Use W3C headers:

- `traceparent`
- `tracestate`

Continue to keep `X-Request-ID` as the support/debug identifier. It is not a
replacement for trace context.

### Outbox

When API code creates durable async work:

1. read the current span context;
2. persist trace context on the outbox/import/deletion record;
3. keep `originating_request_id` for log-only correlation;
4. worker reconstructs a linked or child span when processing the record.

### Celery

If a task is still dispatched directly through Celery, propagate trace context
through task headers.

For durable outbox records, prefer the database row as the source of trace
context. That is more reliable than relying only on broker headers.

## Grafana Correlation

From trace to logs:

- include `trace_id` and `span_id` in structured logs after OTel is enabled;
- query Loki with:

```logql
{namespace="noteverse-prod"} | json | trace_id="..."
```

From logs to trace:

- use Grafana derived fields to link a `trace_id` JSON field to Tempo.

From metrics to traces:

- add exemplars later after Prometheus and Tempo are stable.

## Collector Deployment Shape

Future Kubernetes components:

```text
application pods
  -> OTLP HTTP/gRPC
  -> OpenTelemetry Collector
  -> Tempo
```

Recommended Collector processors:

- memory limiter
- batch
- resource attributes
- sampling processor only after policy is finalized

Do not export traces directly from application pods to Tempo if a collector is
available. The collector gives one place for sampling, redaction, retries, and
routing.

## Implementation Phases

### Phase 1: Design And Config Only

- Keep this document current.
- Ensure logs already support `request_id` and `originating_request_id`.
- Keep OTel dependencies out of production runtime until a concrete rollout is
  scheduled.

### Phase 2: Backend API Tracing

- Add OpenTelemetry SDK and FastAPI instrumentation.
- Add SQLAlchemy instrumentation if overhead is acceptable.
- Emit `trace_id` and `span_id` in structured backend logs.
- Send traces to a local/staging OpenTelemetry Collector.

### Phase 3: Async Outbox Tracing

- Add trace context fields to async records.
- Propagate API trace context into import/render/playback/mail/deletion outbox
  records.
- Create worker spans linked to originating API spans.

### Phase 4: Frontend Tracing

- Integrate OpenTelemetry behind the frontend observability facade.
- Propagate W3C trace context to backend API calls.
- Keep route/component spans minimal.

### Phase 5: Grafana Correlation

- Configure Loki derived fields from `trace_id` to Tempo.
- Add dashboard links from metrics/log panels to trace views.
- Review retention and sampling based on staging traffic.

## Operational Checklist Before Enabling In Production

- Confirm trace sampling policy.
- Confirm Tempo retention.
- Confirm PII/sensitive attribute denylist.
- Confirm collector memory and batch limits.
- Confirm Grafana trace-to-log links.
- Confirm no high-volume audio/chunk spans are enabled by default.
- Confirm missing OTel config fails clearly and never exports to a default or
  test endpoint.

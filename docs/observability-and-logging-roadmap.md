# Observability and Logging Roadmap

## Purpose

This document turns the recent logging, error handling, and production
observability discussions into an executable roadmap for NoteVerse.

The goal is not to add scattered debug logs. The goal is to make production
failures diagnosable while keeping the product UI clean:

- ordinary users see stable product messages;
- browser consoles stay free of development logs;
- backend logs are structured and queryable;
- frontend runtime errors are reported through a controlled observability
  facade;
- operations/debug details stay in logs and ops-only APIs.

Target production deployment:

- Kubernetes for application runtime;
- Fluent Bit for log collection;
- Loki + Grafana for log storage, querying, and visualization;
- Prometheus + Grafana for metrics and dashboards;
- OpenTelemetry + Tempo for distributed tracing after request/outbox
  correlation is stable;
- backend services must write production logs to stdout/stderr only and must not
  depend on local log files.

Out of scope:

- Sentry is not part of the planned production stack. Browser/runtime error
  reporting should continue to go through the vendor-neutral frontend
  observability facade and can later be delivered to a self-hosted pipeline.
- Elasticsearch/Kibana is not the default logging target. It remains a future
  option only if NoteVerse develops strong full-text log search or SIEM-like
  requirements that justify the operational cost.

## Current Baseline

### Frontend

The frontend currently has good user-facing error handling and a first
engineering diagnostics layer.

Implemented:

- `ApiError` carries `status`, backend `public_code`, `public_message`, and
  `request_id`.
- UI surfaces use toasts, translated error messages, `ResourceLoadError`,
  `SectionErrorState`, and route-level `error.tsx`.
- Production source code no longer relies on scattered `console.*` statements.
- A vendor-neutral frontend observability facade exists under
  `frontend/src/lib/observability/`.
- Route-level error boundaries and API transport failures are wired into the
  facade.
- ESLint blocks new `console.*` usage in `frontend/src`.

Missing:

- no self-hosted browser error ingestion endpoint has been selected or
  connected behind the frontend observability facade.

### Backend

The backend already has a solid observability foundation.

Implemented:

- centralized Loguru setup in `app.core.logger`;
- debug console logs and production-style JSON stdout;
- `X-Request-ID` generation/propagation;
- request/response lifecycle logging middleware;
- centralized exception handlers;
- public/internal error response separation;
- async operation diagnostics for import, render, playback, mail, and score
  deletion;
- durable outbox and Celery beat maintenance for recoverable async work.

Missing or incomplete:

- standard `logging`, Celery task logger, and `app.core.logger` are mixed across
  modules;
- task logs do not consistently include stable context fields such as
  `job_id`, `outbox_id`, `score_id`, `revision_id`, `attempt`, and
  `next_retry_at`;
- audit events, analytics events, and runtime logs are not fully separated.

## Principles

1. **Observability is not console logging.**
   Frontend code should report errors through an observability facade, not
   through browser console output.

2. **Users must not see implementation details.**
   Product UI must never expose Redis, worker, storage, Verovio, Legato,
   PaddleOCR, WebSocket internals, SMTP, S3, stack traces, or exception strings.

3. **Public and internal error information are separate contracts.**
   Public APIs return stable `public_code`, `public_message`, and `request_id`.
   Internal reason/detail belongs in logs and ops-only APIs.

4. **Structured logs beat formatted strings.**
   Production logs should be queryable by fields such as `event`, `method`,
   `path`, `status_code`, `duration_ms`, `request_id`, and resource IDs.

5. **Logs and metrics solve different problems.**
   Logs explain what happened in an individual case. Metrics show whether the
   system is degrading over time. NoteVerse should use structured logs for
   diagnosis and Prometheus metrics for service health, latency, queue depth,
   and failure-rate monitoring.

6. **Business events, audit events, analytics, and runtime logs are different
   streams.**
   Do not mix `score.created`, `share.created`, request logs, worker failures,
   and product analytics into one vague logging concept.

7. **Build product facades before choosing transport tools.**
   Grafana, Loki, Prometheus, OpenTelemetry, Tempo, and future self-hosted
   browser-error pipelines should be integration targets, not concepts leaked
   throughout application code.

8. **Loki labels must stay low-cardinality.**
   Fluent Bit/Loki labels should be limited to stable infrastructure dimensions
   such as `service`, `environment`, `namespace`, `pod`, `container`, and
   `level`. High-cardinality fields such as `request_id`, `user_id`,
   `score_id`, `revision_id`, `job_id`, `outbox_id`, email addresses, storage
   keys, and file hashes must stay in the structured JSON log body, not Loki
   labels.

9. **Logs are not audit storage.**
   User/security-sensitive business events such as password changes, score
   deletion, share revocation, permission changes, and billing events belong in
   database-backed audit tables. Loki stores operational logs for diagnosis; it
   is not the product audit database.

## Priority Roadmap

### P0 - Backend API Structured Request Logs

Objective: make API traffic queryable in production.

Status: implemented for the FastAPI request lifecycle. `LoggingMiddleware`
emits `api.request_started`, `api.request_completed`, and
`api.request_exception` as structured log events, and backend production logging
no longer depends on local rotating application log files.

Tasks:

1. Replace string-only request/response logs in `LoggingMiddleware` with
   structured event logs.
2. Include at least:
   - `event`: `api.request_started` / `api.request_completed`;
   - `request_id`;
   - `method`;
   - `path`;
   - `status_code`;
   - `duration_ms`;
   - `client_host`;
   - authenticated `user_id` when available and safe.
3. Do not log request bodies by default.
4. Keep sensitive data filtering as a final safety layer, not the primary
   privacy boundary.
5. Ensure production logs are emitted to stdout/stderr for Fluent collection.

Acceptance criteria:

- 4xx/5xx request logs can be queried by `event`, `status_code`, and `path`.
- successful and failed requests both carry `request_id`.
- no password, token, MusicXML, image, audio, or private file content is logged.
- production backend runtime does not require or create local log files.

### P0 - Guardrails and Frontend Observability Facade

Objective: keep product source clean and create one place for frontend
diagnostics.

Status: partially implemented. The frontend has a vendor-neutral observability
facade, route-level error boundaries report through it, API transport failures
are captured, and `frontend/src` is guarded against scattered `console.*`
calls. Upload, editor load/save, score preview playback, cover audio playback,
downloads, practice realtime/audio setup, and practice report loading now report
unexpected client failures through the facade.

Tasks:

1. Add `frontend/src/lib/observability/`.
2. Implement a vendor-neutral facade:
   - `reportClientError(error, context)`;
   - `reportClientEvent(event, context)`;
   - optionally `reportClientPerformance(metric, context)`.
3. Keep the first implementation no-op or development-safe. Do not add a paid
   vendor SDK such as Sentry.
4. Add an ESLint rule that forbids `console.*` in `frontend/src/**/*`.
   Development scripts under `frontend/scripts/**` may keep console output.
5. Wire route-level `error.tsx` files into `reportClientError`.
6. Wire high-value non-expected client failures:
   - upload workflow unexpected exceptions;
   - editor save/load unexpected exceptions;
   - score detail realtime update failures;
   - share/public playback failures;
   - practice realtime/audio setup failures.

Acceptance criteria:

- `frontend/src` has no uncontrolled `console.*`.
- route crashes are reportable through one facade.
- expected business errors such as invalid credentials, no access, expired
  share, or quota exceeded are not reported as system exceptions.

### P0 - Request Correlation Contract

Objective: connect browser failures, API failures, and worker follow-up.

Status: implemented for the current async operation model. Backend-generated `request_id` remains the
source of truth for HTTP requests, frontend error normalization preserves
`request_id` when an error object provides it, and import/render/playback/mail
async operation records now persist `originating_request_id` for request-created
work. Score deletion cleanup persists `deletion_request_id` and exposes it as
`originating_request_id` through the ops API.

Tasks:

1. Define the current contract explicitly:
   - `request_id` is per HTTP request;
   - future `trace_id` may span browser/API/worker chains.
2. Keep backend-generated `request_id` as the current source of truth.
3. Do not make the frontend generate request IDs in the first phase.
4. Ensure frontend API errors retain backend `request_id`.
5. Include `request_id` in frontend observability reports when available.
6. For async work created by a request, persist the originating `request_id`
   when the relevant table already has an appropriate metadata field, or add a
   dedicated field in a later migration.

Acceptance criteria:

- a user-reported API failure can be traced from frontend error/report to
  backend request log by `request_id`.
- async operation records can eventually be linked back to the request that
  created them.

### P1 - Worker and Outbox Structured Logs

Objective: make async work diagnosable without reading free-form strings.

Status: partially implemented. Import, render, playback, mail, dispatch, score
deletion cleanup, API exception boundaries, runtime startup, notification,
realtime, avatar, practice runtime, and derived-asset retention entrypoints now
emit structured lifecycle events with stable operation IDs and context where
available.

Detailed audit:
`docs/backend-structured-logging-audit.md`.

Tasks:

1. Standardize task log events:
   - `import.started`, `import.completed`, `import.failed`;
   - `render.started`, `render.completed`, `render.failed`;
   - `playback.started`, `playback.completed`, `playback.failed`;
   - `mail.started`, `mail.sent`, `mail.failed`;
   - `score_deletion.started`, `score_deletion.completed`,
     `score_deletion.failed`.
2. Include stable context:
   - `task_id`;
   - `job_id`;
   - `outbox_id`;
   - `score_id`;
   - `revision_id`;
   - `attempt`;
   - `max_attempts`;
   - `next_retry_at`;
   - `internal_error_class`.
3. Normalize `get_task_logger`, standard `logging`, and `app.core.logger`
   behavior for worker processes.

Acceptance criteria:

- an ops user can diagnose a failed async operation without reading raw stack
  traces first.
- task logs and `/api/v1/ops/async-operations` use compatible status and error
  vocabulary.

### P1 - User/Internal Error Semantics Audit

Objective: prevent backend and technology details from leaking into product UI.

Status: partially implemented. High-risk score, review, share, public,
library, and practice loading/error surfaces use stable frontend error
components and translations. Practice realtime errors no longer fall back to
backend free-text messages.

Tasks:

1. Audit user-facing pages and hooks:
   - `/my-scores`;
   - `/library`;
   - `/score/*`;
   - `/review/*`;
   - `/share/*`;
   - `/public/*`;
   - `/upload`;
   - `/settings/*`.
2. Ensure user-visible errors come from `public_code` translation or stable
   frontend fallback messages.
3. Ensure internal reasons are visible only in logs and ops endpoints.
4. Remove any remaining direct `error.message` display for ordinary users.

Acceptance criteria:

- ordinary users never see Redis, worker, storage, mail provider, rendering
  engine, OCR engine, stack trace, table name, or exception class names.
- ops endpoints remain able to expose `internal_reason` and diagnostics.

### P1 - Metrics Baseline

Objective: expose system health and degradation signals through Prometheus.

Status: started. The API now exposes `/metrics` in Prometheus text format and
records bounded-cardinality HTTP request counters, latency histograms,
async-operation backlog gauges, and active realtime connection gauges. Initial
Grafana dashboard requirements are documented in
`docs/grafana-dashboard-requirements.md`. Async operation age and recent
completion-duration gauges are derived from database state instead of worker
process memory. Storage/quota metrics remain to be added.

Tasks:

1. Define initial backend metrics:
   - API request count by route/status; implemented;
   - API request latency histogram; implemented;
   - import jobs by state;
   - render/playback/mail outbox records by state;
   - async failure rates by kind;
   - oldest open/processing async operation age by kind; implemented;
   - recent completed operation duration by kind; implemented;
   - active realtime connections; implemented;
   - storage quota usage check failures.
2. Expose metrics through a Prometheus scrape endpoint; implemented at
   `/metrics`.
3. Create initial Grafana dashboard requirements; implemented.
4. Keep metrics free of high-cardinality raw IDs such as every `score_id` or
   `revision_id`.

Acceptance criteria:

- Prometheus can detect elevated API 5xx rate, pending import backlog, render
  failure spikes, and realtime connection anomalies.
- Grafana can show service health without querying logs.

### P1 - Container Logging Mode

Objective: align production runtime with container/Kubernetes expectations.

Target stack:

`container stdout/stderr -> Fluent Bit -> Loki -> Grafana`.

Detailed deployment and label policy:
`docs/k8s-logging-loki-fluent-bit-plan.md`.

Tasks:

1. Keep stdout/stderr JSON as the only production backend logging target.
2. Remove backend local daily log file output from production behavior.
3. Keep readable console/file logs only for local development if explicitly
   enabled.
4. Document Fluent Bit parsing/routing rules:
   - parse JSON logs from API, worker, beat, and frontend server containers;
   - label only low-cardinality infrastructure fields;
   - keep `request_id`, `originating_request_id`, operation IDs, and resource
     IDs in the log body.

Acceptance criteria:

- production containers do not rely on persistent local log files.
- backend production code does not create or rotate local application log files.
- local development can still use readable console logs.
- Loki queries can find a request by `request_id` in log content without making
  `request_id` a label.

### P2 - Production Observability Integrations

Objective: connect the facades to the self-hosted production observability
stack.

Tasks:

1. Deploy Fluent Bit as the Kubernetes log collector.
2. Send structured stdout/stderr logs to Loki.
3. Use Grafana for log exploration and dashboard links.
4. Integrate metrics with Prometheus and Grafana.
5. Add OpenTelemetry instrumentation after request/outbox correlation is
   stable.
6. Send traces to Tempo.
7. Add required env/configuration without fallback DSNs.

Acceptance criteria:

- missing production observability configuration fails clearly.
- no events are sent to a test or default project by accident.
- frontend/browser errors are not sent to Sentry; they are handled by the
  existing facade and a future self-hosted ingestion path if needed.

### P2 - Audit and Analytics Event Split

Objective: prevent observability streams from becoming a single noisy bucket.

Tasks:

1. Define audit events for security and ownership-sensitive actions:
   - login failures;
   - password changes;
   - score deletion/restoration;
   - share creation/revocation;
   - collaborator invite and permission changes.
2. Define product analytics separately:
   - upload started/completed;
   - practice session completed;
   - pricing interaction;
   - onboarding milestones.
3. Keep runtime logs focused on service health and diagnostics.

Acceptance criteria:

- audit events are suitable for security review.
- analytics events are suitable for product analysis.
- runtime logs are not polluted with every business action.

## Recommended Execution Order

1. Upgrade backend API request logs to structured stdout/stderr fields.
2. Add frontend observability facade and `no-console` source guard.
3. Wire frontend route error boundaries and high-value unexpected failures to the
   facade.
4. Define and document the request correlation contract.
5. Upgrade worker/outbox logs to structured events.
6. Audit user-visible errors for internal detail leakage.
7. Audit remaining backend free-form logs and convert high-value application
   modules to structured events.
8. Remove production local backend log files and finalize Fluent Bit -> Loki ->
   Grafana logging mode.
9. Add Prometheus metrics baseline and Grafana dashboard requirements.
10. Add Fluent Bit -> Loki -> Grafana deployment requirements.
11. Add OpenTelemetry -> Tempo tracing only after the local facades and
    correlation contracts are stable.

## Non-goals For The Next Iteration

- Do not add a full frontend ops dashboard.
- Do not add a vendor SDK before the project has a stable observability facade.
- Do not log request/response bodies by default.
- Do not add fallback observability configuration that could silently send data
  to the wrong environment.
- Do not expose technical dependency names in product UI.

## Open Questions

- Should the frontend generate a request ID for every API request, or should it
  only consume backend-generated IDs for now?
- Should audit events live in the existing ops audit model or a separate
  product audit stream?
- What self-hosted browser error ingestion path should receive frontend
  observability facade events if product needs outgrow route-level logs?

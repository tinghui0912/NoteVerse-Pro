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
- Fluent/Fluent Bit for log collection;
- Elasticsearch + Kibana for log storage and search;
- Prometheus + Grafana for metrics and dashboards;
- backend services must write production logs to stdout/stderr only and must not
  depend on local log files.

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

- no explicit client-to-server request correlation beyond consuming backend
  `X-Request-ID`;
- no production error reporting vendor has been selected or connected.

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

- API lifecycle logs are still mostly string messages, not stable structured
  fields;
- standard `logging`, Celery task logger, and `app.core.logger` are mixed across
  modules;
- task logs do not consistently include stable context fields such as
  `job_id`, `outbox_id`, `score_id`, `revision_id`, `attempt`, and
  `next_retry_at`;
- production containers still write daily local log files in addition to stdout;
  this should be removed for the Kubernetes deployment target;
- request-level correlation does not yet extend cleanly into worker/outbox
  execution;
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

7. **Build the facade before choosing the vendor.**
   Sentry, Datadog, Elasticsearch, Kibana, Grafana, and OpenTelemetry should be
   integration targets, not concepts leaked throughout application code.

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
3. Keep the first implementation no-op or development-safe. Do not add Sentry
   yet.
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

Status: partially implemented. Import, render, playback, mail, dispatch, and
score deletion cleanup entrypoints now emit structured lifecycle events with
stable operation IDs and attempt context where available.

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

Tasks:

1. Define initial backend metrics:
   - API request count by route/status;
   - API request latency histogram;
   - import jobs by state;
   - render/playback/mail outbox records by state;
   - async failure rates by kind;
   - active realtime connections;
   - storage quota usage check failures.
2. Expose metrics through a Prometheus scrape endpoint.
3. Create initial Grafana dashboard requirements.
4. Keep metrics free of high-cardinality raw IDs such as every `score_id` or
   `revision_id`.

Acceptance criteria:

- Prometheus can detect elevated API 5xx rate, pending import backlog, render
  failure spikes, and realtime connection anomalies.
- Grafana can show service health without querying logs.

### P1 - Container Logging Mode

Objective: align production runtime with container/Kubernetes expectations.

Tasks:

1. Keep stdout/stderr JSON as the only production backend logging target.
2. Remove backend local daily log file output from production behavior.
3. Keep readable console/file logs only for local development if explicitly
   enabled.
3. Document the intended production collection path:
   `container stdout/stderr -> Fluent/Fluent Bit -> Elasticsearch -> Kibana`.

Acceptance criteria:

- production containers do not rely on persistent local log files.
- backend production code does not create or rotate local application log files.
- local development can still use readable console logs.

### P2 - Vendor Integrations

Objective: connect the facades to production observability tools.

Tasks:

1. Evaluate Sentry for frontend and backend exceptions.
2. Integrate production logs with Fluent/Fluent Bit, Elasticsearch, and Kibana.
3. Integrate metrics with Prometheus and Grafana.
4. Evaluate OpenTelemetry for cross-process tracing after request/outbox
   correlation is stable.
5. Add required env configuration without fallback DSNs.

Acceptance criteria:

- missing production observability configuration fails clearly.
- no events are sent to a test or default project by accident.

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
7. Remove production local backend log files and finalize Fluent -> ES -> Kibana
   logging mode.
8. Add Prometheus metrics baseline and Grafana dashboard requirements.
9. Add Sentry/OpenTelemetry integrations only after the local facades and
   contracts are stable.

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
- Which async tables should persist originating `request_id` in the first
  migration?
- Should audit events live in the existing ops audit model or a separate
  product audit stream?
- Which error-reporting vendor should be used first for frontend/browser
  exceptions: Sentry, Datadog RUM, or another tool?

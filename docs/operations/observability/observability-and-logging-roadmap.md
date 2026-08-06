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
- application runtime contract documented in
  `docs/architecture/runtime/k8s-application-runtime-contract.md`;
- production preflight checklist documented in
  `docs/operations/deployment/k8s-production-preflight-checklist.md`;
- Kubernetes deployment runbook documented in
  `docs/operations/deployment/k8s-deployment-runbook.md`;
- Kubernetes Secret and storage contract documented in
  `docs/operations/deployment/k8s-secrets-and-storage-template.md`;
- repository quality checks documented in
  `docs/engineering/guides/repository-quality-checks.md`;
- CI/CD release strategy documented in
  `docs/operations/release/cicd-release-strategy.md`;
- container image build strategy documented in
  `docs/operations/release/container-image-build-strategy.md`;
- Fluent Bit for log collection;
- Loki + Grafana for log storage, querying, and visualization;
- Prometheus + Grafana for metrics and dashboards;
- OpenTelemetry + Tempo for distributed tracing after request/outbox
  correlation is stable; see `docs/operations/observability/opentelemetry-tempo-tracing-plan.md`;
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
  `apps/customer-web/src/lib/observability/`.
- Route-level error boundaries and API transport failures are wired into the
  facade.
- ESLint blocks new `console.*` usage in `apps/customer-web/src`.

Missing:

- no self-hosted browser error ingestion endpoint has been selected or
  connected behind the frontend observability facade.

### Backend

The backend already has a solid observability foundation.

Implemented:

- centralized Loguru setup in `app.core.logger`;
- explicit `LOG_FORMAT=console|json` selection;
- local-readable console logs and production JSON stdout;
- `X-Request-ID` generation/propagation;
- request/response lifecycle logging middleware;
- standard-library framework logging and Celery worker/beat logs are routed
  through the same stdout sink;
- centralized exception handlers;
- public/internal error response separation;
- async operation diagnostics for import, render, playback, mail, and score
  deletion;
- durable outbox and Celery beat maintenance for recoverable async work.

Remaining gaps:

- some task logs still need richer stable context fields such as
  `job_id`, `outbox_id`, `score_id`, `revision_id`, `attempt`, and
  `next_retry_at`;
- audit events, analytics events, and runtime logs are not fully separated.

### Current Runtime Reality

The repository contains Kubernetes manifests and application configuration for
Fluent Bit, Loki, Tempo, Grafana, and the OpenTelemetry Collector. Those files
do not, by themselves, prove that the observability runtime is deployed or
healthy in an environment.

At the time this roadmap was consolidated, staging configured
`OTEL_TRACING_ENABLED=true` and an OTLP Collector endpoint while the referenced
`observability` namespace was absent. This is a P0 configuration defect:
applications must not claim tracing is enabled when no reachable Collector is
available. Tracing exporters must remain fail-open for customer traffic, but
the missing pipeline must be visible through deployment validation and platform
alerts.

There is also a semantic defect in the current application logger:
`trace_id` is presently used for a short request-correlation value. It is not a
real OpenTelemetry trace ID and must not be used to link Loki logs to Tempo.
The implementation work below separates the two concepts before trace links
are enabled again.

## Principles

1. **Observability is not console logging.**
   Frontend code should report errors through an observability facade, not
   through browser console output.

2. **Users must not see implementation details.**
   Product UI must never expose Redis, worker, storage, Verovio, Legato,
   PaddleOCR, WebSocket internals, SMTP, S3, stack traces, or exception strings.

3. **Public and internal error information are separate contracts.**
   Public APIs return stable `public_code`, `public_message`, and `request_id`.
   Raw internal reason/detail belongs only in logs; operator APIs expose a
   separate, white-listed diagnostic contract.

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
   such as `service`, `environment`, `namespace`, `container`, and `level`.
   High-cardinality fields such as `request_id`, `user_id`,
   `score_id`, `revision_id`, `job_id`, `outbox_id`, email addresses, storage
   keys, pod names, and file hashes must stay in the structured JSON log body,
   not Loki labels.

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
are captured, and `apps/customer-web/src` is guarded against scattered `console.*`
calls. Upload, editor load/save, score preview playback, cover audio playback,
downloads, practice realtime/audio setup, and practice report loading now report
unexpected client failures through the facade.

Tasks:

1. Add `apps/customer-web/src/lib/observability/`.
2. Implement a vendor-neutral facade:
   - `reportClientError(error, context)`;
   - `reportClientEvent(event, context)`;
   - optionally `reportClientPerformance(metric, context)`.
3. Keep the first implementation no-op or development-safe. Do not add a paid
   vendor SDK such as Sentry.
4. Add an ESLint rule that forbids `console.*` in `apps/customer-web/src/**/*`.
   Development scripts under `apps/customer-web/scripts/**` may keep console output.
5. Wire route-level `error.tsx` files into `reportClientError`.
6. Wire high-value non-expected client failures:
   - upload workflow unexpected exceptions;
   - editor save/load unexpected exceptions;
   - score detail realtime update failures;
   - share/public playback failures;
   - practice realtime/audio setup failures.

Acceptance criteria:

- `apps/customer-web/src` has no uncontrolled `console.*`.
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

Status: partially implemented. Import, import pipeline, render, playback, mail,
dispatch, score deletion cleanup, API exception boundaries, runtime startup,
notification, realtime, avatar, practice runtime, and derived-asset retention
entrypoints now emit structured lifecycle events with stable operation IDs and
context where available. Text recognition/integration, OCR subprocess execution,
LEGATO OMR, and practice matchmaker diagnostics also use structured events.
Standard-library framework logs and Celery worker/beat logs are routed through
the shared stdout sink, so K8s `LOG_FORMAT=json` produces JSON container logs.
Guardrails now prevent new free-form application logs from creeping back in via
`backend/tests/test_structured_logging_contract.py`.

Detailed audit:
`docs/engineering/reviews/backend-structured-logging-audit.md`.

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
3. Keep standard `logging`, Celery framework logs, and `app.core.logger`
   behavior unified through `app.core.logging_setup`.

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
3. Ensure raw internal reasons are visible only in logs. Operator endpoints
   may expose only stable, white-listed diagnostic code, stage, classification,
   retryability, and lifecycle state.
4. Remove any remaining direct `error.message` display for ordinary users.

Acceptance criteria:

- ordinary users never see Redis, worker, storage, mail provider, rendering
  engine, OCR engine, stack trace, table name, or exception class names.
- ops endpoints expose only the controlled diagnostic contract and never raw
  `internal_reason` text.

### P1 - Metrics Baseline

Objective: expose system health and degradation signals through Prometheus.

Status: started. The API now exposes `/metrics` in Prometheus text format and
records bounded-cardinality HTTP request counters, latency histograms,
async-operation backlog gauges, and active realtime connection gauges. Initial
Grafana dashboard requirements are documented in
`docs/operations/observability/grafana-dashboard-requirements.md`. Async operation age and recent
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
`docs/operations/observability/k8s-logging-loki-fluent-bit-plan.md`.

Tasks:

1. Keep stdout/stderr JSON as the only production backend logging target.
2. Remove backend local daily log file output from production behavior.
3. Keep readable console logs only for local development through
   `LOG_FORMAT=console`.
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

Status: planning documents exist for the observability platform and application
runtime boundaries. See:

- `docs/operations/observability/k8s-observability-deployment-skeleton.md`;
- `docs/architecture/runtime/k8s-application-runtime-contract.md`.

Tasks:

1. Deploy Fluent Bit as the Kubernetes log collector.
2. Send structured stdout/stderr logs to Loki.
3. Use Grafana for log exploration and dashboard links.
4. Integrate metrics with Prometheus and Grafana.
5. Add OpenTelemetry instrumentation after request/outbox correlation is
   stable. Use `docs/operations/observability/opentelemetry-tempo-tracing-plan.md` as the implementation
   contract.
6. Send traces to Tempo.
7. Add required env/configuration without fallback DSNs.

Acceptance criteria:

- missing production observability configuration fails clearly.
- no events are sent to a test or default project by accident.
- apps/customer-web/browser errors are not sent to Sentry; they are handled by the
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
11. Add Grafana Loki query runbook for request, async operation, import,
    derived asset, realtime, and practice investigations.
12. Add Kubernetes observability deployment skeleton under
    `deploy/observability` and document release boundaries.
13. Add Kubernetes application runtime contract for API, worker, beat, and
    frontend ports, probes, metrics, env, and fail-fast rules.
14. Add repository quality entry point for Kubernetes application manifest
    guardrails.
15. Add OpenTelemetry -> Tempo tracing only after the local facades and
   correlation contracts are stable, following
   `docs/operations/observability/opentelemetry-tempo-tracing-plan.md`.

## Current Execution Plan

This section supersedes the historical ordering above for remaining work. The
older roadmap entries remain as a record of completed baseline work. Do not
start asynchronous trace propagation or browser tracing before P0 and P1 have
passed their acceptance gates.

**Implementation status (2026-08):** P0 is complete and verified in staging.
The P1 correlation data path is verified: the correlation smoke proves that a
valid request ID can be found in Loki, that the associated log carries a real
W3C trace ID that resolves in Tempo, and that successful health checks do not
create normal application request logs. The P2 event-field privacy allowlist
is now a default-deny structured-field policy: unreviewed and sensitive fields
are omitted, raw exception values and stack traces are not written to stdout,
and a source-level regression test requires every explicit `logger.bind(...)`
field to be classified. This policy passed the backend quality gate and its
digest-pinned staging release: runtime stdout contains the reviewed HTTP event
fields but no forbidden file/storage/text fields, raw exception value, or stack
trace. The Loki datasource now derives Tempo navigation only from a validated
32-character trace ID, and Practice WebSockets record bounded accepted/ready/
terminal lifecycle events without audio or control payloads. P3 is implemented
locally: the four durable operation records persist vetted `traceparent` and
optional `tracestate`, relay dispatches create producer spans, worker attempts
create fresh consumer spans, and each relay delivery gets a unique Celery task
ID. The P3 schema migration (`0036_async_trace_context`) is deployed in
staging, and the local GPU worker is running against the same PostgreSQL,
Redis, and object-storage dependencies while consuming scheduled maintenance
tasks. The staging correlation smoke now waits for the API, Loki, Fluent Bit,
and Tempo workloads to be Ready before it sends a request; it verified an API
request from Loki into Tempo after the migration. P3 acceptance is also
verified with a real import: the persisted trace context links the initiating
HTTP server span, the relay's `noteverse.import.dispatch` producer span, and
the worker's `noteverse.import.process` consumer span in one trace. Scheduled
scans now create an independent `noteverse.scheduler.scan` root only after
their scan lock is acquired, while lock-skipped scans remain metric/log events
to avoid high-volume empty traces. Unit coverage verifies durable-parent
restoration for distinct retry attempts, malformed-context fallback, worker
process tracing initialization, and scheduler roots. The remaining P3 release
gate is a controlled retry smoke in staging: it must prove that separate
worker attempts export separate consumer spans and that the corresponding API,
relay, and worker logs can be found in Loki by business operation ID and linked
to the Tempo trace. P4 remains planned work.

Use `scripts/minikube_observability_correlation_smoke.ps1` after each staged
observability release to verify the P1 request-to-log-to-trace contract.

### P0 - Restore Runtime Truthfulness

**Objective:** eliminate staging configurations that assert a telemetry
pipeline exists when its runtime is unavailable, and remove invalid log-to-trace
navigation.

1. Deploy and verify the observability runtime required by the selected
   environment: OpenTelemetry Collector, Fluent Bit, Loki, Tempo, Grafana, and
   their required storage and credentials.
2. Add release/preflight validation that permits `OTEL_TRACING_ENABLED=true`
   only when the intended Collector Service is rendered and becomes Ready.
   Environments deliberately without a Collector must explicitly set
   `OTEL_TRACING_ENABLED=false`; there is no implicit endpoint fallback.
3. Keep exporter failures fail-open for customer traffic. Bound exporter queues
   and error logging, export pipeline-health telemetry, and alert when traces
   or logs are being dropped.
4. Disable the Loki-to-Tempo derived field until logs contain genuine
   OpenTelemetry trace IDs. A request correlation ID is queryable in Loki but
   is never a Tempo link.

**Acceptance gate:** a staging request produces no OTLP `UNAVAILABLE` noise;
the deployed Collector, Loki, and Tempo are healthy; and the release checker
rejects tracing enabled against an unavailable pipeline.

### P1 - Correct Correlation and Log Schema

**Objective:** make request correlation, trace correlation, and resource
identity distinct, stable contracts.

1. Rename `trace_id_var` to `request_id_var`; generate a complete UUID or
   ULID rather than an eight-character token.
2. Validate inbound `X-Request-ID` values for bounded length and safe syntax.
   Reject malformed values and create a server request ID. Preserve a valid
   client-provided value only under the documented request-ID contract.
3. Add `trace_id` and `span_id` to JSON logs only by extracting a valid current
   OpenTelemetry Span Context. `trace_id` is 32 lowercase hexadecimal
   characters and `span_id` is 16; neither is synthesized when no Span exists.
4. Version the JSON schema and bind stable resource fields to every first-party
   service log: `schema_version`, `service_name`, `service_version`, and
   `environment`. Use `deployment.environment.name` in OTLP resource
   enrichment.
5. Restore the Grafana derived field only after it matches a real 32-character
   trace ID and staging verifies the link into Tempo.

**Acceptance gate:** one API request can be found by `request_id` in Loki and,
when sampled, its log links to the matching Trace in Tempo. No query, dashboard,
or alert treats `request_id` as a trace ID.

### P2 - Noise, Privacy, and Query Governance

**Objective:** preserve one useful lifecycle event per request while preventing
accidental sensitive-data retention or costly Loki indexes.

1. Disable Uvicorn access logging for API, practice, control-plane, and
   observability-exporter processes. Keep structured application lifecycle
   events and `uvicorn.error` through the common stdout pipeline.
2. Exclude successful `/health/*` and `/metrics` requests from application
   request logs and OpenTelemetry instrumentation. Health failures remain
   visible through Kubernetes, Gateway, and platform signals.
3. Replace redaction-only protection with a documented event-field allowlist,
   denylist, and regression tests. Do not log bodies, credentials, cookies,
   tokens, MusicXML, media bytes, storage keys, raw exception payloads, or
   unnecessary personal data.
4. Curate Loki labels to stable low-cardinality dimensions only:
   `cluster`, `environment`, `namespace`, `service`, `container`, and `level`.
   Keep request, trace, user, task, operation, pod, and resource identifiers in
   the JSON body or structured metadata.
5. Update dashboard, query, and runbook terminology from `frontend` to
   `customer-web` and distinguish customer-web, platform-admin, API, practice,
   worker, beat, control plane, and exporter workloads.

**Acceptance gate:** a normal request yields one lifecycle log event; successful
probes do not create routine INFO logs or spans; privacy regression tests pass;
and Loki queries never depend on high-cardinality labels.

### P3 - Outbox and Celery Trace Context Model

**Objective:** trace asynchronous work without confusing durable business
correlation with transient task execution.

1. Define a durable context model for `request_id`, `operation_id`, `job_id`,
   `outbox_id`, `task_id`, and `attempt`.
2. Persist W3C `traceparent` and optional `tracestate` as message-creation
   context on durable outbox records. Do not persist unreviewed baggage.
3. Have the relay create producer spans and workers create a fresh consumer
   span for every attempt. For this project's current one-outbox-to-one-task
   delivery, use the durable message context as the parent. Use a Span Link
   instead when batching, fan-out, retry semantics, or an independent ambient
   context would make a parent-child tree misleading.
4. Instrument Celery initialization explicitly and test context extraction in
   worker processes. Do not rely on in-memory context or broker-specific
   behavior as the durable source of truth.
5. Define independent roots for scheduled maintenance work that has no HTTP
   origin, while retaining its operation and scheduler identifiers.
6. Validate `traceparent` and bounded `tracestate` before persistence. Never
   persist baggage; a malformed or absent context must create an independent
   trace rather than fail business work.

**Acceptance gate:** an import or derived-asset operation can be followed from
the initiating HTTP request to relay and worker attempts in Tempo, with retries
shown as separate attempts and all business identifiers available in logs.

### P4 - Platform Reliability, Retention, and Cost

**Objective:** operate the observability stack as production infrastructure,
not merely as a set of installed charts.

1. Add platform dashboards and alerts for Collector acceptance/export failures,
   Fluent Bit drops, Loki ingestion/query/object-storage failures, Tempo
   receive/store/query failures, and Prometheus scrape failures.
2. Define environment-specific sampling, log and trace retention, object-store
   lifecycle policies, capacity budgets, and an owner for reviewing them.
3. Evaluate SQLAlchemy, outbound HTTP, Redis, and Celery instrumentation one
   integration at a time, with explicit attribute allowlists and overhead
   checks. Do not instrument practice audio chunks or other high-volume payload
   paths indiscriminately.
4. Keep browser telemetry behind the existing vendor-neutral facade. Evaluate
   a self-hosted ingestion path only after backend correlation and retention are
   stable; Sentry remains out of scope.

**Acceptance gate:** platform dashboards detect an intentional telemetry
failure, alerts reach the configured operations channel, data retention follows
the documented lifecycle, and a staging smoke test validates logs, traces,
metrics, and storage persistence end to end.

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

# Kubernetes Application Runtime Contract

This document defines the Kubernetes runtime contract for NoteVerse application
pods. It complements the observability stack documents:

- `docs/operations/observability/observability-platform.md`
- `docs/operations/observability/logging-pipeline.md`
- `docs/operations/observability/distributed-tracing.md`

The goal is to make production deployment explicit: ports, probes, metrics,
environment variables, runtime checks, and Prometheus discovery should be
defined by contract, not by tribal knowledge.

## Workloads

### `backend-api`

Purpose:

- FastAPI HTTP API;
- authentication, score, review, Guest Preview, realtime SSE, ops endpoints, and
  score fingering generation;
- Prometheus metrics endpoint.

Runtime:

- container command: `api`;
- container port: set `PORT` explicitly and expose the same port through the
  Service;
- HTTP paths:
  - liveness: `/health/live`;
  - readiness: `/health/ready`;
  - metrics: `/metrics`;
  - API prefix: `/api/v1`.

Kubernetes probes:

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: http
readinessProbe:
  httpGet:
    path: /health/ready
    port: http
```

Readiness semantics:

- database and storage quota policy failures return `503`;
- Redis failure returns degraded readiness but still `200`, because the API can
  serve many read/user flows while async and realtime features degrade;
- user-facing API responses must stay stable and must not expose Redis, worker,
  storage, mail, renderer, model, or tracing implementation details.

Prometheus discovery:

- expose a Service using the configured application name, for example
  `noteverse-backend-api`;
- attach low-cardinality labels:
  - `app.kubernetes.io/name: noteverse`;
  - `app.kubernetes.io/component: backend-api`;
  - `app.kubernetes.io/part-of: noteverse`;
- add a ServiceMonitor for `/metrics`.

### `backend-worker`

Purpose:

- Celery worker for import, render, playback, mail, cleanup, and async
  operations.

Runtime:

- container command: `worker`;
- no HTTP Service;
- no liveness/readiness HTTP probe until a real worker health endpoint exists;
- startup must run `python scripts/check_runtime.py --role worker`;
- failed runtime checks should fail the pod fast.

Required runtime dependencies:

- application database connection;
- Redis broker/result backend;
- writable work root;
- OMR engine files;
- render engine dependencies;
- playback renderer and soundfont;
- offline node-local model caches.

Observability:

- structured logs go to stdout/stderr;
- task and outbox state is visible through ops APIs and backend `/metrics`;
- Prometheus should not scrape a fake worker HTTP endpoint.

Scaling:

- horizontal worker scaling is allowed only after GPU/model contention and
  queue behavior are explicitly tested;
- keep `CELERY_WORKER_CONCURRENCY` explicit per environment.

### `backend-beat`

Purpose:

- Celery beat scheduler for outbox dispatch, maintenance, cleanup, and
  retention tasks.

Runtime:

- container command: `beat`;
- no HTTP Service;
- exactly one production replica until the database scheduler lock is validated
  with staging traffic;
- startup must run `python scripts/check_runtime.py --role beat`;
- failed runtime checks should fail the pod fast.

State:

- beat uses an `emptyDir` work directory for Celery's transient schedule file;
- Postgres/outbox tables are the durable scheduling source of truth;
- do not use a beat PVC unless the scheduler design changes and a new ADR explains why.
- scheduler scans are protected by PostgreSQL job-scoped advisory locks so the
  code path can later support multiple Beat replicas without duplicate
  dispatch.

### `frontend`

Purpose:

- Next.js web application;
- SSR/API rewrite layer;
- browser client for API and realtime events.

Runtime:

- container command should be production `next start`, not `next dev`;
- set the frontend port explicitly through the container/runtime environment;
- expose one HTTP Service for browser traffic.

Required environment variables:

- Production `/api` routing is owned by Gateway; development-only Next rewrites use `NEXT_BACKEND_ORIGIN`.

Development-only environment variables:

- `NEXT_ALLOWED_DEV_ORIGINS`;
- polling variables such as `WATCHPACK_POLLING` and `CHOKIDAR_USEPOLLING`.

Production frontend builds must fail fast when required runtime config is
missing. Customer API prefix and session names come from the generated
versioned browser protocol, not environment variables. OpenAPI route metadata
owns browser-native realtime and media paths.

Browser API and realtime calls use same-origin `/api/v1`. In production, the
Gateway/HTTPRoute rules route the broader `/api/v1` prefix to the backend API.
Long-lived SSE responses must be supported without buffering. This keeps
Customer Web images environment-neutral and avoids baking public API origins
into the browser bundle.

## Configuration Ownership

### Kubernetes Secrets

Backend application database access is configured by one PostgreSQL psycopg
`DATABASE_URL` (`postgresql+psycopg://...`). Domain, application, repository, API,
Control Plane, worker and maintenance persistence use process-owned synchronous
engines and SessionFactory instances built by `app.platform.db.engine`. Each
runtime loads its own settings. Alembic loads only `MigrationSettings` and uses
synchronous PostgreSQL execution. The `database` runtime check validates
this application database authority for each role.

FastAPI executes ordinary database-backed path operations in worker threads.
Function-scoped database dependencies close the request Session before response
body streaming begins.
Realtime SSE remains asynchronous for LISTEN, wake-ups and connection lifetime;
catch-up batches run off the event loop in their own short-lived synchronous Sessions.
`SCHEDULER_LOCK_DATABASE_URL` configures the Beat advisory-lock session and retains
its direct PostgreSQL or session-pooling policy.

Every process references only its own credential keys. The
[Settings Ownership matrix](settings-ownership.md) defines exact Secret names,
keys and Pydantic schemas. The [Database Role contract](database-role-ownership.md)
defines explicit table/column privileges and provisioning order. The migration
Job owns schema changes and receives only `noteverse-migrator-secret`.
Long-running processes use their separate restricted database roles. Public
settings never enter Secrets. Registry pull and TLS Secrets have infrastructure
ownership and are not process environment inputs.

### Kubernetes ConfigMaps

| Process | ConfigMap |
| --- | --- |
| Customer API | `noteverse-customer-api-config` |
| Control Plane | `noteverse-control-plane-config` |
| Worker | `noteverse-worker-config` |
| Beat | `noteverse-beat-config` |
| Exporter | `noteverse-observability-config` |
| Model preparation | `noteverse-model-assets-config` |
| Migrator | none |

Each ConfigMap contains only non-credential fields from that process's Settings.
Worker owns resource processing, model paths, mail sender, delivery and maintenance
policy. Beat owns schedule and leadership policy. Control Plane owns its browser
policy and Ops delivery configuration. Exporter owns metrics policy. Customer API
owns customer origins, resource admission and delivery policy. Model preparation
owns model paths and controlled online cache hydration; optional download access
comes only from `noteverse-model-assets-secret` (`HF_TOKEN`). PaddleOCR receives
local model paths and an allowlist of operating-system variables, with no Worker
credential inheritance. Frontend configuration remains public origin values.

Versioned algorithm profiles belong to reviewed source modules. ConfigMap values
do not redefine engine identity, render profiles or browser protocol identities.
`check_k8s_config_ownership.py` validates rendered application and GitOps overlays
against the generated runtime deployment contract. Release-package validation and
exporter manifest checks use the same rules.

### Mounted Volumes

Production should make volume intent explicit:

- node-local model cache: read-only in application pods, mounted at the
  configured model root;
- work volume: writable temporary runtime data;
- durable objects: one configured ObjectStorage namespace;
- no local backend log volume in production. Logs go to stdout/stderr and are
  collected by Fluent Bit.

## Metrics Contract

Current Prometheus scrape target:

```text
backend-api /metrics
```

Recommended ServiceMonitor shape:

```yaml
selector:
  matchLabels:
    app.kubernetes.io/name: noteverse
    app.kubernetes.io/component: backend-api
endpoints:
  - port: http
    path: /metrics
    interval: 30s
```

Do not use high-cardinality labels in metrics:

- no `request_id`;
- no `user_id`;
- no `score_id`;
- no `job_id`;
- no `revision_id`;
- no storage keys or hashes.

Workers and beat should not expose synthetic HTTP metrics until there is a
dedicated worker metrics design. Their operational state currently flows
through durable async operation tables, API metrics, and structured logs.

## Health Contract

API:

- liveness answers whether the process can answer HTTP;
- readiness answers whether the API should receive traffic;
- Redis degraded state must be observable but should not automatically remove
  all API traffic from service.

Worker:

- startup runtime checks are the current health gate;
- failures after startup are represented through task/outbox records and logs;
- operational health uses claim/outbox progress and logs; no ad-hoc per-Pod
  HTTP health endpoint is implied.

Beat:

- exactly one production scheduler until the database scheduler lock is
  validated under multi-replica staging traffic;
- startup runtime checks are the current health gate;
- PostgreSQL job-scoped advisory locks are the preferred HA path before any
  Kubernetes Lease leader-election model.

## Fail-Fast Rules

Required configuration must be explicit in production:

- missing backend secrets/config should fail `Settings()` validation or
  `scripts/check_runtime.py`;
- missing frontend public/runtime config should fail application startup/build;
- invalid CORS origins should fail backend startup;
- The concrete adapter requires an endpoint, bucket, access key, and
  secret key;
- OMR and render engine paths must be validated by worker runtime checks;
- no application image should silently default to a development backend,
  database, Redis or S3 bucket. Customer cookie/header names are fixed by the
  versioned browser protocol source.

Known follow-up:

- `docker/backend/entrypoint.sh` currently uses `${PORT:-8000}` for development
  convenience. Production manifests should set `PORT` explicitly; the script can
  later be tightened if the production image keeps using this entrypoint.

## Service Labels

Use one consistent label set:

```yaml
app.kubernetes.io/name: noteverse
app.kubernetes.io/part-of: noteverse
app.kubernetes.io/component: backend-api | backend-worker | backend-beat | frontend
app.kubernetes.io/instance: <release-name>
```

Prometheus, Loki, and Grafana dashboards should rely on these low-cardinality
labels. High-cardinality resource identifiers belong in structured log bodies
or database-backed ops APIs, not Kubernetes labels.

## Deployment Order

1. Deploy PostgreSQL, Redis, object storage, and node-local model caches.
2. Run database migrations as a dedicated one-shot job.
3. Deploy `backend-api` with probes and ServiceMonitor.
4. Deploy `backend-worker` with role runtime checks.
5. Deploy singleton `backend-beat` with role runtime checks.
6. Deploy `frontend` with explicit server-side rewrite and auth cookie env.
7. Verify:
   - `/health/live`;
   - `/health/ready`;
   - `/metrics`;
   - API request logs in Loki;
   - worker logs in Loki;
   - outbox metrics in Prometheus;
   - realtime SSE over the production Gateway path.

## Deployment Skeleton

The first application deployment skeleton exists under `deploy/application/`:

- `base/`: shared application workload boundaries;
- `overlays/staging/`: staging shape template;
- `overlays/production/`: production shape template with API/frontend HPA,
  PodDisruptionBudgets, and GPU worker scheduling.

Validate manifests before creating environment-specific private overlays:

```bash
kubectl kustomize deploy/application/base
kubectl kustomize deploy/application/overlays/staging
kubectl kustomize deploy/application/overlays/production
python scripts/check_k8s_application_manifests.py
```

Private release rendering injects environment-specific OCI references, hosts,
TLS identities, Secret references and scheduling configuration without committing
credentials. See `scripts/render_k8s_release_overlay.py`.

Before applying private production manifests, run the strict preflight check in
`docs/operations/deployment/k8s-production-preflight-checklist.md`.

## Container and network isolation

[Container and Network Hardening](container-and-network-hardening.md) defines
numeric UID/GID 10001, read-only filesystems, bounded scratch mounts, default-deny
NetworkPolicy and per-runtime traffic. Gateway routes both Customer and Admin
API traffic directly to their HTTP runtimes. External CIDRs default to empty and
must be explicitly reviewed before external connectivity is enabled.

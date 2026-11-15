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

- sync database connection;
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

- `NEXT_BACKEND_ORIGIN`: backend origin used by Next rewrites.

Development-only environment variables:

- `NEXT_ALLOWED_DEV_ORIGINS`;
- polling variables such as `WATCHPACK_POLLING` and `CHOKIDAR_USEPOLLING`.

Production frontend builds must fail fast when required runtime config is
missing. Customer API prefix and session/CSRF names come from the generated
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
`DATABASE_URL` (`postgresql+psycopg://...`). API and worker execution adapters,
including Alembic, consume the same database identity. Runtime checks report the
API database execution path and worker database execution path independently.
`SCHEDULER_LOCK_DATABASE_URL` configures the Beat advisory-lock session and retains
its direct PostgreSQL or session-pooling policy.

Store these as Secrets:

- `SECRET_KEY`;
- `DATABASE_URL`;
- `SCHEDULER_LOCK_DATABASE_URL` (direct PostgreSQL or PgBouncer session-pooling endpoint only);
- `REDIS_URL`;
- `CELERY_BROKER_URL`;
- `CELERY_RESULT_BACKEND`;
- `S3_ACCESS_KEY_ID`;
- `S3_SECRET_ACCESS_KEY`;
- mail provider API keys such as `RESEND_API_KEY`.

The frontend currently does not require a dedicated Secret. Its required
runtime value is the backend service origin, which belongs in the frontend
ConfigMap. Cookie Secure/SameSite policy and lifetimes remain Backend deployment
policy.

### Kubernetes ConfigMaps

Store non-secret runtime values as ConfigMaps. Use a shared backend baseline
only for values that are safe and meaningful across backend roles, then add
role-specific ConfigMaps for runtime-owned settings:

- shared backend public URLs and origins:
  - `FRONTEND_BASE_URL`;
  - `BACKEND_CORS_ORIGINS`;
  - `TRUSTED_PROXY_CIDRS`;
- shared storage mode and non-secret S3 settings:
  - configured object-store endpoint, bucket and credentials;
  - `S3_ENDPOINT_URL`;
  - `S3_REGION`;
  - `S3_BUCKET`;
  - `S3_FORCE_PATH_STYLE`;
  - `OBJECT_STORAGE_SIGNED_URL_EXPIRE_SECONDS`;
- shared runtime paths:

  - `WORK_ROOT`;
- shared task reliability settings:
  - import, render, playback, mail, realtime, notification, and cleanup interval,
    timeout, retry, batch, and retention settings;
- Worker/model-asset ConfigMap:
  - `MODEL_ROOT`;
  - `PLAYBACK_SOUNDFONT_PATH`;
  - `HF_HOME`;
  - `HF_HUB_OFFLINE`;
  - `TRANSFORMERS_OFFLINE`;
  - `PADDLEOCR_MODEL_ROOT`;
  - `PADDLEOCR_DETECTION_MODEL_DIR`;
  - `PADDLEOCR_RECOGNITION_MODEL_DIR`;
  - `PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR`;
  - `PADDLEOCR_TIMEOUT_SECONDS`;
  - `LEGATO_REPO_PATH`;
  - `LEGATO_PYTHON`;
  - `LEGATO_DEVICE`;
  - `LEGATO_FP16`;
  - `LEGATO_BEAM_SIZE`;
  - `LEGATO_BATCH_SIZE`;
  - `LEGATO_TIMEOUT_SECONDS`;
- model-cache agent:
  - consumes the shared backend and Worker/model-asset ConfigMaps;
  - prepares and verifies playback soundfont targets before
    application pods rely on the node-local model cache;
  - overrides Hugging Face offline flags to online mode only for controlled
    cache hydration.
- Control Plane ConfigMap:
  - `CONTROL_PLANE_AUTH_COOKIE_NAME`;
  - `CONTROL_PLANE_CSRF_COOKIE_NAME`;
  - `CONTROL_PLANE_CSRF_HEADER_NAME`;
  - `CONTROL_PLANE_COOKIE_SECURE`;
  - `CONTROL_PLANE_COOKIE_SAMESITE`;
  - `CONTROL_PLANE_SESSION_EXPIRE_MINUTES`;
  - `CONTROL_PLANE_CORS_ORIGINS`;
- frontend ConfigMap:
  - `NEXT_BACKEND_ORIGIN`;
- versioned algorithm profiles:
  - LEGATO engine/model identity and Verovio SVG output options are sourced
    from reviewed application modules, not Kubernetes environment variables;
  - playback and practice tuning remain source-owned unless an explicitly
    versioned, audited profile rollout is introduced.

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

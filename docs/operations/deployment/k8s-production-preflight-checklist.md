# Kubernetes Production Preflight Checklist

This checklist gates a NoteVerse production deployment before manifests are
applied to a cluster.

It assumes the target runtime shape from:

- `docs/architecture/runtime/k8s-application-runtime-contract.md`
- `docs/operations/deployment/k8s-deployment-runbook.md`
- `docs/operations/deployment/k8s-secrets-and-storage-template.md`
- `deploy/application/`
- `deploy/observability/`

## 1. Manifest Rendering

Render the public templates:

```bash
python scripts/check_k8s_application_manifests.py
```

On Windows development machines, the same check can run through the repository
quality entry point:

```powershell
.\scripts\quality.ps1 -Check k8s
```

In GitHub Actions, the public template check runs in:

```text
.github/workflows/k8s-application-manifests.yml
```

Render a private production overlay in strict mode:

```bash
python scripts/render_k8s_release_overlay.py \
  --environment production \
  --output build/k8s-release/production \
  --backend-api-image ghcr.io/<owner>/noteverse/backend-api@sha256:<digest> \
  --backend-practice-image ghcr.io/<owner>/noteverse/backend-practice@sha256:<digest> \
  --backend-beat-image ghcr.io/<owner>/noteverse/backend-beat@sha256:<digest> \
  --backend-worker-image ghcr.io/<owner>/noteverse/backend-worker@sha256:<digest> \
  --frontend-image ghcr.io/<owner>/noteverse/frontend@sha256:<digest> \
  --frontend-host noteverse.example.com \
  --api-host api.noteverse.example.com \
  --tls-secret noteverse-production-tls \
  --frontend-base-url https://noteverse.example.com \
  --backend-cors-origins '["https://noteverse.example.com"]' \
  --auth-cookie-secure true \
  --mail-default-sender 'NoteVerse Pro <no-reply@noteverse.example.com>' \
  --s3-endpoint-url https://object-storage.example.com \
  --s3-region auto \
  --s3-bucket noteverse-production \
  --s3-public-base-url https://objects.noteverse.example.com \
  --s3-force-path-style true \
  --s3-presign-expire-seconds 900

python scripts/check_k8s_application_manifests.py \
  build/k8s-release/production \
  --strict
```

Do not run strict mode against `deploy/application/overlays/production` directly:
that directory is a public template and intentionally contains placeholders.

Strict mode must fail when any deployment placeholder remains:

- `example.invalid`
- `registry.example.invalid`
- `replace-me`
- `staging-replace-me`
- `production-replace-me`

## 2. Secrets

Required backend Secret keys:

- `SECRET_KEY`
- `DATABASE_URL`
- `SYNC_DATABASE_URL`
- `SCHEDULER_LOCK_DATABASE_URL` (direct PostgreSQL or PgBouncer session pooling only)
- `REDIS_URL`
- `CELERY_BROKER_URL`
- `CELERY_RESULT_BACKEND`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- mail provider key if outbound mail is enabled

Rules:

- do not commit Secret manifests with real values;
- do not commit `.env` files containing database, Redis, S3, or mail
  credentials;
- rotate staging credentials before promoting configuration patterns to
  production.

## 3. Public Origins

Verify:

- `FRONTEND_BASE_URL` is the public product URL;
- `BACKEND_CORS_ORIGINS` includes only approved browser origins;
- `NEXT_BACKEND_ORIGIN` points to the internal backend Service;
- `/api/v1` is routed by Gateway API to the backend API;
- cookie names match backend and frontend configuration.

Do not use `localhost`, private LAN IPs, or Docker host aliases in deployable
overlays.

## 4. Gateway And Streaming

Verify the API Gateway route supports:

- long-lived SSE responses;
- read/send timeouts suitable for realtime connections;
- TLS for both frontend and API hosts.

## 5. Storage And Models

Verify:

- object storage bucket exists;
- `Secret/noteverse-registry-credentials` exists and can pull private images;
- object storage credentials are scoped to the intended bucket;
- `FILE_STORAGE_BACKEND=s3` has all required S3 settings;
- nodes that run worker pods are labeled `noteverse.io/model-cache=enabled`;
- node-local model cache is read-only in application pods;
- Legato source is built into the backend runtime image;
- beat uses transient `emptyDir` state; durable scheduling state lives in
  Postgres/outbox tables.

## 6. Workload Health

Verify:

- API has `/health/live` and `/health/ready` probes;
- API ServiceMonitor scrapes `/metrics`;
- worker and beat start with role runtime checks;
- beat has one replica only;
- frontend has liveness/readiness probes;
- frontend and API have PodDisruptionBudgets in production.

## 7. Scheduling And Capacity

Verify:

- worker GPU node labels match the production overlay;
- GPU taints/tolerations match the production overlay;
- API and frontend HPA thresholds are appropriate for the cluster;
- Celery concurrency is explicit and benchmarked for the selected GPU/model
  hardware;
- resource requests are high enough to avoid noisy-neighbor behavior.

## 8. Observability

Verify:

- Fluent Bit ships container stdout/stderr to Loki;
- Loki labels stay low-cardinality;
- Prometheus scrapes API metrics;
- Grafana has Prometheus, Loki, and Tempo datasources;
- no backend pod depends on local log files;
- no product UI exposes Redis, worker, storage, mail, renderer, model, or trace
  implementation details.

## 9. Migration And Rollout

Verify:

- database migrations run as a one-shot Job before application rollout;
- migration Job uses the same backend image as the application;
- rollout order is migration, API, worker, beat, frontend;
- rollback plan includes database migration policy and object storage
  compatibility.

## 10. Final Blockers

Do not deploy if:

- any strict manifest check fails;
- any image tag is still a placeholder;
- any host is still `example.invalid`;
- any local dev endpoint appears in manifests;
- any required Secret/PVC/node label is missing;
- realtime SSE does not work through the production Gateway path;
- object storage or node-local model cache checks fail.

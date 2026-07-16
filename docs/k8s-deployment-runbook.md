# Kubernetes Deployment Runbook

This runbook describes the intended NoteVerse deployment flow for Kubernetes.
It connects the application manifests, observability manifests, preflight
checks, validation commands, and rollback boundaries.

Related documents:

- `docs/k8s-application-runtime-contract.md`
- `docs/cicd-release-strategy.md`
- `docs/container-image-build-strategy.md`
- `docs/k8s-production-preflight-checklist.md`
- `docs/k8s-secrets-and-storage-template.md`
- `docs/k8s-observability-deployment-skeleton.md`
- `docs/k8s-logging-loki-fluent-bit-plan.md`
- `docs/opentelemetry-tempo-tracing-plan.md`
- `docs/repository-quality-checks.md`

## Deployment Model

Use separate namespaces:

```text
observability
noteverse-staging
noteverse-production
```

Keep platform observability and application workloads separate:

- observability owns Fluent Bit, Loki, Prometheus, Grafana, Tempo, and the
  OpenTelemetry Collector;
- application namespaces own API, worker, beat, frontend, migrations, app
  ConfigMaps, app Secrets, model volumes, and runtime volumes.

Do not store production credentials in this repository.

## Preflight

Run repository template guards:

```bash
python scripts/check_k8s_application_manifests.py
python scripts/check_observability_manifests.py
```

On Windows:

```powershell
.\scripts\quality.ps1 -Check k8s
.\scripts\quality.ps1 -Check observability
```

For a private production overlay, run strict mode:

```bash
python scripts/check_k8s_application_manifests.py \
  deploy/application/overlays/production-private \
  --strict
```

Strict mode must pass only after placeholders are replaced with real image tags,
hosts, TLS names, Secret references, PVC names, and scheduling labels.

## Observability Bootstrap

Deploy observability before the application so new pods are visible from the
first rollout.

Recommended order:

1. Create namespace:

   ```bash
   kubectl create namespace observability
   ```

2. Deploy Loki.
3. Deploy kube-prometheus-stack.
4. Deploy Fluent Bit.
5. Deploy Tempo.
6. Deploy OpenTelemetry Collector.

Use the values skeletons in:

```text
deploy/observability/values/
```

Validate after each release:

```bash
kubectl -n observability get pods
kubectl -n observability get svc
kubectl -n observability get servicemonitor
```

Grafana checks:

- Prometheus datasource exists;
- Loki datasource exists;
- Tempo datasource exists;
- Loki derived field can link `trace_id` to Tempo after tracing is enabled.

Log checks:

- API logs appear as structured JSON;
- worker logs appear as structured JSON;
- beat logs appear as structured JSON;
- Loki labels stay low-cardinality.

## Application Bootstrap

Create the application namespace:

```bash
kubectl create namespace noteverse-production
```

Create required external resources before applying manifests:

- PostgreSQL database and user;
- Redis instance;
- object storage bucket;
- backend Secret;
- TLS Secret or cert-manager issuer;
- model assets PVC;
- Legato repo PVC;
- beat work PVC;
- GPU node labels/tolerations if production worker uses GPU.

Naming and ownership details are defined in
`docs/k8s-secrets-and-storage-template.md`.

Required backend Secret keys:

```text
SECRET_KEY
DATABASE_URL
SYNC_DATABASE_URL
REDIS_URL
CELERY_BROKER_URL
CELERY_RESULT_BACKEND
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
RESEND_API_KEY
```

Render manifests before applying:

```bash
kubectl kustomize deploy/application/overlays/production
```

Apply order:

1. ConfigMaps and Secrets.
2. PVCs and external dependency bindings.
3. Migration Job.
4. Backend API.
5. Backend worker.
6. Backend beat.
7. Frontend.
8. Ingress.

The public template overlay is not directly deployable because it contains
`example.invalid` domains and placeholder images. Use a private deployable
overlay or CI/CD substitution step.

## Migration Job

Run database migrations before the new application rollout:

```bash
kubectl -n noteverse-production apply -f <rendered-migration-job.yaml>
kubectl -n noteverse-production wait --for=condition=complete job/noteverse-db-migrate --timeout=300s
kubectl -n noteverse-production logs job/noteverse-db-migrate
```

If migration fails:

- stop the rollout;
- inspect migration logs;
- do not deploy the new API/worker/frontend until the migration state is known;
- decide rollback according to the migration's reversibility.

## Rollout Verification

Check workload status:

```bash
kubectl -n noteverse-production rollout status deployment/noteverse-backend-api
kubectl -n noteverse-production rollout status deployment/noteverse-backend-worker
kubectl -n noteverse-production rollout status deployment/noteverse-backend-beat
kubectl -n noteverse-production rollout status deployment/noteverse-frontend
```

Check pods:

```bash
kubectl -n noteverse-production get pods -o wide
```

Check API health:

```bash
kubectl -n noteverse-production port-forward svc/noteverse-backend-api 8000:8000
curl -f http://127.0.0.1:8000/health/live
curl -f http://127.0.0.1:8000/health/ready
curl -f http://127.0.0.1:8000/metrics
```

Check frontend:

```bash
kubectl -n noteverse-production port-forward svc/noteverse-frontend 3000:3000
curl -f http://127.0.0.1:3000/
```

Check ServiceMonitor:

```bash
kubectl -n noteverse-production get servicemonitor
```

Check realtime through ingress:

- open the application in a browser;
- edit a score and save;
- verify `/score/:id` updates derived asset state without refresh;
- inspect browser network and confirm the SSE connection stays open.

## Functional Smoke Tests

Run a small production smoke path:

1. Login.
2. Upload a score image.
3. Wait for import completion.
4. Open review page.
5. Confirm score.
6. Open score detail page.
7. Confirm thumbnail/audio derived assets eventually appear.
8. Create a share link.
9. Open the share link in a new session.
10. Verify external page does not expose MusicXML when downloads are disabled.
11. Delete a test score.
12. Verify cleanup async operation is visible in ops metrics/logs.

## Observability Smoke Tests

Grafana/Loki:

- query recent API requests by `event="api.request_completed"`;
- query a failed request by `request_id`;
- query worker events for import/render/playback operations;
- verify no high-cardinality labels such as `request_id`, `score_id`, `job_id`,
  `user_id`, or `pod` are used as Loki labels.

Prometheus:

- API `/metrics` is scraped;
- async operation metrics are visible;
- alert rules can be added without raw resource IDs as labels.

Tempo:

- keep tracing disabled until staging confirms sampling and redaction policy;
- when enabled, traces should flow through the OpenTelemetry Collector, not
  directly from app pods to Tempo.

## Rollback

### Safe Rollbacks

Frontend-only rollback:

```bash
kubectl -n noteverse-production rollout undo deployment/noteverse-frontend
```

API rollback without schema changes:

```bash
kubectl -n noteverse-production rollout undo deployment/noteverse-backend-api
```

Worker rollback without outbox/schema changes:

```bash
kubectl -n noteverse-production rollout undo deployment/noteverse-backend-worker
```

Beat rollback:

```bash
kubectl -n noteverse-production rollout undo deployment/noteverse-backend-beat
```

### Risky Rollbacks

Database migrations can make rollback unsafe. Before undoing API/worker after a
schema migration:

- confirm whether the migration is backward compatible;
- confirm whether old code can read new rows/enums/states;
- confirm whether outbox jobs created by the new version can be processed by
  old workers;
- confirm object storage writes are compatible with old code.

If compatibility is unclear, pause traffic and perform an explicit recovery
plan instead of blind `rollout undo`.

## Common Failures

### API readiness fails

Check:

```bash
kubectl -n noteverse-production logs deployment/noteverse-backend-api
kubectl -n noteverse-production describe pod -l app.kubernetes.io/component=backend-api
```

Likely causes:

- database unavailable;
- storage quota policy migration missing;
- invalid backend config;
- missing Secret key.

### API ready but realtime does not update

Check:

- browser SSE connects to public API origin;
- ingress disables buffering;
- CORS includes the frontend origin;
- Redis degraded state in `/health/ready`;
- realtime cleanup/retention settings.

### Worker pods crash

Check:

```bash
kubectl -n noteverse-production logs deployment/noteverse-backend-worker
kubectl -n noteverse-production describe pod -l app.kubernetes.io/component=backend-worker
```

Likely causes:

- runtime check failure;
- missing model PVC;
- missing Legato repo PVC;
- missing soundfont;
- Redis unavailable;
- GPU scheduling mismatch.

### Beat duplicates work

Check:

```bash
kubectl -n noteverse-production get deploy noteverse-backend-beat -o yaml
```

Beat must have one replica unless the scheduler is redesigned for cluster-safe
leader election or database-backed scheduling.

### Grafana has no logs

Check:

- Fluent Bit pods are running;
- Loki gateway is reachable;
- logs are JSON;
- label policy has not accidentally promoted high-cardinality fields.

## Deployment Gate

Do not proceed to production if:

- strict manifest validation fails;
- any image tag is still a placeholder;
- any host still uses `example.invalid`;
- any local development endpoint appears in manifests;
- required Secrets/PVCs are missing;
- migration status is unknown;
- API `/health/ready` fails;
- worker runtime checks fail;
- realtime SSE fails through ingress;
- logs/metrics are not visible after rollout.

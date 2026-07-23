# NoteVerse Application Deployment Skeleton

This directory is reserved for Kubernetes manifests or Helm values for the
NoteVerse application workloads.

The runtime contract is defined in:

```text
docs/architecture/runtime/k8s-application-runtime-contract.md
```

Planned workload boundaries:

- `backend-api`: FastAPI HTTP API, `/health/*`, `/metrics`;
- `backend-practice`: FastAPI HTTP/WebSocket realtime practice service,
  `/api/v1/practice/*`, `/health/*`, `/metrics`;
- `backend-worker`: Celery worker, no HTTP service;
- `backend-beat`: singleton Celery beat scheduler, no HTTP service;
- `frontend`: Next.js web application;
- migration job: one-shot Alembic upgrade before application rollout.

Initial Kustomize base manifests live under:

```text
deploy/application/base/
```

They intentionally reference placeholder images and pre-existing
ConfigMaps/Secrets. Environment-specific overlays must provide real images,
resource classes, ingress, storage, backend secrets, and public origins
explicitly.

The first environment overlay template lives under:

```text
deploy/application/overlays/staging/
```

The production shape template lives under:

```text
deploy/application/overlays/production/
```

Validate the base with:

```bash
kubectl kustomize deploy/application/base
```

Validate the staging overlay with:

```bash
kubectl kustomize deploy/application/overlays/staging
```

Validate the production overlay with:

```bash
kubectl kustomize deploy/application/overlays/production
```

Run the repository template guard:

```bash
python scripts/check_k8s_application_manifests.py
```

Or through the repository quality entry point:

```powershell
.\scripts\quality.ps1 -Check k8s
```

For a private deployable overlay, run strict mode:

```bash
python scripts/check_k8s_application_manifests.py deploy/application/overlays/production-private --strict
```

Production preflight checklist:

```text
docs/k8s-production-preflight-checklist.md
```

Deployment runbook:

```text
docs/k8s-deployment-runbook.md
```

Do not put observability stack manifests here. Platform observability lives in:

```text
deploy/observability/
```

Do not add fallback development endpoints, default secrets, or local logging
volumes to production manifests.

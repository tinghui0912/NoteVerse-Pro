# NoteVerse Application Deployment Sources

This directory contains the reusable Kubernetes/Kustomize source templates for
NoteVerse application workloads. It is not the live GitOps desired-state tree.
Rendered, digest-pinned environment snapshots live under
[`../gitops/environments/`](../gitops/environments/README.md).

The runtime contract is defined in:

[`../../docs/architecture/runtime/k8s-application-runtime-contract.md`](../../docs/architecture/runtime/k8s-application-runtime-contract.md)

Planned workload boundaries:

- `backend-api`: FastAPI HTTP API, `/health/*`, `/metrics`;
- `backend-practice`: FastAPI HTTP/WebSocket realtime practice service,
  `/api/v1/practice/*`, `/health/*`, `/metrics`;
- `backend-worker`: Celery worker, no HTTP service;
- `backend-beat`: singleton Celery beat scheduler, no HTTP service;
- `frontend`: Next.js web application;
- migration job: one-shot Alembic upgrade before application rollout.

Initial Kustomize base manifests live under [`base/`](base/).

The application base intentionally excludes Prometheus Operator CRDs such as
`ServiceMonitor`. Core application rollout must not require the observability
stack to be installed first.

Optional Prometheus Operator discovery resources live under
[`monitoring/prometheus-operator/`](monitoring/prometheus-operator/).

Apply them only after the `monitoring.coreos.com/v1` CRDs are installed by the
observability platform.

They intentionally reference placeholder images and pre-existing
ConfigMaps/Secrets. Environment-specific overlays must provide real images,
resource classes, Gateway routing, storage, backend secrets, public origins,
and role-specific backend ConfigMaps explicitly.

The first environment overlay template lives under
[`overlays/staging/`](overlays/staging/).

The production shape template lives under
[`overlays/production/`](overlays/production/).

## Source, generation, and immutability

- `base/` and `overlays/*/` are source templates reviewed with application
  deployment changes.
- `overlays/staging/` and `overlays/production/` may contain placeholder image
  tags and placeholder domains. They are renderable templates, not immutable
  release records.
- The GitOps environment tree is produced from these templates by release
  package rendering, image digest substitution, and promotion review.
- Do not hand-edit generated GitOps snapshots to fix template problems. Fix the
  source template here, regenerate/promote, and review the resulting diff.
- Do not commit raw Secrets in either template overlays or GitOps snapshots.

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
[`../../docs/operations/deployment/k8s-production-preflight-checklist.md`](../../docs/operations/deployment/k8s-production-preflight-checklist.md)

Deployment runbook:
[`../../docs/operations/deployment/k8s-deployment-runbook.md`](../../docs/operations/deployment/k8s-deployment-runbook.md)

Do not put observability stack manifests here. Platform observability lives in
[`../observability/`](../observability/).

Application-owned scrape discovery resources are allowed only in
`deploy/application/monitoring/` so they can be applied independently after the
platform CRDs exist.

Do not add fallback development endpoints, default secrets, or local logging
volumes to production manifests.

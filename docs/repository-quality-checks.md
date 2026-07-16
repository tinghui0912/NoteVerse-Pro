# Repository Quality Checks

This document lists the local/CI quality entry points for NoteVerse.

Release and deployment strategy is documented separately in
`docs/cicd-release-strategy.md`.

## Unified Entry Point

Use:

```powershell
.\scripts\quality.ps1 -Check <check>
```

Available checks:

| Check | Purpose |
| --- | --- |
| `backend-ruff` | Backend linting inside the backend Docker runtime |
| `backend-mypy` | Backend type checking |
| `backend-mypy-model-layer` | Backend model-layer type boundary checks |
| `backend-pytest` | Backend test suite |
| `frontend-lint` | Frontend ESLint |
| `frontend-typecheck` | Frontend TypeScript type checking |
| `frontend-i18n` | Frontend error translation key guard |
| `frontend-test` | Frontend unit tests |
| `k8s` | Kubernetes application manifest guard and release overlay renderer smoke test |
| `observability` | Observability values guard |
| `all` | Fast broad gate: backend ruff/mypy, frontend lint/typecheck/i18n, K8s and observability guards |

`all` intentionally does not run every long test suite. Full test suites should
still run before release or in dedicated CI jobs.

## Kubernetes Manifest Guard

The K8s guard can also be run directly:

```powershell
python scripts/check_k8s_application_manifests.py
```

Use strict mode for private deployable overlays:

```powershell
python scripts/check_k8s_application_manifests.py `
  deploy/application/overlays/production-private `
  --strict
```

Default template mode allows explicit public placeholders. Strict mode blocks
placeholder images and domains before deployment.

The `k8s` quality check also renders a temporary staging release overlay with
sample image digests and public host values, then validates it in strict mode.
This keeps `scripts/render_k8s_release_overlay.py` covered by local and CI
checks without committing real production values.

## Observability Values Guard

Run:

```powershell
python scripts/check_observability_manifests.py
```

This guard blocks local development endpoints, obvious committed secrets,
high-cardinality Loki labels, and sensitive span/log attribute patterns in the
observability skeleton.

## CI Workflows

Current GitHub Actions workflows:

| Workflow | Trigger scope | Purpose |
| --- | --- | --- |
| `.github/workflows/backend-quality.yml` | `backend/**` | Backend ruff, mypy, model-layer mypy, pytest |
| `.github/workflows/container-images.yml` | `backend/**`, `frontend/**`, `docker/**` | Runtime image build guard; pushes GHCR images on `main` and manual runs |
| `.github/workflows/frontend-quality.yml` | `frontend/**` and shared API constants | Frontend lint, i18n guard, typecheck, tests, build, e2e |
| `.github/workflows/k8s-application-manifests.yml` | `deploy/application/**` and K8s guard script | Kustomize rendering and deployment-placeholder guard |
| `.github/workflows/observability-manifests.yml` | `deploy/observability/**` and observability guard script | Loki/Fluent Bit/Prometheus/Tempo values guard |

The K8s workflow also verifies that strict mode rejects the public production
template. A private deployable production overlay should pass strict mode in its
own deployment pipeline.

## Backend-Specific Entry Point

The older backend-specific entry point remains available:

```powershell
.\scripts\backend_quality.ps1 -Check ruff
.\scripts\backend_quality.ps1 -Check mypy
.\scripts\backend_quality.ps1 -Check mypy-model-layer
.\scripts\backend_quality.ps1 -Check pytest
```

Keep backend-only checks here; use `scripts/quality.ps1` for repository-level
coordination.

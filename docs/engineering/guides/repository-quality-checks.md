# Repository Quality Checks

This document lists the local/CI quality entry points for NoteVerse.

Release and deployment strategy is documented separately in
`docs/operations/release/cicd-release-strategy.md`.

## Unified Entry Point

Use:

```powershell
.\scripts\quality.ps1 -Check <check>
```

Available checks:

| Check | Purpose |
| --- | --- |
| `backend-ruff` | Backend linting inside the dedicated backend quality image |
| `backend-mypy` | Backend type checking inside the dedicated backend quality image |
| `backend-mypy-model-layer` | Backend model-layer type boundary checks inside the dedicated backend quality image |
| `backend-pytest` | Backend test suites through Docker quality images: core tests in `quality`, practice tests in `practice-quality` |
| `backend-coverage` | Backend coverage baseline report through the same core and practice quality images |
| `backend-contracts` | Verifies that committed customer, practice, and control-plane OpenAPI documents match runtime routes and schemas |
| `customer-web-lint` | Customer Web ESLint |
| `customer-web-typecheck` | Customer Web TypeScript type checking |
| `customer-web-i18n` | Customer Web error translation key guard |
| `customer-web-api-types` | Customer Web generated API DTO freshness check |
| `customer-web-test` | Customer Web unit tests |
| `customer-web-coverage` | Customer Web V8 coverage baseline report |
| `platform-admin-lint` | Platform Admin ESLint |
| `platform-admin-typecheck` | Platform Admin TypeScript type checking |
| `platform-admin-test` | Platform Admin unit tests |
| `platform-admin-build` | Platform Admin production build |
| `docs-links` | Validates checked-in local Markdown links |
| `k8s` | Kubernetes application manifest guard and release overlay renderer smoke test |
| `observability` | Observability values guard |
| `all` | Fast broad gate: backend ruff/mypy, customer-web lint/typecheck/i18n, platform-admin lint/typecheck/tests, K8s and observability guards |

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
| `.github/workflows/backend-quality.yml` | `backend/**`, backend-quality wrappers, and quality Dockerfiles | Backend ruff, mypy, model-layer mypy, OpenAPI contract verification, pytest |
| `.github/workflows/backend-api-image.yml` | backend API runtime files | Builds and scans the backend API image |
| `.github/workflows/backend-beat-image.yml` | backend beat runtime files | Builds and scans the backend beat image |
| `.github/workflows/backend-practice-image.yml` | backend practice runtime files | Builds and scans the backend practice image and its dependency base |
| `.github/workflows/backend-worker-image.yml` | manual | Builds and scans the ML worker image from a pinned ML base |
| `.github/workflows/customer-web-image.yml` | Customer Web runtime files | Builds and scans the Customer Web image |
| `.github/workflows/ml-base-image.yml` | manual | Builds and scans the Python/PyTorch CUDA ML base image |
| `.github/workflows/customer-web-quality.yml` | `apps/customer-web/**` and shared API constants | Customer Web lint, i18n guard, typecheck, tests, build, e2e |
| `.github/workflows/platform-admin-quality.yml` | `apps/platform-admin/**` | Platform Admin lint, typecheck, unit tests, production build |
| `.github/workflows/k8s-application-manifests.yml` | `deploy/application/**` and K8s guard script | Kustomize rendering and deployment-placeholder guard |
| `.github/workflows/observability-manifests.yml` | `deploy/observability/**` and observability guard script | Loki/Fluent Bit/Prometheus/Tempo values guard |
| `.github/workflows/docs-quality.yml` | Checked-in Markdown and link checker | Validates repository-local Markdown links |
| `.github/workflows/production-release-package.yml` | manual, `production` environment | Renders a downloadable production release package from image refs and environment variables |
| `.github/workflows/staging-release-package.yml` | manual, `staging` environment | Renders a digest-pinned staging release package and can optionally open a GitOps promotion PR |

The K8s workflow also verifies that strict mode rejects the public production
template. A private deployable production overlay should pass strict mode in its
own deployment pipeline.

## Backend Checks

Backend checks are run through the unified entry point:

```powershell
.\scripts\quality.ps1 -Check backend-ruff
.\scripts\quality.ps1 -Check backend-mypy
.\scripts\quality.ps1 -Check backend-mypy-model-layer
.\scripts\quality.ps1 -Check backend-pytest
.\scripts\quality.ps1 -Check backend-coverage
.\scripts\quality.ps1 -Check backend-contracts
```

Backend checks intentionally run inside Docker quality images:

| Image | Dockerfile | Purpose |
| --- | --- | --- |
| `quality` | `docker/backend/Dockerfile.quality` | compile, ruff, mypy, model-layer mypy, and non-practice pytest |
| `practice-deps` | `docker/backend/Dockerfile.practice-deps` | shared practice dependency base with the prebuilt `pymatchmaker` wheel |
| `practice-quality` | `docker/backend/Dockerfile.practice-quality` | practice realtime tests that require `pymatchmaker` |

`pymatchmaker` is an upstream Cython extension, so it is intentionally isolated
from the generic backend quality image. This keeps ordinary lint, type checks,
and most tests from depending on the fragile practice alignment build chain.

Runtime images stay lean: API, practice, beat, and worker images do not install
quality tooling by default.

The backend quality GitHub Actions workflow builds the same two quality images
and runs checks through `docker run --env-file ...`. CI should not install
backend quality dependencies directly on the runner Python environment.

You can also call the backend quality image directly:

```powershell
.\scripts\backend_quality_docker.ps1 -Check all
.\scripts\backend_quality_docker.ps1 -Check ruff
.\scripts\backend_quality_docker.ps1 -Check mypy
.\scripts\backend_quality_docker.ps1 -Check mypy-model-layer
.\scripts\backend_quality_docker.ps1 -Check pytest
.\scripts\backend_quality_docker.ps1 -Check coverage
.\scripts\backend_quality_docker.ps1 -Check contracts
```

The script passes `--build` to Docker Compose, so the first run builds the
quality image and later runs reuse Docker's cache.

Coverage commands report current baselines but do not enforce a global
`fail-under` threshold. Set domain-specific thresholds only after the initial
reports are reviewed; do not use a single repository-wide number to conceal
untested critical flows behind generated or low-risk code.

`backend_quality_docker.ps1 -Check pytest` runs two suites:

```text
pytest-core
  tests/* except practice realtime tests

pytest-practice
  tests/test_practice_api_smoke.py
  tests/test_practice_audio_replay_evaluation.py
  tests/test_practice_runtime_regressions.py
  tests/test_practice_websocket_flow.py
```

Worker-related tests are currently part of `pytest-core`. Examples include
Celery runtime configuration, import job execution, pipeline deadlines,
PaddleOCR subprocess timeout contracts, render/playback asset generation, and
runtime checks. There is no separate `worker-quality` image yet because these
tests do not require the full Legato/Paddle runtime.

Do not add ruff, mypy, pytest, or pre-commit to runtime requirements only to
make local checks work. Add quality-only tools to
`backend/requirements/quality-tools.txt`, then reference them through
`backend/requirements/quality-core.txt` or
`backend/requirements/quality-practice.txt`.

## Backend Dependency Files

Backend Python requirements are organized by capability, then composed into
service images:

| File | Purpose |
| --- | --- |
| `core.txt` | pydantic settings and shared logging |
| `db.txt` | SQLModel/SQLAlchemy/PostgreSQL access |
| `migrations.txt` | Alembic migrations |
| `storage.txt` | object storage client |
| `cache.txt` | Redis client |
| `celery.txt` | Celery task dispatch |
| `http.txt` | FastAPI/Uvicorn/metrics/tracing HTTP runtime |
| `auth.txt` | JWT and password hashing |
| `image.txt` | Pillow image processing |
| `fingering.txt` | API fingering generation, kept in API for now |
| `render.txt` | Verovio score rendering |
| `ocr.txt` | PaddleOCR package only |
| `practice-runtime.txt` | realtime alignment dependencies installed by `Dockerfile.practice-deps` |
| `practice-runtime-constraints.txt` | locked transitive dependency set for practice alignment |
| `worker-app.txt` | worker dependencies that must install before PaddleOCR |
| `practice-app.txt` | practice service dependencies excluding Cython extension source |
| `quality-core.txt` | generic backend quality dependencies |
| `quality-practice.txt` | aggregate practice quality reference |

`base.txt` remains only as a compatibility aggregate. New Dockerfiles and
service requirements should prefer explicit capability files.

The long-lived ownership rules live in
[`docs/architecture/runtime/runtime-dependency-ownership.md`](../../architecture/runtime/runtime-dependency-ownership.md).

When `practice-runtime.txt` changes, rebuild `practice-deps` and rerun practice
tests. If pip resolves new versions for `librosa`, `partitura`, `parangonar`,
`numba`, `scipy`, or related audio-science packages, update
`practice-runtime-constraints.txt` in the same change.

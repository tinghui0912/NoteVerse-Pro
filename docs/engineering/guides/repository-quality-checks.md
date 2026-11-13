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
| `backend-pytest` | Backend test suites through the dedicated backend quality image |
| `backend-coverage` | Backend coverage baseline report through the same core and practice quality images |
| `backend-critical-coverage` | Enforces the score-access policy's focused 80% coverage threshold |
| `backend-critical-import-execution-coverage` | Enforces the import worker execution service's focused 80% coverage threshold |
| `backend-critical-import-job-service-coverage` | Enforces the import-job API service's focused 70% coverage threshold |
| `backend-critical-import-worker-service-coverage` | Enforces the import worker state coordinator's focused 80% coverage threshold |
| `backend-contracts` | Verifies that committed customer, practice, and control-plane OpenAPI documents match runtime routes and schemas |
| `customer-web-lint` | Customer Web ESLint |
| `customer-web-typecheck` | Customer Web TypeScript type checking |
| `customer-web-i18n` | Customer Web error translation key guard |
| `customer-web-api` | Customer Web generated types, SDK and Fetch runtime freshness check |
| `customer-web-test` | Customer Web unit tests |
| `customer-web-coverage` | Customer Web V8 coverage baseline report |
| `platform-admin-lint` | Platform Admin ESLint |
| `platform-admin-typecheck` | Platform Admin TypeScript type checking |
| `platform-admin-test` | Platform Admin unit tests |
| `platform-admin-build` | Platform Admin production build |
| `docs-links` | Tests/enforces documentation structure and validates checked-in local Markdown links |
| `k8s` | Kubernetes application manifest guard and release overlay renderer smoke test |
| `observability` | Observability values guard |
| `all` | Fast broad gate: backend ruff/mypy, customer-web lint/typecheck/i18n, platform-admin lint/typecheck/tests, K8s and observability guards |

`all` intentionally does not run every long test suite. Full test suites should
still run before release or in dedicated CI jobs.

## Customer Web and Backend Integration

Run the isolated real-service integration check from the repository root:

```powershell
.\scripts\run_customer_web_backend_integration.ps1
```

The command starts a dedicated PostgreSQL database, Redis, migration job,
deterministic integration user, backend API, and Customer Web container. Its
Playwright test uses the browser-facing Customer Web origin, so calls traverse
the Next rewrite before reaching the real API. It verifies login cookies, an
authenticated profile read, rejected CSRF-less logout, accepted logout with the
issued CSRF token, and the score-import entry flow: upload an input image,
submit an import job, and read its pending status.

The stack uses only the `noteverse-integration` Compose project and removes its
containers and named volumes on completion. It never uses the development
database, synchronous database, scheduler-lock database, or Redis URLs from
`backend/.env.docker`; all are overridden to isolated Compose services. Durable uploads use the isolated Compose object-storage service through the same
ObjectStorage protocol as production. Worker scratch remains disposable. The seeded email and password exist
only in the disposable test database and are not application credentials.

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
| `.github/workflows/backend-quality.yml` | `backend/**`, `.github/scripts/*.py`, backend-quality wrappers and quality Dockerfiles | Backend ruff, mypy, model-layer mypy, OpenAPI contract verification, pytest |
| `.github/workflows/backend-api-image.yml` | backend API runtime files | Builds and scans the backend API image |
| `.github/workflows/backend-beat-image.yml` | backend beat runtime files | Builds and scans the backend beat image |
| `.github/workflows/backend-worker-image.yml` | manual | Qualifies Worker candidates before canonical promotion |
| `.github/workflows/customer-web-image.yml` | Customer Web runtime files | Builds and scans the Customer Web image |
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
.\scripts\quality.ps1 -Check backend-critical-coverage
.\scripts\quality.ps1 -Check backend-critical-import-execution-coverage
.\scripts\quality.ps1 -Check backend-critical-import-job-service-coverage
.\scripts\quality.ps1 -Check backend-critical-import-worker-service-coverage
.\scripts\quality.ps1 -Check backend-contracts
```

Backend checks intentionally run inside Docker quality images:

| Image | Dockerfile | Purpose |
| --- | --- | --- |
| `quality` | `docker/backend/Dockerfile.quality` | compile, ruff, mypy, model-layer mypy, and backend pytest |

Runtime images stay lean: API, beat, and worker images do not install
quality tooling by default.

The backend quality GitHub Actions workflow builds the same quality image and
runs checks through `docker run --env-file ...`. CI should not install
backend quality dependencies directly on the runner Python environment.

You can also call the backend quality image directly:

```powershell
.\scripts\backend_quality_docker.ps1 -Check all
.\scripts\backend_quality_docker.ps1 -Check ruff
.\scripts\backend_quality_docker.ps1 -Check mypy
.\scripts\backend_quality_docker.ps1 -Check mypy-model-layer
.\scripts\backend_quality_docker.ps1 -Check pytest
.\scripts\backend_quality_docker.ps1 -Check coverage
.\scripts\backend_quality_docker.ps1 -Check critical-coverage
.\scripts\backend_quality_docker.ps1 -Check critical-import-execution-coverage
.\scripts\backend_quality_docker.ps1 -Check critical-import-job-service-coverage
.\scripts\backend_quality_docker.ps1 -Check critical-import-worker-service-coverage
.\scripts\backend_quality_docker.ps1 -Check contracts
```

The script passes `--build` to Docker Compose, so the first run builds the
quality image and later runs reuse Docker's cache.

Coverage commands report current baselines but do not enforce a global
`fail-under` threshold. Set domain-specific thresholds only after the initial
reports are reviewed; do not use a single repository-wide number to conceal
untested critical flows behind generated or low-risk code.

`critical-coverage` is the first such gate. It runs the existing score-access
policy scenarios and requires at least 80% coverage for that focused domain.
Raise this threshold only alongside tests for newly introduced authorization
branches; add other critical-domain gates independently.

`critical-import-execution-coverage` applies the same policy to the import
worker execution service: it requires 80% coverage for error classification,
durable input materialization, and failure finalization. It deliberately does
not include the worker status coordinator; that component needs targeted tests
before it gains its own threshold.

`critical-import-job-service-coverage` requires 70% coverage for the
API-facing import-job service. Its scenarios cover owner-only access, retry
eligibility and request reconstruction, and the rule that running jobs cannot
be deleted. Raise it alongside additional state-transition or cleanup tests.

`critical-import-worker-service-coverage` requires 80% coverage for the
worker-side state coordinator. Its scenarios assert progress updates, successful
and failed terminal states, diagnostic fields, owner notifications, and named
step creation or updates. Artifact replacement and public detail shaping remain
covered by their owning service tests rather than being folded into this gate.

`backend_quality_docker.ps1 -Check pytest` runs the backend pytest suite in the
quality image.

Worker-related tests are currently part of `pytest-core`. Examples include
Celery runtime configuration, import job execution, pipeline deadlines,
PaddleOCR subprocess timeout contracts, render/playback asset generation, and
runtime checks. There is no separate `worker-quality` image yet because these
tests do not require the full Legato/Paddle runtime.

Do not add quality tooling to runtime groups. The `quality-tools` group in
`backend/pyproject.toml` composes into `quality` and default `dev`.

## Backend Dependency Authority

The backend uses one virtual uv project and one universal `uv.lock`.
Capability groups compose runtime groups; direct ownership and exact transitive
resolution remain distinct. Docker uses `uv sync --locked` and fails stale
project/lock pairs without relying on CI status protection. Quality separately
runs `uv lock --check`, Worker workflow governance, static checks and full tests.

From `backend/`:

```sh
uv sync --locked
uv run --locked pytest
uv lock --check
```

See [Runtime Dependency Ownership](../../architecture/runtime/runtime-dependency-ownership.md).

## CI Trust Checks

GitHub trust and publication tests live in `.github/scripts/`. Backend Quality
runs them as a separate pytest suite and type-checks the CI helpers at their
real paths using backend tooling. Backend pytest remains scoped to backend-owned
tests. CI script path filters explicitly trigger affected image validation.

```sh
uv run --project backend --locked --only-group quality python -m pytest .github/scripts -q -c backend/pyproject.toml
```


## Documentation quality

Run `./scripts/quality.ps1 -Check docs-links` for the same structural policy
tests, structure check and Markdown-link validation used by Documentation Quality.
The guard checks explicit locations and work-tracking filename suffixes; it
does not lint prose or ban valid protocol, package, database-migration or runtime
lifecycle terminology. Current references belong in the documented category;
implementation outcomes belong in focused GitHub Issues.

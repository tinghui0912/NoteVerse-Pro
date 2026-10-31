# Runtime Dependency Ownership

## Authority

The backend is one virtual uv project. `backend/pyproject.toml` owns direct
intent; `backend/uv.lock` owns exact transitive resolution. uv is pinned to
0.13.5. Python is `>=3.12,<3.13`; `.python-version` selects 3.12. Required virtual
project version `0.0.0` is not an application version. Deployable runtime processes
select dependency groups within this virtual project.

Exact direct pins express capability ownership. Transitives belong to the
reviewed universal lock and satisfy their upstream metadata.
Upstream constraints remain authoritative. Resolution upgrades are reviewed
changes rather than ordinary build side effects.

## Capability Groups

| Group | Responsibility |
| --- | --- |
| `core` | Settings, validation, logging |
| `db` | ORM and PostgreSQL drivers |
| `cache` | Redis and shared configuration |
| `celery` | Task dispatch and cache/configuration |
| `tracing` | OpenTelemetry SDK and OTLP gRPC exporter |
| `http` | FastAPI, Uvicorn, metrics/instrumentation |
| `auth` | JWT and password hashing |
| `storage` | Object storage clients |
| `image` | Pillow operations |
| `fingering` | NumPy and PianoPlayer |
| `practice-score` | Partitura library dependency |
| `render` | NumPy and Verovio |
| `ocr` | Linux x86_64 PaddleOCR |
| `migrations` | Alembic and database capability |
| `quality-tools` | pytest, Ruff, mypy, pre-commit and HTTP test client |

Nested `include-group` entries compose responsibilities without copying roots.

## Runtime Groups

| Group | Composition |
| --- | --- |
| `api` | HTTP, DB/migrations, storage, dispatch, auth, image, fingering, practice-score |
| `beat` | Celery/shared settings and PostgreSQL advisory-lock driver |
| `worker-app` | DB, storage, Celery, image, render, tracing |
| `worker` | Worker application, OCR, Torch, CPU Paddle, Legato execution libraries |
| `quality` | API, Beat, render, quality tools; no heavy Worker stack |
| `dev` | Default developer environment; includes Quality |

The API artifact ships customer API, control-plane API, observability exporter
and migration entrypoints. Beat publishes named tasks and owns PostgreSQL
advisory locking; it must not import Worker execution or acquire OCR/render/ML
packages. Partitura belongs to API/Quality, not Worker. Its SciPy transitive is
not a mandatory Worker qualification gate.

## Sources and Builds

Worker heavy roots are Linux x86_64 only. Torch 2.6.0 uses the named explicit
CUDA 12.4 index bound only to Torch; Linux Python 3.12 selects 2.6.0+cu124.
CPU Paddle 3.2.0 uses the approved platform wheel. Other supported development
hosts do not select these heavy roots. The CUDA wheel implies no GPU qualification.

Stable candidates are preferred. Only the explicit OpenTelemetry instrumentation
beta and its upstream-required beta family have bounded prerelease eligibility.
No unsafe index matching or metadata override is used. Source-only `fire` and
`zss` build in isolated PEP 517 environments using exact hashed setuptools build
constraints. Build-only tools are not runtime roots.

Each dependency Dockerfile copies the project/lock and runs
`uv sync --locked --no-default-groups --only-group <runtime>` using its configured
Python interpreter. Python downloads are disabled. The environment is
`/opt/noteverse/venv`; authority files are under `/opt/noteverse/project`.
Stale pairs fail within Docker without a branch-protection or separate workflow
assumption. Quality additionally runs `uv lock --check`.
The approved uv binary is copied from the single immutable OCI configured in
the project and remains intentionally available for dependency diagnostics.

Worker-deps is the sole reusable heavy dependency artifact. The dependency input key
includes the resolved Python base OCI, uv's stable locked text graph with explicit
`--python cpython@3.12 --python-version 3.12 --python-platform x86_64-manylinux_2_36`,
full project/lock bytes, approved tool identity, dependency recipe, embedded
contract and Legato manifest. `uv tree` owns marker filtering; its text output is
hashed as bytes. The pinned uv tool computes the explicit-target graph directly. Generic registry code is not a dependency-key input. The full SHA-256 key names inputs; OCI names content.
The checked-in universal lock governs the complete resolution.

Trusted publication plans before building. An existing `deps-<64hex-build-key>` OCI is
reused without rebuilding. A new attempt-specific candidate passes contract,
SPDX and Trivy gates before canonical promotion. Final Worker consumes the deps
OCI and follows the same qualification-before-source-tag ordering. This is not
registry-server CAS or OCI byte reproducibility. PR builds are local/read-only.
Disk cleanup remains scoped to completed lifecycle steps on ephemeral hosted runners.

## Canonical Commands

Run from `backend/` with uv 0.13.5:

```sh
uv sync --locked
uv run --locked pytest
uv lock --check
uv lock
uv lock --upgrade-package <package>
uv sync --locked --only-group api
uv sync --locked --only-group beat
uv sync --locked --only-group quality
uv sync --locked --only-group worker
```

`uv lock` resolves deliberate declaration changes. `--upgrade-package` makes a
transitive upgrade explicit. Builds and ordinary validation never upgrade.

## Packaging Is Not Deployment Readiness

The offline checker runs `uv pip check --python <active-interpreter>`. API checks
all shipped composition roots and migration modules. Beat checks scheduler
imports and heavy-dependency isolation. Worker-deps checks bounded OTLP/Paddle/
PaddleOCR/PaddleX imports. Final Worker delegates canonical 16-task registration
to `app.core.runtime_checks.check_celery_tasks()` and imports Verovio/OCR without
initializing models.

Checks require no database, Redis, S3, model cache, GPU, production secrets or
network. Full readiness and GPU/model assets remain deployment concerns. Both
Worker artifacts retain SPDX and the unchanged
`os,library / CRITICAL / ignore-unfixed=true / exit-code=1` Trivy gates.

See [ADR 0008](../../adr/0008-backend-dependency-authority.md) for rationale.

## Publication Policy Boundaries

Dependency identity, shared OCI mechanics, and role-specific registry policies
are separate CI responsibilities under `.github/scripts/`. They add no application
dependency or service abstraction. Worker policy owns qualified dependency-artifact reuse and existing
final-source refusal. API/Beat policy owns their bounded repositories and source
canonicals, without understanding Worker keys.

API and Beat trusted publication plans before mutation and refuses existing
canonical or candidate tags. Buildx pushes only `candidate-<run>-<attempt>`.
An explicit candidate OCI pull precedes offline packaging; SPDX and exact
CRITICAL Trivy use the same OCI. Only three actual successful gate outcomes
permit source-SHA promotion. Shared mechanics use `--prefer-index=false` and
verify the canonical resolves to exactly that OCI; an observed different winner
is never overwritten, while an identical winner is not repushed. This does not
claim registry-server CAS. A failure may leave a candidate, never a newly assigned
qualified canonical. There are no trusted build-run aliases.

PR API/Beat images use local `noteverse-backend-<role>:pr-<run>-<attempt>` tags,
no registry planning/login/push/promotion, and contents-read permissions. Trusted
main API and Beat runs each serialize; PR runs may cancel earlier validation of the same PR.

## Script Ownership

- `.github/scripts/` owns workflow policy, artifact identity, OCI publication,
  CI evidence and ephemeral hosted-runner lifecycle. CI tests live beside policy.
- `backend/scripts/` owns backend runtime, diagnostics, OpenAPI, operator/domain
  maintenance and model assets. `check_image_contract.py` is a backend artifact
  command and is embedded in Worker-deps.
- Root `scripts/` owns repository, cross-runtime, platform and environment
  orchestration, including Kubernetes, GitOps and release rendering/promotion.

Backend Quality runs CI tests separately from backend tests and type-checks CI
helpers at their actual repository paths using the backend tooling environment.

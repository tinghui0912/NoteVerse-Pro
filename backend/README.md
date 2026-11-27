# NoteVerse Pro Backend

FastAPI backend for task processing, MusicXML editing, file management, Guest Preview,
profile management, and Celery-based background workflows.

## Stack

- FastAPI
- SQLModel / SQLAlchemy
- PostgreSQL
- Redis
- Celery
- Pydantic v2
- pytest / ruff / mypy through the backend quality image

## Current Architecture

Canonical structure:

- `app/modules/*` for feature code
- `app/platform/*` for configuration values, database factories and security primitives
- `app/runtime/*` for isolated process composition and HTTP adapters
- `app/core/*` for shared HTTP and logging infrastructure
- `app/db/*` for ORM models and persistence contracts
- `app/shared/*` for shared helpers and enums
- `app/worker/*` for task registration and execution handlers
- `app/modules/import_jobs/pipeline/*` and `app/processing/*` for processing workflows
- `app/runtime/customer_api/router.py` for top-level route aggregation

`scripts/` owns runtime and operational tools; `tests/` owns core backend behavior
tests. [Research](research/README.md) owns experiments, qualification, datasets and
scientific tests, independently of the core quality image.

Customer authentication uses PostgreSQL-backed opaque sessions, Redis identity
hints and Argon2id passwords. The [Consumer Session Contract](../docs/architecture/consumer-sessions.md)
defines JSON endpoints, host-only cookies, device revocation and email fragments.

Application modules:

- `account`
- `async_operations`
- `auth`
- `collaboration`
- `durable_work`
- `fingering`
- `guest_previews`
- `import_jobs`
- `library`
- `mail`
- `media_storage`
- `metadata`
- `model_assets`
- `notifications`
- `ops`
- `performance_takes`
- `platform_operators`
- `playback`
- `practice`
- `publications`
- `realtime`
- `rendering`
- `review`
- `revisions`
- `scheduler_lock`
- `scheduler_observability`
- `score_access`
- `score_assets`
- `score_sharing`
- `scores`
- `storage_governance`
- `uploads`

## Quick Start

Install uv 0.13.5, then use the single backend project for development:

```sh
cd backend
uv sync --locked
uv run --locked pytest
uv lock --check
```

`dev` selects the Quality environment; API development does not install the
Linux-only heavy Worker group. Docker provides the production Linux runtime.
Redis and the database may run on the host.

Create the required Docker environment file first:

```powershell
Copy-Item backend/.env.docker.customer-api.example backend/.env.docker.customer-api
Copy-Item backend/.env.docker.worker.example backend/.env.docker.worker
Copy-Item backend/.env.docker.beat.example backend/.env.docker.beat
Copy-Item backend/.env.docker.migrator.example backend/.env.docker.migrator
```

```powershell
docker compose -f docker-compose.backend-dev.yml build worker-deps
docker compose -f docker-compose.backend-dev.yml build api
docker compose -f docker-compose.backend-dev.yml run --rm api check --role api
docker compose -f docker-compose.backend-dev.yml --profile tools run --rm migrate migrate
docker compose -f docker-compose.backend-dev.yml up api worker beat
```

The database uses the [schema baseline](alembic/versions/0001_initial_schema.py) and
[authorization functions](alembic/versions/0002_database_authorization.py).
Provision the explicit roles and schema owner before migrating; apply
[reviewed grants](../docs/architecture/runtime/database-role-ownership.md) after migrations.
Run `alembic upgrade head` against an empty application schema. Development initialization uses an empty database. The baseline installs the
current FREE, PLUS and PRO quota policies; it does not install users or history.
[PostgreSQL schema tests](tests/test_database_schema.py) compare the complete fresh
schema with ORM metadata and verify bootstrap, teardown and re-creation. Backend CI
runs this schema contract explicitly against its dedicated PostgreSQL service.

The control-plane runtime is intentionally opt-in. Before starting it, create
its separate environment file; its values must use names and origins distinct
from customer authentication:

```powershell
Copy-Item backend/.env.docker.control-plane.example backend/.env.docker.control-plane
```

Then start it explicitly:

```powershell
docker compose -f docker-compose.backend-dev.yml --profile control-plane up control
```

It listens on `http://localhost:8002` by default. It is a separate API
audience and is not a customer API or an operator UI.

The runtime check supports process roles:

```powershell
docker compose -f docker-compose.backend-dev.yml run --rm api check --role api
docker compose -f docker-compose.backend-dev.yml run --rm worker check --role worker
docker compose -f docker-compose.backend-dev.yml run --rm beat check --role beat
docker compose -f docker-compose.backend-dev.yml --profile control-plane run --rm control check --role control
```

Run each check with that process's isolated environment and database role.

Worker and beat run their own required checks before starting. They fail closed;
there is no environment switch that bypasses the startup gate. The API exposes
`/health/live` and `/health/ready`. Database failure makes the API not ready;
Redis failure is reported as degraded because non-queue API features remain
available.

Dependency ownership and exact resolution live only in `pyproject.toml` and
`uv.lock`. Capability groups compose `api`, `beat`, `worker-app`, `worker`,
`quality` and default `dev`. Each image syncs only its group with `--locked`.
See [runtime dependency ownership](../docs/architecture/runtime/runtime-dependency-ownership.md).
Quality excludes Torch, PaddleOCR, Paddle and Legato; Worker-deps installs the
complete heavy Worker group directly from the Python base.

Build normal runtime images with:

```powershell
docker compose -f docker-compose.backend-dev.yml build api
docker compose -f docker-compose.backend-dev.yml build beat
docker compose -f docker-compose.backend-dev.yml build worker
```

## API Docs

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Object storage transfers

Score Import and Performance Takes use JSON admission followed by a user-bound
UploadSession. Inputs up to 20 MiB use a signed staging PUT, bounded verification
and coordinator copy to an immutable final key. Larger Take inputs use Multipart
with exact signed part lengths and in-place adoption. The browser controls transfer
progress, bounded concurrency, resumable part queries and explicit cancellation.
Avatar uses bounded API upload with JPEG normalization and a 5 MiB limit.

Playback endpoints return short-lived signed JSON capabilities. Large-media Range
requests terminate at storage/CDN. Media processing readiness controls Take playback.

Development runtime uses the bucket configured in `backend/.env.docker.customer-api`; Compose
does not override it. Development and cross-end tests use the configured
S3-compatible cloud bucket. Unit and CI tests inject InMemoryObjectStorage. Provider policy examples and
requirements are in [object-storage deployment](../deploy/object-storage/README.md).
Recovery and operational metrics are in [media recovery](../docs/operations/runbooks/media-storage-recovery.md).

## Local Quality Checks

Run these before merging backend changes:

```powershell
..\scripts\backend_quality_docker.ps1 -Check all
```

Targeted checks are available when a full run is not needed:

```powershell
..\scripts\backend_quality_docker.ps1 -Check ruff
..\scripts\backend_quality_docker.ps1 -Check mypy
..\scripts\backend_quality_docker.ps1 -Check mypy-model-layer
..\scripts\backend_quality_docker.ps1 -Check pytest
```

`pytest` runs in the backend quality image and covers worker contracts such as
Celery configuration, import execution, rendering, playback, Performance Take,
and runtime-check behavior.

The repository-wide quality wrapper delegates backend checks to the same
quality image:

```powershell
..\scripts\quality.ps1 -Check backend-ruff
..\scripts\quality.ps1 -Check backend-mypy
..\scripts\quality.ps1 -Check backend-mypy-model-layer
..\scripts\quality.ps1 -Check backend-pytest
```

## CI

The repository includes a backend GitHub Actions workflow:

- `.github/workflows/backend-quality.yml`

It runs the same baseline checks for pushes and pull requests that touch
`backend/**`:

- `ruff`
- `mypy`
- `mypy-model-layer`
- `pytest`

## Notes

- Business behavior and its HTTP schemas belong to the owning `app/modules/*`
  module; ORM persistence belongs to `app/db/models/*`.
- Email sending is dispatched through Celery rather than running on the request
  path.
- The application type-checking baseline covers:
  `api`, `core`, `db`, `modules`, `pipeline`, `processing`, `shared`, `utils`,
  and `worker`.
- `mypy-model-layer.ini` separately checks the centralized model layer and its
  direct runtime consumers.

## Related Docs

- [Backend engineering principles](docs/backend_engineering_principles.md)
- [Repository quality checks](../docs/engineering/guides/repository-quality-checks.md)
- [Docker backend runtime runbook](../docs/operations/runbooks/docker-backend-runtime-runbook.md)

Durable object ownership and development configuration are described in [ObjectStorage](../docs/architecture/object-storage.md).

Control Plane requires a dedicated generated `OPERATOR_TOTP_ENCRYPTION_KEY` in
its isolated environment file. Operator bootstrap uses email and a TTY password;
the first login requires TOTP enrollment. See
[Control Plane Authentication](../docs/architecture/control-plane-auth.md) for the
API, role, recovery and audit contracts.

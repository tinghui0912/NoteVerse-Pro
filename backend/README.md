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
- `app/core/*` for runtime setup and platform concerns
- `app/db/*` for DB/session entrypoints and ORM models
- `app/shared/*` for shared helpers and enums
- `app/worker/*` for Celery runtime entrypoints
- `app/pipeline/*` and `app/processing/*` for processing workflows
- `app/api/v1/router.py` for top-level route aggregation

`scripts/` owns runtime and operational tools; `tests/` owns core backend behavior
tests. [Research](research/README.md) owns experiments, qualification, datasets and
scientific tests, independently of the core quality image.

Main feature modules:

- `account`
- `auth`
- `files`
- `import_jobs`
- `library`
- `notifications`
- `practice`
- `revisions`
- `score_assets`
- `score_invites`
- `guest_previews`
- `scores`
- `storage_usage`

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
Copy-Item backend/.env.docker.example backend/.env.docker
```

```powershell
docker compose -f docker-compose.backend-dev.yml build worker-deps
docker compose -f docker-compose.backend-dev.yml build api
docker compose -f docker-compose.backend-dev.yml run --rm api check
docker compose -f docker-compose.backend-dev.yml run --rm api migrate
docker compose -f docker-compose.backend-dev.yml up api worker beat
```

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
docker compose -f docker-compose.backend-dev.yml run --rm api check --role worker
docker compose -f docker-compose.backend-dev.yml run --rm api check --role beat
docker compose -f docker-compose.backend-dev.yml run --rm api check --role all
```

`--role control` and `--role all` require the independent
`CONTROL_PLANE_*` configuration described above. This is intentional: a full
runtime validation must not silently omit the control-plane identity boundary.

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

## Object Storage Direct Uploads

Practice performance replay saves use browser-to-object-storage direct upload.
The backend returns a presigned `PUT` URL plus the required upload headers, then
finalizes the durable replay artifact only after the object already exists.

The concrete adapter uses the deployment S3-compatible namespace. Configure
bucket CORS for each Customer Web origin that can save replays. Local development with Customer Web on `http://localhost:3000` needs a
rule equivalent to:

```json
[
  {
    "AllowedOrigin": ["http://localhost:3000"],
    "AllowedMethod": ["PUT", "GET", "HEAD"],
    "AllowedHeader": ["content-type", "x-amz-meta-sha256"],
    "ExposeHeader": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

Production should list the production Customer Web origins instead of using a
wildcard. The presigned replay upload currently signs `content-type` and
`x-amz-meta-sha256`; if the upload header contract changes, update the bucket
CORS rule at the same time.

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

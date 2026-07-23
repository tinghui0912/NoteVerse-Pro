# NoteVerse Pro Backend

FastAPI backend for task processing, MusicXML editing, file management, sharing,
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
- `score_sharing`
- `scores`
- `storage_usage`

## Quick Start

Local backend development runs through Docker so API, worker, beat, LEGATO,
Verovio, PaddleOCR, and Matchmaker share the same Linux runtime shape as future
deployments. Redis and the database can continue running on the Windows host.
Host virtualenv or direct `pip install` workflows are not supported for backend
development or testing.

Create the required Docker environment file first:

```powershell
Copy-Item backend/.env.docker.example backend/.env.docker
```

```powershell
docker build -f docker/backend/Dockerfile.ml-base -t noteverse-ml-base:py312-torch260-cu124 .
docker compose -f docker-compose.backend-dev.yml build api
docker compose -f docker-compose.backend-dev.yml run --rm api check
docker compose -f docker-compose.backend-dev.yml run --rm api migrate
docker compose -f docker-compose.backend-dev.yml up api worker beat
```

The runtime check supports process roles:

```powershell
docker compose -f docker-compose.backend-dev.yml run --rm api check --role api
docker compose -f docker-compose.backend-dev.yml run --rm api check --role worker
docker compose -f docker-compose.backend-dev.yml run --rm api check --role beat
docker compose -f docker-compose.backend-dev.yml run --rm api check --role all
```

Worker and beat run their own required checks before starting. They fail closed;
there is no environment switch that bypasses the startup gate. The API exposes
`/health/live` and `/health/ready`. Database failure makes the API not ready;
Redis failure is reported as degraded because non-queue API features remain
available.

Dependency files are split by purpose:

- `requirements/core.txt`: shared settings and logging dependencies.
- `requirements/db.txt`, `storage.txt`, `cache.txt`, `celery.txt`: platform
  capability dependencies.
- `requirements/http.txt`, `auth.txt`, `image.txt`: API-facing runtime
  capabilities.
- `requirements/fingering.txt`: API fingering generation, kept in API for now.
- `requirements/render.txt`, `ocr.txt`, `worker-app.txt`, `worker.txt`:
  worker processing capabilities.
- `requirements/practice-app.txt`, `practice-runtime.txt`, `practice.txt`:
  realtime practice capabilities.
- `requirements/quality-tools.txt`, `quality-core.txt`,
  `quality-practice.txt`: Docker quality-check dependencies.

Runtime images do not install development or quality tools by default. The
supported quality path is the dedicated Docker quality image, not installing
tooling into API, practice, beat, or worker runtime images.
The generic quality image intentionally does not use the ML base and does not
install practice alignment, PaddleOCR, Legato, torch, or transformer
dependencies. Practice tests run in a separate practice quality image because
`pymatchmaker` is a Cython extension with a heavier build chain.
The practice runtime and practice quality images share
`docker/backend/Dockerfile.practice-deps`, so native matchmaker dependencies are
built once per dependency base instead of duplicated in every practice image.

Build normal runtime images with:

```powershell
docker compose -f docker-compose.backend-dev.yml build api
docker compose -f docker-compose.backend-dev.yml build practice
docker compose -f docker-compose.backend-dev.yml build beat
docker compose -f docker-compose.backend-dev.yml build worker
```

## API Docs

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

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

`pytest` is split into `pytest-core` and `pytest-practice`. Core tests include
worker contracts such as Celery configuration, import execution, rendering,
playback, and runtime-check behavior. Practice realtime tests run in the
practice quality image.

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

- Legacy directories such as `app/services`, `app/schemas`, and
  `app/api/endpoints` have already been retired.
- Email sending is dispatched through Celery rather than running on the request
  path.
- The type-checking baseline now covers the main backend directories:
  `api`, `core`, `db`, `modules`, `pipeline`, `processing`, `shared`, `utils`,
  and `worker`.
- ORM models now live under `app/db/models/*`.
- The centralized model layer is not yet part of the stricter passing `mypy`
  baseline and is tracked separately as follow-up hardening work.
- The dedicated entry point for that work is `mypy-model-layer.ini`.
- The current runtime files that directly import ORM models are already covered
  by that isolated model-layer check.

## Related Docs

- [Backend engineering principles](C:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/backend_engineering_principles.md)
- [Repository quality checks](C:/Users/12631/Downloads/NoteVerse-Pro/docs/engineering/guides/repository-quality-checks.md)
- [Docker backend runtime runbook](C:/Users/12631/Downloads/NoteVerse-Pro/docs/operations/runbooks/docker-backend-runtime-runbook.md)

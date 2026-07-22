# NoteVerse Pro Backend

FastAPI backend for task processing, MusicXML editing, file management, sharing,
profile management, and Celery-based background workflows.

## Stack

- FastAPI
- SQLModel / SQLAlchemy
- MySQL
- Redis
- Celery
- Pydantic v2
- pytest
- ruff
- mypy
- pre-commit

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

- `auth`
- `tasks`
- `shares`
- `files`
- `profile`
- `xml`

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

- `requirements/base.txt`: shared backend infrastructure dependencies.
- `requirements/api.txt`: FastAPI API, beat, and migration runtime dependencies.
- `requirements/worker.txt`: worker-only processing, rendering, playback, OCR,
  and OMR dependencies.
- `requirements/dev.txt`: test and quality tools plus all runtime roles.

Production-style builds can omit development tools with:

```powershell
$env:INSTALL_DEV_DEPS="false"
docker compose -f docker-compose.backend-dev.yml build api
```

## API Docs

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Local Quality Checks

Run these before merging backend changes:

```powershell
..\scripts\quality.ps1 -Check backend-ruff
..\scripts\quality.ps1 -Check backend-mypy
..\scripts\quality.ps1 -Check backend-mypy-model-layer
..\scripts\quality.ps1 -Check backend-pytest
```

Current verified baseline:

- `ruff` passes
- `mypy` passes on the current directory-based baseline (`102` source files)
- `mypy-model-layer.ini` passes on the current ORM-aware database model target set
- `pytest` passes with `38` tests

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

- [docs/team_backend_rules.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/team_backend_rules.md)
- [docs/development_conventions.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/development_conventions.md)
- [docs/enterprise_alignment_optimization_plan.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/enterprise_alignment_optimization_plan.md)

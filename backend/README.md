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

### 1. Create and activate a virtual environment

```powershell
python -m venv venv
.\venv\Scripts\activate
```

### 2. Install dependencies

```powershell
pip install -r requirements.txt
```

### 3. Configure environment

```powershell
Copy-Item .env.example .env
```

Required settings include:

- `SECRET_KEY`
- `DATABASE_URL`
- `SYNC_DATABASE_URL`
- `REDIS_URL`
- `AUDIVERIS_PATH`
- `MUSESCORE_PATH`
- `MAIL_*`

### 4. Run migrations

```powershell
alembic upgrade head
```

### 5. Start the API

```powershell
python run.py
```

Or:

```powershell
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 6. Start the worker

```powershell
python worker.py
```

Or:

```powershell
celery -A worker.celery_app worker --loglevel=info --pool=solo
```

## API Docs

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Local Quality Checks

Run these before merging backend changes:

```powershell
.\venv\Scripts\python.exe -m ruff check app tests
.\venv\Scripts\python.exe -m mypy --config-file pyproject.toml
.\venv\Scripts\python.exe -m mypy --config-file mypy-model-layer.ini
.\venv\Scripts\python.exe -m pytest tests -q
```

Current verified baseline:

- `ruff` passes
- `mypy` passes on the current directory-based baseline (`102` source files)
- `mypy-model-layer.ini` passes on the current ORM-aware target set (`40` source files)
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

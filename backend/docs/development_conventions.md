# Backend Development Conventions

## Purpose

This document is the practical day-to-day rulebook for backend development
after the hybrid-architecture migration.

Use it to answer:

- where new code should go
- which paths are canonical
- what must be tested before merging

For the shortest team-facing checklist, see:

- [team_backend_rules.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/team_backend_rules.md)

## Canonical Paths

### Feature code

Put new feature behavior under:

- `app/modules/auth`
- `app/modules/tasks`
- `app/modules/shares`
- `app/modules/files`
- `app/modules/profile`
- `app/modules/xml`

Typical feature files:

- `router.py`
- `service.py`
- `repository.py`
- `dependencies.py`
- `schemas.py`

### Shared helpers

Put cross-feature reusable helpers under:

- `app/shared/responses.py`
- `app/shared/constants.py`
- `app/shared/file_kinds.py`

### Database entry points

Use:

- `app.db.session`
- `app.db.worker_session`
- `app.db.models`

Do not introduce new DB entry points elsewhere.

### API aggregation

Use:

- `app/api/v1/router.py`

`app/main.py` should remain thin.

## Legacy Paths

These paths are no longer part of the active project structure:

- `app/services/*`
- `app/schemas/*`
- `app/api/endpoints/*`
- `app/core/db.py`
- `app/worker/db.py`

Rules:

- do not recreate these files or directories
- do not import deleted legacy paths in new code
- update any resurfacing old caller to a canonical path instead

## Placement Rules

### Add a new API endpoint

Put it in:

- `app/modules/<feature>/router.py`

If it needs request or response models:

- add them to `app/modules/<feature>/schemas.py`

If it needs dependency wiring:

- add it to `app/modules/<feature>/dependencies.py`

### Add feature business logic

Put it in:

- `app/modules/<feature>/service.py`

### Add DB access or query logic

Put it in:

- `app/modules/<feature>/repository.py`

### Add shared response or business-code helpers

Put it in:

- `app/shared/*`

### Add pipeline or worker processing logic

Put it in:

- `app/pipeline/*`
- `app/processing/*`
- `app/worker/*`

Do not force these into feature modules unless they are truly feature-local.

## Import Rules

Prefer:

- `from app.modules.tasks.service import TaskService`
- `from app.modules.files.router import router`
- `from app.shared.constants import ErrorCode`
- `from app.shared.responses import success_response`
- `from app.shared.file_kinds import FileKind`
- `from app.db.session import get_session`
- `from app.db.models import Task`

Avoid:

- `from app.services...`
- `from app.api.endpoints...`
- `from app.schemas...`
- `from app.core.db import ...`
- `from app.worker.db import ...`

## Testing Rules

Before merging backend structural or behavior changes, run:

```powershell
.\venv\Scripts\python.exe -m ruff check app tests
.\venv\Scripts\python.exe -m mypy --config-file pyproject.toml
.\venv\Scripts\python.exe -m mypy --config-file mypy-model-layer.ini
.\venv\Scripts\python.exe -m pytest tests -q
```

The repository CI workflow runs the same quality gate:

- `.github/workflows/backend-quality.yml`

`mypy` is now configured as a directory-based baseline for the main backend
code paths, so most new files added under canonical directories are checked
automatically without extra `pyproject.toml` edits.

Exception:

- `app/db/models/*` now holds the centralized ORM model layer
- that layer is intentionally kept outside the stricter passing baseline for now
- model-adjacent typing is tracked separately in
  [model_layer_typing_plan.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/model_layer_typing_plan.md)
- use [mypy-model-layer.ini](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/mypy-model-layer.ini)
  for model-aware checks and ORM typing hardening

If you touch:

- API routing or auth boundaries
  - ensure `test_api_smoke.py` still passes
- config or runtime loading
  - ensure `test_config_runtime.py` still passes
- service logic
  - add or update service regression tests
- pipeline or extractors
  - add or update pipeline or MXL tests

Current verified test result:

- `pytest`: `36 passed`
- model-aware `mypy`: `40` source files checked

## Code Review Expectations

Reviewers should check:

1. Is new code using canonical paths?
2. Was any new logic added to a deleted or legacy path?
3. Is feature logic in `modules/*` rather than scattered across infrastructure layers?
4. Was regression coverage updated when behavior changed?

## Practical Rule Of Thumb

If a change introduces new backend behavior and you are unsure where it belongs:

1. put feature behavior in `app/modules/<feature>`
2. put shared helpers in `app/shared`
3. put DB and session entry through `app/db`
4. do not recreate compatibility layers

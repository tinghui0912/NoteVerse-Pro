# Backend Team Rules

## Purpose

This is the shortest day-to-day rule set for backend contributors.

Use this file when the question is:

"Where should this code go, and what must I check before merging?"

## Canonical Paths

- Feature behavior goes under `app/modules/<feature>/`
- Shared helpers go under `app/shared/`
- DB/session/model entry goes through `app/db/`
- Route aggregation goes through `app/api/v1/router.py`
- Runtime-wide concerns stay under `app/core/`
- Pipeline and engine code stays under `app/pipeline/`, `app/processing/`, and `app/worker/`

## Typical Feature Files

Inside `app/modules/<feature>/`, prefer:

- `router.py`
- `service.py`
- `repository.py`
- `dependencies.py`
- `schemas.py`

## Do Not Use For New Code

- old wrapper paths under `app/schemas/*` when a module schema already exists
- deleted legacy paths such as `app/services/*` or `app/api/endpoints/*`
- old DB entry paths outside `app/db/*`

## Placement Rules

- New API endpoint: `app/modules/<feature>/router.py`
- New feature logic: `app/modules/<feature>/service.py`
- New DB query/access logic: `app/modules/<feature>/repository.py`
- New shared response/code helper: `app/shared/*`
- New pipeline or engine behavior: `app/pipeline/*`, `app/processing/*`, or `app/worker/*`

## Import Rules

Prefer:

- `from app.modules.tasks.service import TaskService`
- `from app.modules.files.router import router`
- `from app.shared.constants import ErrorCode`
- `from app.shared.responses import success_response`
- `from app.db.session import get_session`
- `from app.db.models import Task`

Avoid:

- `from app.schemas.share import ...`
- `from app.core.db import ...`
- `from app.worker.db import ...`

## Merge Checklist

Before merging backend behavior or structural changes, run:

```powershell
.\\venv\\Scripts\\python.exe -m ruff check app tests
.\\venv\\Scripts\\python.exe -m mypy --config-file pyproject.toml
.\\venv\\Scripts\\python.exe -m mypy --config-file mypy-model-layer.ini
.\venv\Scripts\python.exe -m pytest tests -q
```

The same quality gate runs in CI:

- `.github/workflows/backend-quality.yml`

Reviewers should check:

1. Is new code using canonical paths?
2. Is feature logic inside `app/modules/*`?
3. Was any behavior added to a compatibility wrapper?
4. Was regression coverage updated if behavior changed?

Current verified baseline:

- `mypy`: `102` source files checked
- `mypy-model-layer`: `40` source files checked
- `pytest`: `38 passed`

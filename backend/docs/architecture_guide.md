# Backend Architecture Guide

## Purpose

This document defines the canonical backend structure after the
hybrid-architecture migration.

It should answer one practical question for contributors:

"Where should new code go?"

For the shortest day-to-day version of these rules, see:

- [team_backend_rules.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/team_backend_rules.md)

## Canonical Rules

### 1. Feature code goes into `app/modules/*`

New feature-level code should be added under:

- `app/modules/auth`
- `app/modules/files`
- `app/modules/profile`
- `app/modules/shares`
- `app/modules/tasks`
- `app/modules/xml`

Typical module-local files are:

- `router.py`
- `service.py`
- `repository.py`
- `dependencies.py`
- `schemas.py`

### 2. Shared cross-feature helpers go into `app/shared/*`

Use `app/shared/*` for cross-feature helpers that are not tied to one specific
feature module.

Current examples:

- `app/shared/responses.py`
- `app/shared/constants.py`
- `app/shared/file_kinds.py`

### 3. DB, session, and ORM entry points go through `app/db/*`

Use:

- `app.db.session`
- `app.db.worker_session`
- `app.db.models`

Avoid introducing new database entry points under legacy paths.

### 4. API aggregation goes through `app/api/v1/router.py`

`app/main.py` should stay thin.

Route aggregation should happen through:

- `app/api/v1/router.py`

Feature routers should be imported from canonical module paths.

### 5. Legacy wrapper layers are not extension points

The old feature wrapper directories have already been removed:

- `app/services`
- `app/schemas`
- `app/api/endpoints`

Rules:

- do not recreate these directories for new feature work
- if a legacy import resurfaces, migrate that caller to canonical
  `app/modules/*`, `app/shared/*`, or `app/db/*` paths

## Top-Level Folder Responsibilities

### `app/modules`

Feature-oriented business code.

### `app/shared`

Cross-feature reusable primitives.

### `app/db`

Database/session entry points and shared ORM models.

### `app/api`

Routing entry and FastAPI-specific API composition.

### `app/core`

App-wide runtime concerns such as config, logging, middleware, exception
handlers, and lifespan wiring.

### `app/pipeline`

Task-processing workflow orchestration.

### `app/processing`

Concrete engines, processors, and extractors used by the pipeline.

### `app/worker`

Celery runtime entry points and worker-only wiring.

## Canonical Import Examples

Prefer:

- `from app.modules.tasks.service import TaskService`
- `from app.modules.files.service import FilesService`
- `from app.modules.shares.dependencies import verify_share_ownership`
- `from app.shared.constants import ErrorCode`
- `from app.shared.responses import success_response`
- `from app.shared.file_kinds import FileKind`
- `from app.db.session import get_db`
- `from app.db.models import Task`

Avoid for new code:

- imports from deleted legacy paths such as `app.services.*`,
  `app.schemas.*`, or `app.api.endpoints.*`

## Contributor Rule Of Thumb

If you are adding new feature behavior:

1. put it in `app/modules/<feature>/...`
2. import shared helpers from `app/shared/*`
3. use DB and session access from `app/db/*`
4. do not recreate legacy wrapper layers

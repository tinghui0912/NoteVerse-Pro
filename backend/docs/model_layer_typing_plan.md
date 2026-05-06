# Model Layer Typing Plan

## Current Conclusion

`app/db/models/*` is now the canonical ORM model location, but it should not be
merged into the stricter global ORM-aware type baseline yet.

The model files themselves are close to type-checkable, but enabling them in the
current directory-based baseline immediately exposes a wider set of ORM-adjacent
type debt across repositories, services, routers, and permission helpers.

The largest error groups are:

- SQLAlchemy expression typing on model fields:
  - `.in_(...)`
  - `.ilike(...)`
  - `.is_(...)`
- Optional primary-key usage:
  - `current_user.id`
  - `task.id`
  - `share.id`
  - `upload.id`
- enum/value mismatches such as assigning raw strings to `TaskState`

This means model-layer typing is now a separate hardening phase, not a small
follow-up tweak.

## Current Coverage Status

The isolated model-layer track now covers the current runtime files under
`backend/app` that directly import `app.db.models/*` or `from app.db import models`.

In practice, this means the active ORM-adjacent runtime call sites are already
checked through `mypy-model-layer.ini`, while the stricter main baseline remains
stable and independent.

## Why Models Stay Outside `app/modules/*`

The current model layer should remain centralized.

Reasons:

- `Task`, `File`, `Share`, and `User` are shared by multiple feature modules
- ORM relationships cross feature boundaries heavily
- Alembic/migration tooling is easier to manage with a single model registry
- moving models into feature folders would increase coupling rather than reduce it

The centralized model layout under `app/db/models/*` is acceptable for a
production-style FastAPI project and is now the active canonical path.

## Recommended Staged Plan

## Current Working Setup

The project now has two distinct typing tracks:

- stable project baseline:
  - `pyproject.toml`
  - currently passes on `102` source files
- model-layer hardening track:
  - [mypy-model-layer.ini](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/mypy-model-layer.ini)
  - intentionally isolated so ORM typing work does not destabilize the main gate

Use the model-layer config only when actively working on ORM typing debt.

### Phase A. Normalize ORM Call Sites

Focus on SQLAlchemy/SQLModel query expressions first:

- `app/utils/permissions.py`
- `app/modules/tasks/repository.py`
- `app/modules/shares/repository.py`
- `app/modules/files/repository.py`

Goal:

- eliminate expression-level typing errors around `.in_()`, `.ilike()`, and `.is_()`
- make the dedicated model-layer config pass for these files before widening scope

Status:

- completed
- query-expression call sites now use SQLAlchemy column access more explicitly
- the isolated model-layer config now passes on the current 19-file target set

### Phase B. Normalize Optional IDs

Tighten service and router boundaries where ORM objects still expose optional IDs:

- `app/modules/tasks/*`
- `app/modules/shares/*`
- `app/modules/files/*`
- `app/modules/xml/*`
- `app/modules/profile/router.py`

Goal:

- introduce local guards or helper methods so downstream code receives `int`,
  not `int | None`

Status:

- completed for the current target set
- a shared helper now narrows persisted primary keys before repository/service
  calls
- the remaining model-layer work is no longer centered on optional-ID noise

### Phase C. Normalize Enum Assignments

Replace raw string state assignments with enum values:

- especially in `app/modules/xml/service.py`

Goal:

- keep domain enums consistently typed end-to-end

Status:

- completed for the current target set
- `TaskState` assignment in the XML flow now uses enum values directly

### Phase D. Add Model Layer To Baseline

Now that the first three phases are stable:

- decide whether to widen the isolated model-layer target set beyond the
  current 19 files
- keep the main `pyproject.toml` baseline stable unless the team explicitly
  wants model-layer enforcement in the default gate
- re-run:
  - `ruff`
  - `mypy --config-file mypy-model-layer.ini`
  - `pytest`

## Practical Recommendation

Do not block day-to-day development on model typing right now.

Treat this as a dedicated follow-up hardening track that can be tackled module by
module without destabilizing the current `102`-file passing baseline.

Current verified result:

- `Success: no issues found in 40 source files`

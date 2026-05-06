# Phase 3 Shared Constants Progress

## Completed

- Switched a first batch of pure `ErrorCode` / `SuccessCode` imports from `app.constants` to `app.shared.constants`.
- Limited the migration to low-risk files that do not depend on `FileKind` in the same import boundary.
- Finished the remaining pure `ErrorCode` / `SuccessCode` imports found in:
  - `app/core/exceptions.py`
  - `app/worker/tasks.py`
- Split mixed imports in a few feature modules so that:
  - `ErrorCode` / `SuccessCode` come from `app.shared.constants`
  - `FileKind` stays on `app.constants`

## Updated Files

- `app/api/deps.py`
- `app/api/endpoints/auth.py`
- `app/api/endpoints/files.py`
- `app/api/endpoints/tasks.py`
- `app/modules/files/service.py`
- `app/modules/profile/router.py`
- `app/modules/shares/dependencies.py`
- `app/modules/tasks/dependencies.py`
- `app/modules/tasks/service.py`
- `app/modules/xml/router.py`

## Validation

- `py_compile` passed for all updated files in this batch.

## Current Boundary

- `app.shared.constants` is now actively used for pure business-code imports.
- `app.constants` is still required where `FileKind` is imported together with other codes or where model-coupled enums remain in use.
- There are no remaining pure `from app.constants import ErrorCode/SuccessCode` imports in `backend/app`.

## Next Recommended Step

- Continue gradually migrating files that only need `ErrorCode` / `SuccessCode`.
- Do not migrate `FileKind` into `shared` until its coupling with the model layer is intentionally addressed.

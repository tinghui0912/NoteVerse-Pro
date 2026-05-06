# Phase 2 API Deps Slimdown Progress

## Completed

- Rebuilt `app/api/deps.py` into a thin public dependency layer.
- Kept only shared auth and database dependencies in `app/api/deps.py`:
  - `get_db`
  - `get_current_user`
  - `get_current_active_superuser`
- Removed the in-file implementations for:
  - `verify_task_ownership`
  - `verify_share_ownership`
  - `get_task_with_view_access`
  - `get_task_with_edit_access`
- Delegated task-related compatibility exports to `app.modules.tasks.dependencies`.
- Delegated share-related compatibility exports to `app.modules.shares.dependencies`.
- Preserved `get_task_service()` and `get_share_service()` as compatibility providers that forward into their feature modules.
- Kept `get_xml_service()` and `get_avatar_service()` in the public layer because those modules have not finished dependency extraction yet.

## Validation

- `py_compile` passed for:
  - `app/api/deps.py`
  - `app/modules/tasks/dependencies.py`
  - `app/modules/shares/dependencies.py`
  - `app/api/endpoints/tasks.py`
  - `app/api/endpoints/shares.py`
  - `app/api/endpoints/files.py`
  - `app/api/endpoints/profile.py`
  - `app/api/endpoints/xml.py`

## Outcome

- `app/api/deps.py` now matches the hybrid architecture direction much better:
  - global auth and db concerns stay public
  - feature-specific dependencies live with their modules
  - legacy imports still work through compatibility forwarding

## Next Recommended Step

- Extract `dependencies.py` for `xml` and `profile`, then move `get_xml_service()` and `get_avatar_service()` out of `app/api/deps.py`.

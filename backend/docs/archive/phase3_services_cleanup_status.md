# Phase 3 Services Cleanup Status

## Completed

- Confirmed that these legacy service files are now compatibility wrappers:
  - `app/services/task_service.py`
  - `app/services/worker_task_service.py`
  - `app/services/share_service.py`
  - `app/services/xml_service.py`
  - `app/services/avatar_service.py`
  - `app/services/file_service.py`

- Reworked `app/services/file_service.py` so it no longer contains the canonical implementation.
- Moved file helper functions into `app/modules/files/service.py` and kept `app/services/file_service.py` as a re-export wrapper.
- Updated `app/modules/xml/service.py` to import `render_and_save_images` from `app.modules.files.service` instead of the legacy `app.services.file_service`.

## Validation

- `py_compile` passed for:
  - `app/modules/files/service.py`
  - `app/services/file_service.py`
  - `app/services/task_service.py`
  - `app/services/worker_task_service.py`
  - `app/services/share_service.py`
  - `app/services/xml_service.py`
  - `app/services/avatar_service.py`
  - `app/modules/xml/service.py`

## Current State

- `app/services/` is now effectively a compatibility layer directory.
- The canonical implementation locations now live under feature modules for:
  - tasks
  - files
  - shares
  - xml
  - profile/avatar

## Residual References

- Remaining `app.services.*` references are now mostly documentation comments inside module files, not active runtime imports.

## Next Recommended Step

- Start the `shared/` layer evaluation:
  - response helpers
  - shared constants
  - shared enums
- Or, if you want stronger runtime confidence first, run a focused smoke validation pass before more structural cleanup.

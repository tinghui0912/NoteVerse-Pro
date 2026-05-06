# Phase 2 Files Dependencies Review

## Conclusion

- `files` does benefit from its own `dependencies.py`, but only as a lightweight boundary for now.
- The current files module does not yet have a dedicated service provider worth exposing through dependency injection.
- The immediate structural need was to stop importing task access control directly inside the files API endpoint layer.

## Completed

- Added `app/modules/files/dependencies.py`.
- Introduced `get_file_task_with_view_access()` as a files-module dependency wrapper around the task access dependency.
- Updated `app/api/endpoints/files.py` to depend on `app.modules.files.dependencies` instead of reaching directly into `app.modules.tasks.dependencies`.
- Exported the new dependency helper from `app/modules/files/__init__.py`.

## Why This Shape Is Appropriate

- `files` currently reuses task ownership and view-access rules instead of owning a separate permission model.
- A thin wrapper keeps the feature-module boundary clean without inventing a fake files service layer too early.
- This gives the files module a stable place to grow future dependencies, such as:
  - file download permission variants
  - upload validation helpers
  - file-oriented repository/service providers

## Validation

- `py_compile` passed for:
  - `app/modules/files/dependencies.py`
  - `app/modules/files/__init__.py`
  - `app/api/endpoints/files.py`

## Next Recommended Step

- Continue deeper cleanup inside `files` by deciding whether upload/download/export logic should start moving out of `app/api/endpoints/files.py` into `app/modules/files/service.py`.

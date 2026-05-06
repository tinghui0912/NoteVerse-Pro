# Phase 2 Files Preview Split Progress

## Completed

- Moved preview-file path resolution and mime-type detection from `app/api/endpoints/files.py` into `app/modules/files/service.py`.
- Added `FilesService.preview_file()`.
- Updated the preview route in `app/api/endpoints/files.py` to delegate to the files module service.

## Validation

- `py_compile` passed for:
  - `app/modules/files/service.py`
  - `app/api/endpoints/files.py`

## Outcome

- The files API route layer now mostly handles:
  - dependency injection
  - `FileResponse` / `StreamingResponse`
  - success response formatting
- File existence checks, access logic, upload handling, export generation, and preview preparation now live in the files module service.

## Next Recommended Step

- Start extracting query-heavy parts of `FilesService` into `app/modules/files/repository.py`, especially:
  - upload lookup by sha256
  - upload lookup by stored filename
  - task file queries
  - export task queries

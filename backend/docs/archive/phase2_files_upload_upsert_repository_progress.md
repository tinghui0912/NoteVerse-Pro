# Phase 2 Files Upload Upsert Repository Progress

## Completed

- Added `FilesRepository.upsert_upload()` to centralize upload record create-or-update behavior.
- Updated `FilesService.upload_file()` to stop mutating `Upload` ORM fields directly.
- Kept commit control in the service layer, while moving persistence details into the repository.

## Validation

- `py_compile` passed for:
  - `app/modules/files/repository.py`
  - `app/modules/files/service.py`

## Outcome

- `FilesService` now owns the upload workflow, but no longer owns the detailed ORM mutation rules for upload records.
- `FilesRepository` now covers both:
  - query-heavy reads
  - upload record persistence helpers

## Next Recommended Step

- If you want to keep tightening the pattern, the next candidate is to introduce a small `FilesQueryResult` or DTO-style shaping helper for repeated file metadata response structures.

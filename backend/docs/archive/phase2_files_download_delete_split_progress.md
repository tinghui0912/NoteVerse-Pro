# Phase 2 Files Download Delete Split Progress

## Completed

- Moved task-file download logic from `app/api/endpoints/files.py` into `app/modules/files/service.py`.
- Moved uploaded-file deletion logic from `app/api/endpoints/files.py` into `app/modules/files/service.py`.
- Updated `app/api/endpoints/files.py` so the route layer now delegates:
  - upload
  - task file listing
  - task file download
  - uploaded file deletion
  - Excel export

## Validation

- `py_compile` passed for:
  - `app/modules/files/service.py`
  - `app/api/endpoints/files.py`

## Outcome

- `app/api/endpoints/files.py` is now much closer to a pure HTTP adapter.
- The remaining logic in the route file is mostly response wiring:
  - `FileResponse`
  - `StreamingResponse`
  - preview-file endpoint handling

## Next Recommended Step

- Decide whether the preview endpoint should also move into `FilesService`, or leave it in the route layer because it is mostly a direct HTTP file response concern.
- If deeper cleanup is desired, start extracting file record queries and upload record queries into `app/modules/files/repository.py`.

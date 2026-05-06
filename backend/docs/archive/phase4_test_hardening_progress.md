# Phase 4 Test Hardening Progress

## Completed

- Added a minimal automated API smoke suite under:
  - `backend/tests/test_api_smoke.py`
- Expanded the smoke suite with feature-level route coverage for:
  - `tasks`
  - `files`
  - `shares`
  - `xml`
  - `profile`
- Added config/runtime regression checks under:
  - `backend/tests/test_config_runtime.py`
- Added service-level regression checks under:
  - `backend/tests/test_service_regressions.py`
- Added MXL extractor edge-case tests under:
  - `backend/tests/test_mxl_extractor.py`
- Added pipeline wiring tests under:
  - `backend/tests/test_pipeline_wiring.py`

- Chosen approach:
  - `unittest`
  - `fastapi.testclient.TestClient`

This keeps the first regression layer lightweight and avoids introducing a new test-runner dependency requirement.

## Covered Checks

- `GET /` returns `200`
- `GET /docs` returns `200`
- `GET /redoc` returns `200`
- `GET /api/v1/openapi.json` returns `200`
- protected endpoints return `401` when unauthenticated
- `POST /api/v1/auth/login` without body returns `422`
- task feature routes return `401` when unauthenticated:
  - list/details/update/delete
  - batch submit/delete/status/archive
- file feature routes return `401` when unauthenticated:
  - upload
  - task file list
  - download
  - preview
  - delete
  - Excel export
- share feature protected routes return `401` when unauthenticated:
  - list/create/delete/revoke
  - saved shares
  - save to collection
  - batch delete saved shares
- public share access route does not require authentication:
  - invalid token currently returns `404`, not `401`
- XML feature routes return `401` when unauthenticated:
  - load/save/confirm/fingering
- profile feature routes return `401` when unauthenticated:
  - profile get/update
  - password change
  - avatar upload/delete
- settings can be loaded from `backend/.env`
- `DEBUG` parsing accepts environment-style values such as `debug` and `release`
- `app.main` import exposes the expected top-level routes
- task service regression branches:
  - task not found
  - update rejected for non-owner
  - batch delete rejects empty task list
  - batch delete returns stable deleted/skipped/not-found counts
- file service regression branches:
  - allowed extension filtering
  - preview missing file handling
  - delete rejected for non-owner
  - delete succeeds for owned uploaded file
- MXL extraction edge cases:
  - missing source file
  - invalid zip payload
  - main XML extraction by matching basename
  - fallback to largest non-opus XML
  - opus metadata-based main XML selection
- pipeline wiring coverage:
  - `CopyImageStep.run()` copies input and updates `ctx.raw_paths`
  - `PreviewGenerationStep.run()` invokes the render engine and records preview outputs
- share repository query methods were adjusted to use `sqlmodel.AsyncSession.exec(...)`
  without the earlier `session.execute()` deprecation warning path

## Intended Run Command

From `backend/`:

```powershell
.\venv\Scripts\python.exe -m unittest tests.test_api_smoke tests.test_config_runtime tests.test_service_regressions tests.test_mxl_extractor tests.test_pipeline_wiring
```

## Latest Run Result

- Command executed successfully:

```powershell
.\venv\Scripts\python.exe -m unittest tests.test_api_smoke tests.test_config_runtime tests.test_service_regressions tests.test_mxl_extractor tests.test_pipeline_wiring
```

- Result:
  - `Ran 28 tests`
  - `OK`

## Next Suggested Additions

- repository-specific query behavior tests if DB-backed test fixtures are introduced later
- more pipeline step behavior tests if worker-side fixtures are introduced later

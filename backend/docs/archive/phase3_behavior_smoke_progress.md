# Phase 3 Behavior Smoke Progress

## Completed

Used `fastapi.testclient.TestClient` with `backend/venv/Scripts/python.exe` to perform a low-risk behavior smoke pass against the imported app.

## Verified Endpoint Results

- `GET /` -> `200`
- `GET /docs` -> `200`
- `GET /redoc` -> `200`
- `GET /api/v1/openapi.json` -> `200`
- `POST /api/v1/auth/login` with no body -> `422`
- `GET /api/v1/tasks` without auth -> `401`
- `GET /api/v1/profile` without auth -> `401`
- `GET /api/v1/shares` without auth -> `401`
- `GET /api/v1/xml/test-task/xml` without auth -> `401`
- `GET /api/v1/files/tasks/test-task` without auth -> `401`

## Interpretation

- Public infrastructure routes are working:
  - root
  - docs
  - redoc
  - openapi
- Auth-protected routes are correctly enforcing authentication at the boundary.
- The login route is correctly mounted and validating request shape.

## Additional Runtime Issue Found

A Windows console encoding issue is still present in the logging path:

- `app/core/logger.py`
- `app/core/middleware.py`

Current behavior:

- requests succeed
- but log output may raise `UnicodeEncodeError` when emoji or other non-GBK characters are written to stdout

This is a logging/output issue, not a route wiring failure.

## Recommended Next Step

1. Fix the Windows logging encoding problem so smoke and local development output stay clean.
2. After that, run a second behavior smoke pass for:
   - selected auth flows
   - one task submission path
   - one share public-access path

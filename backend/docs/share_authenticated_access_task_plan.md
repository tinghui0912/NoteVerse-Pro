# Share Authenticated Access Task Plan

## Purpose

This document breaks the authenticated-share-access refactor into concrete
implementation tasks.

It is intended to be executed after agreement on the higher-level plan in:

- [share_authenticated_access_refactor_plan.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/share_authenticated_access_refactor_plan.md)

## Current Status

This refactor has now been implemented.

Completed outcomes:

- backend share access and share-download routes now require authentication
- backend smoke tests enforce the new authenticated-only rule
- the frontend share page redirects logged-out users to login before fetching share data
- share API helpers now use authenticated request patterns
- share image fetching no longer bypasses authentication
- dependent practice design wording now assumes logged-in shared access

Remaining follow-up work is limited to broader app validation, especially:

- manual frontend flow verification in the browser
- fixing the unrelated frontend typecheck failure under `.next/types/*`

## Task Sequence

### Phase 1. Backend access model change

#### Task 1.1

Status: completed

Update share access routes to require authentication.

Files:

- `backend/app/modules/shares/router.py`

Changes:

- add `current_user: User = Depends(get_current_user)` to:
  - `access_shared_task`
  - `download_shared_archive`
  - `download_shared_file`

Completion check:

- the above routes return `401` when called without authentication

#### Task 1.2

Status: completed

Refactor share access service to remove anonymous semantics.

Files:

- `backend/app/modules/shares/access_service.py`
- `backend/app/modules/shares/service.py` if needed

Changes:

- simplify `access_share`
- keep validity checks:
  - exists
  - not revoked
  - not expired
- remove public-access wording and assumptions

Completion check:

- service logic no longer models public share access

#### Task 1.3

Status: completed

Retain authenticated download authorization.

Files:

- `backend/app/modules/shares/access_service.py`

Changes:

- keep `can_download` validation
- ensure route-level authentication is the identity prerequisite

Completion check:

- authenticated callers still need `can_download = true`

### Phase 2. Backend tests and cleanup

#### Task 2.1

Status: completed

Update API smoke tests for the new auth rule.

Files:

- `backend/tests/test_api_smoke.py`

Changes:

- remove the test that expects public share access
- add share access and share download routes to the authenticated-only list

Completion check:

- smoke tests reflect the new authenticated-only behavior

#### Task 2.2

Status: completed

Clean backend comments and wording.

Files:

- `backend/app/modules/shares/router.py`
- `backend/app/modules/shares/access_service.py`
- any touched share-related docs if needed

Changes:

- remove phrases implying anonymous share access

Completion check:

- no touched backend file still describes share access as public

### Phase 3. Frontend share-page guard

#### Task 3.1

Status: completed

Add login redirect guard to the share page.

Files:

- `frontend/src/app/[locale]/share/[shareId]/page.tsx`

Changes:

- read auth state from `useAuth`
- wait for auth loading to finish
- redirect to login when unauthenticated
- include `returnUrl=/share/{shareId}`
- only call `loadShareData` after auth passes

Completion check:

- logged-out users are redirected before share data fetch begins

#### Task 3.2

Status: completed

Preserve return-url flow through login.

Files:

- `frontend/src/app/[locale]/login/page.tsx`

Changes:

- verify current behavior still supports the share redirect flow
- update only if locale or routing issues appear

Completion check:

- login returns the user to the original share path

### Phase 4. Frontend share API cleanup

#### Task 4.1

Status: completed

Convert share access helper to authenticated API style.

Files:

- `frontend/src/lib/api/shares.ts`

Changes:

- refactor `accessShare`
- remove anonymous-access comments

Completion check:

- share access requests follow the same authentication model as the rest of the frontend

#### Task 4.2

Status: completed

Convert share download helpers to authenticated requests.

Files:

- `frontend/src/lib/api/shares.ts`

Changes:

- refactor `downloadSharedFile`
- refactor `downloadSharedArchive`
- ensure authenticated requests are used consistently

Completion check:

- share download helpers no longer imply anonymous access

### Phase 5. Final cleanup and validation

#### Task 5.1

Status: completed

Remove residual anonymous-share wording in touched frontend files.

Files:

- `frontend/src/lib/api/shares.ts`
- `frontend/src/app/[locale]/share/[shareId]/page.tsx`

Completion check:

- touched frontend files no longer describe share access as public

#### Task 5.2

Status: completed

Update dependent design docs if needed.

Files:

- `backend/docs/practice_realtime_design.md`

Changes:

- confirm share access assumptions are compatible with authenticated-only share access

Completion check:

- practice design does not assume anonymous share access

## Validation Checklist

Run after implementation:

```powershell
cd backend
.\venv\Scripts\python.exe -m ruff check app tests
.\venv\Scripts\python.exe -m mypy --config-file pyproject.toml
.\venv\Scripts\python.exe -m mypy --config-file mypy-model-layer.ini
.\venv\Scripts\python.exe -m pytest tests -q
```

Current validation state:

- `.\venv\Scripts\python.exe -m pytest tests/test_api_smoke.py -q` passed
- `.\venv\Scripts\python.exe -m pytest tests -q` passed
- `.\venv\Scripts\python.exe -m ruff check app tests` passed
- `.\venv\Scripts\python.exe -m mypy --config-file pyproject.toml --cache-dir NUL` passed
- `.\venv\Scripts\python.exe -m mypy --config-file mypy-model-layer.ini` passed

Frontend validation should include at least:

- open `/share/{token}` while logged out
- confirm redirect to login
- login successfully
- confirm redirect back to the share page
- confirm share page loads
- confirm shared download still respects `can_download`
- confirm share page links into editor and practice still work

Current frontend validation state:

- code paths were updated to enforce authenticated access
- `npm run typecheck` now passes after aligning the generated app-route signature
- manual browser validation has not yet been run

## Suggested First Batch

The best first implementation batch is:

1. backend route auth changes
2. backend smoke test updates
3. frontend share-page login redirect

This gives a working end-to-end rule change quickly and allows API-helper
cleanup afterward without ambiguity.

## Definition Of Done

This task plan is complete when:

- share page access requires login
- login returns users to the original share page
- share downloads require login
- backend tests enforce the new rule
- touched code and docs no longer contain anonymous-share assumptions

Current result:

- implementation work for this refactor is complete
- only broader validation and unrelated frontend typecheck cleanup remain

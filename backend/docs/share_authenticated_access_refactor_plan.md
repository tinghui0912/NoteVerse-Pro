# Share Authenticated Access Refactor Plan

## Purpose

This document defines the refactor plan for changing the share-access model
from anonymous access to authenticated-only access.

The new target behavior is:

- a user opens a share link
- if the user is not logged in, the frontend redirects to the login page
- after login succeeds, the user is redirected back to the share page
- all share-page actions now run under authenticated access

This includes:

- opening the share page
- downloading shared files
- entering practice mode from a shared score
- entering editor mode from a shared score
- saving a shared score to the user's collection

## Implementation Status

This refactor plan has now been executed.

Implemented:

- backend share access and download routes require authentication
- backend smoke tests enforce the new rule
- the frontend share page redirects unauthenticated users to login before loading share data
- frontend share helpers now use authenticated requests consistently
- share-image fetching has been aligned with the same authenticated model
- the practice realtime design has been updated to match logged-in shared access

Still worth doing:

- browser-level validation of the share -> login -> return flow

## Goal

Simplify the permission model by removing anonymous share access entirely.

After the refactor:

- JWT authentication becomes the access prerequisite
- the share token remains the resource access token
- feature-specific permissions such as `can_download` and `can_edit` remain in place
- no frontend or backend branch should continue to describe shares as public or anonymous

## Why This Change Is Worth Doing

The current share implementation mixes two access models:

- authenticated user flows
- anonymous share-link flows

This creates extra branching in:

- frontend routing
- API client behavior
- share access services
- download authorization logic
- future practice-session access design

The authenticated-only model is simpler because:

- all protected resources follow the same identity prerequisite
- API behavior aligns with the rest of the application
- practice-mode access from shares becomes easier to reason about
- there is less permission-related cleanup later

## Final Access Rules

The refactor should establish these rules:

### Share page access

- requires login
- requires a valid share token

### Share download

- requires login
- requires a valid share token
- still requires `can_download = true`

### Share edit

- requires login
- requires a valid share token
- still requires `can_edit = true`

### Share practice mode

- requires login
- requires a valid share token

### Share save-to-history

- requires login
- requires a valid share token

## Backend Refactor Design

### Router-level change

The shares module should stop exposing public access routes.

The following routes should require authentication:

- `GET /api/v1/shares/{share_token}`
- `GET /api/v1/shares/{share_token}/download/archive`
- `GET /api/v1/shares/{share_token}/download/{file_type}`

Implementation approach:

- add `current_user: User = Depends(get_current_user)` to these handlers
- keep route paths unchanged
- pass the authenticated user into the service layer where needed

### Share access service change

The share access service should stop modeling anonymous access.

Current behavior should be simplified into:

- share exists
- share is not revoked
- share is not expired
- the caller is authenticated

The service should no longer preserve a conceptual "public access" branch.

### Download validation change

Download checks should remain strict but authenticated-only:

- share exists
- share is valid
- share allows download
- caller is authenticated because the route requires it

### Permission model simplification

The backend should not add extra ownership or saved-share checks for opening a
share page unless product requirements explicitly demand that.

For this refactor, the cleanest rule is:

- any authenticated user with a valid share token may access the shared score

That keeps the share token as the resource capability while still requiring a
logged-in identity.

## Frontend Refactor Design

### Share page guard

The share page should be protected in the page component itself.

Required behavior:

- wait for auth initialization to finish
- if the user is not authenticated, redirect to login
- include `returnUrl=/share/{shareId}`
- only fetch share data after the user is authenticated

This avoids:

- unnecessary requests while unauthenticated
- a visible 401-then-redirect flash

### Login flow

The login page already supports `returnUrl`.

That behavior should remain the canonical redirect mechanism:

- unauthenticated share visit goes to login
- login success returns to the original share path

### Share API client cleanup

The frontend share API helpers should be converted to authenticated request
style.

Required changes:

- stop using anonymous raw `fetch` semantics for share access
- remove comments that say share access is public or anonymous
- align share access with the same auth expectations as tasks, files, xml, and profile

## Files and Functions To Change

### Frontend

#### `frontend/src/app/[locale]/share/[shareId]/page.tsx`

Functions and responsibilities:

- `SharePage`
  - add auth gate
  - redirect to login when unauthenticated
  - delay data fetch until authenticated

- `loadShareData`
  - only run after auth passes

#### `frontend/src/lib/api/shares.ts`

Functions and responsibilities:

- `accessShare`
  - convert to authenticated API access
  - remove public-access semantics

- `downloadSharedFile`
  - convert to authenticated download behavior

- `downloadSharedArchive`
  - convert to authenticated download behavior

#### `frontend/src/app/[locale]/login/page.tsx`

Likely no logic change required, but confirm:

- `returnUrl` handling remains correct for share-page redirects

### Backend

#### `backend/app/modules/shares/router.py`

Functions to change:

- `access_shared_task`
- `download_shared_archive`
- `download_shared_file`

Required change:

- add authenticated-user dependency

#### `backend/app/modules/shares/access_service.py`

Functions to change:

- `access_share`
- `validate_share_for_download`

Required change:

- remove anonymous-access semantics
- keep only authenticated share access behavior

#### `backend/app/modules/shares/service.py`

Check whether wrapper methods or signatures need to be updated to align with
the changed access-service contract.

#### `backend/tests/test_api_smoke.py`

Tests to replace:

- remove the public-share-access expectation
- add authenticated requirement coverage for share access and share downloads

## Required Cleanup

### Frontend cleanup

Remove:

- anonymous-access comments in the share API helpers
- any share-page logic that still assumes public access

### Backend cleanup

Remove or update:

- public-share wording in router or service comments
- tests that assert public access behavior

### Documentation cleanup

Update any current or future design docs that still describe the share token as
granting anonymous access.

This includes the practice realtime design when it depends on share access.

## Recommended Rollout Order

1. Refactor backend share access routes to require login
2. Update backend tests to match the new rule
3. Add frontend share-page redirect-to-login guard
4. Refactor frontend share API helpers to authenticated access style
5. Remove public-access comments and residual permission branches
6. Update dependent design docs

## Risks

### 1. Locale-aware redirect bugs

The login redirect flow must preserve the correct localized path when sending
the user back to the share page.

### 2. Practice and editor entry continuity

The share page currently links into:

- practice mode
- editor mode

Those flows must still receive the share token and continue working after the
page becomes authenticated-only.

### 3. API client inconsistency

If some share endpoints still use unauthenticated raw `fetch` while others use
authenticated helpers, behavior will remain inconsistent.

### 4. Residual anonymous assumptions in tests or docs

Even if the runtime behavior is correct, stale tests or comments can leave the
codebase conceptually inconsistent.

## Acceptance Criteria

The refactor is complete when all of the following are true:

- visiting a share page while logged out redirects to login
- login success returns the user to the original share page
- share page data is only fetched after authentication
- share downloads require authentication
- backend no longer documents or tests anonymous share access
- no residual frontend helper still describes share access as public

## Bottom Line

This refactor intentionally collapses the system into one clean rule:

- share token grants resource access
- authentication is required before that resource access can be used

That rule is simpler than the current mixed model and is the best foundation
for the upcoming practice-mode work.

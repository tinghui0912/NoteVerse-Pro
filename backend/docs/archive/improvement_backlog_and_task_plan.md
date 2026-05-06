# Backend Improvement Backlog And Task Plan

## Purpose

This document summarizes the remaining improvement areas after the hybrid
architecture migration and turns them into a prioritized execution plan.

It is not a migration document. The large structural migration is already
complete. This document focuses on the remaining engineering-quality work.

## Executive Summary

The backend is already operating on the intended hybrid architecture.

Current status:

- canonical feature code lives under `app/modules/*`
- shared helpers live under `app/shared/*`
- DB and session entry points live under `app/db/*`
- route aggregation is stable through `app/api/v1/router.py`
- legacy wrapper directories have been removed
- smoke and regression coverage are already in place
- `app/api/deps.py` is now limited to shared auth and DB concerns
- `auth` now has a real module-local service and dependency boundary

What remains is no longer architecture direction. What remains is quality
tightening, readability cleanup, and preventing future drift.

## Improvement Areas

### 1. Keep `app/api/deps.py` thin

Current state:

- the file is canonical for shared auth and DB dependencies only

Problem:

- the remaining risk is regression, not current design
- future changes could still reintroduce feature forwarding

Desired state:

- `app/api/deps.py` keeps only:
  - `get_db`
  - `get_current_user`
  - `get_current_active_superuser`
  - OAuth2 token setup
- all feature-specific dependency providers stay only in
  `app/modules/<feature>/dependencies.py`

### 2. `auth` still has lower maturity than the strongest modules

Current state:

- `app/modules/auth/router.py` is canonical
- `app/modules/auth/schemas.py` is canonical
- `app/modules/auth/dependencies.py` exists
- `app/modules/auth/service.py` is now a real service layer
- there is no module-local `repository.py`

Problem:

- `auth` is now structurally sound, but still not as internally mature as
  `tasks`, `files`, or `shares`
- future auth growth may justify a repository split later

Desired state:

- keep the current module boundary
- add `repository.py` only if auth persistence logic grows enough to justify it

### 3. `core` still has partial text-style inconsistency

Current state:

- `exceptions.py`, `logger.py`, and `middleware.py` were already cleaned
- `config.py` and `security.py` still contain mixed-language comments and text

Problem:

- the `core` package is now mostly clean, but not yet fully consistent
- this is a readability and maintenance issue, not a runtime issue

Desired state:

- `app/core/*` uses one consistent comment/docstring style
- comments are concise and legible
- no garbled or stale text remains

### 4. Workspace `__pycache__` noise is still present

Current state:

- many `__pycache__` directories exist under `backend/app`, `backend/tests`,
  and the local virtual environment

Problem:

- they increase local tree noise
- they make structure reviews harder
- if ignore rules are incomplete, they may become repository noise

Desired state:

- `__pycache__/` and `*.pyc` are ignored
- local cache directories are cleaned from the workspace when practical
- repository discussions focus on source directories only

### 5. Deeper repository-level tests remain optional but valuable

Current state:

- the project already has meaningful smoke and regression tests
- DB-backed repository tests are still limited

Problem:

- current coverage is sufficient for the migration outcome
- but deeper repository tests would improve confidence for future data-layer
  changes

Desired state:

- add DB-backed repository tests when fixture support or lightweight test DB
  setup is ready
- a lightweight SQLite-backed strategy is acceptable if MySQL-specific types are
  adapted explicitly inside the tests

## Priority Model

### P1. High priority

These items improve structure clarity and reduce drift risk:

1. Preserve `app/api/deps.py` as a shared-only surface
2. Synchronize the final architecture/status documents
3. Finish `app/core/*` readability cleanup

### P2. Medium priority

These items improve maintainability and workspace clarity:

4. Clean local `__pycache__` noise and confirm ignore rules

### P3. Lower priority

These items are useful but not urgent:

5. Add deeper DB-backed repository tests
6. Revisit `auth/repository.py` only if auth persistence logic grows

## Task Plan

## Phase A. Shared API Dependency Cleanup

Goal:

- make `app/api/deps.py` a true shared dependency surface only

Tasks:

- [x] Audit all imports that still reference helpers forwarded by
      `app/api/deps.py`
- [x] Replace feature-specific imports with direct imports from:
      - `app.modules.tasks.dependencies`
      - `app.modules.shares.dependencies`
      - `app.modules.profile.dependencies`
      - `app.modules.xml.dependencies`
- [x] Remove feature-forwarding providers from `app/api/deps.py`
- [x] Keep only shared auth and DB dependency providers there
- [x] Run regression tests after the cleanup

Success criteria:

- `app/api/deps.py` contains only shared dependency logic
- feature dependency wiring is fully module-local

## Phase B. Auth Module Maturity Upgrade

Goal:

- make `auth` a real feature module instead of a partially bridged one

Tasks:

- [x] Review current auth behavior boundaries in:
      - `app/modules/auth/router.py`
      - `app/api/deps.py`
      - `app/core/security.py`
- [x] Create `app/modules/auth/dependencies.py`
- [x] Move auth-specific dependency wiring into the auth module
- [x] Replace placeholder `app/modules/auth/service.py` with a real service
      boundary
- [x] Decide whether persistence access warrants
      `app/modules/auth/repository.py`
- [x] Run regression tests after the refactor

Success criteria:

- `auth` has a clear internal module boundary
- auth growth no longer depends on `app/api/deps.py` expansion

Current decision:

- a separate `repository.py` is not warranted yet
- current auth persistence access is still small enough to stay in service code

## Phase C. Final Documentation Synchronization

Goal:

- make primary architecture documents match the actual repository state

Tasks:

- [x] Update `backend/docs/fastapi_hybrid_architecture_migration_plan.md`
- [x] Update `backend/docs/current_refactor_status_summary.md`
- [x] Remove wording that implies deleted wrappers still exist
- [x] Rephrase the remaining work as maintenance-hardening rather than pending
      migration

Success criteria:

- the main docs accurately describe the final tree
- contributors are not misled about what still exists physically

## Phase D. Core Package Readability Cleanup

Goal:

- finish the cleanup of `app/core/*`

Tasks:

- [ ] Clean `backend/app/core/config.py`
- [ ] Clean `backend/app/core/security.py`
- [ ] Keep comments/docstrings concise and consistent
- [ ] Avoid behavior changes during this pass
- [ ] Run regression tests after edits

Success criteria:

- `app/core/*` has consistent comment and docstring quality
- no garbled or stale text remains in core runtime files

## Phase E. Workspace Noise Cleanup

Goal:

- reduce non-source noise in local tree reviews

Tasks:

- [x] Verify `.gitignore` covers:
      - `__pycache__/`
      - `*.pyc`
      - local virtual environment artifacts
- [x] Remove local `__pycache__` directories under the project workspace
- [x] Reconfirm that no tracked source paths depend on cache directories

Success criteria:

- workspace tree review is cleaner
- cache files do not pollute source-structure discussions

## Phase F. Optional Test Deepening

Goal:

- extend confidence for future repository-level changes

Tasks:

- [x] Design lightweight DB-backed repository test strategy
- [x] Add fixtures or test DB bootstrap if the payoff is worth the setup cost
- [x] Prioritize repository tests for the highest-change modules first:
      - `tasks`
      - `files`
      - `shares`

Success criteria:

- repository changes can be validated without depending only on service-level
  behavior tests

Current implementation:

- `backend/tests/test_repository_db_backed.py`
  adds SQLite-backed repository coverage for:
  - `tasks`
  - `files`
  - `shares`
- module package exports were also made lazy to avoid circular-import issues
  during direct repository imports in tests
- `app/api/v1/router.py` now imports routers from explicit module paths rather
  than package-level re-exports

## Recommended Execution Order

1. Continue normal feature development on canonical paths
2. Add more DB-backed repository tests only when repository behavior changes
3. Treat any remaining cleanup as opportunistic maintenance

## Practical Interpretation

If the goal is "what should we do next to improve this backend materially," the
answer is now:

1. keep using canonical module/shared/db paths
2. preserve the thin `app/api/deps.py` boundary
3. deepen repository tests only if future changes justify the setup cost

The main structural and cleanup backlog has been handled.

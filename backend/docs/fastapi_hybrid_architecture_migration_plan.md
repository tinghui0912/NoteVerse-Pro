# FastAPI Hybrid Architecture Migration Plan

## Purpose

This document records the backend's target architecture and the current migration outcome.

The codebase is no longer in the planning stage. The hybrid structure has already been established. What remains is normal maintenance, occasional cleanup, and preventing drift back to old import patterns.

## Target Architecture

The backend uses a hybrid layout:

- platform and runtime concerns stay grouped by technical responsibility
- feature behavior lives under `app/modules/*`
- shared cross-feature helpers live under `app/shared/*`
- database/session entry points live under `app/db/*`
- route aggregation happens through `app/api/v1/router.py`

## Canonical Layout

```text
backend/
|-- app/
|   |-- main.py
|   |-- api/
|   |   |-- deps.py
|   |   `-- v1/
|   |       `-- router.py
|   |-- core/
|   |-- db/
|   |-- modules/
|   |   |-- auth/
|   |   |-- tasks/
|   |   |-- shares/
|   |   |-- files/
|   |   |-- profile/
|   |   `-- xml/
|   |-- shared/
|   |-- pipeline/
|   |-- processing/
|   |-- worker/
|   |-- models/
|   `-- utils/
|-- tests/
`-- docs/
```

## Status Snapshot

### Completed

- `app/modules/*` is active on the main runtime path
- `app/db/*` is the canonical DB/session entry layer
- `app/shared/*` is used for shared responses and business-code helpers
- `app/api/v1/router.py` is the stable route aggregation entry
- old file-level service wrappers were removed
- migrated endpoint wrappers were removed
- migrated schema wrappers were reduced to a small compatibility surface
- runtime smoke validation passes
- regression coverage exists under `backend/tests/`

### Remaining

- keep canonical import rules enforced in future changes
- trim stale migration notes when touched
- optionally add deeper DB-backed repository tests later

## Why This Structure Fits The Project

The project has two different classes of code.

### Platform / infrastructure code

These parts remain organized by technical responsibility:

- `app/core`
- `app/db`
- `app/pipeline`
- `app/processing`
- `app/worker`

### Business-domain code

These parts are organized by feature:

- `auth`
- `tasks`
- `shares`
- `files`
- `profile`
- `xml`

This is why pure technical layering is no longer enough, but a fully feature-only layout would also be the wrong fit.

## Canonical Rules

The current engineering rules are:

1. New feature behavior goes into `app/modules/*`
2. Shared response/code helpers go into `app/shared/*`
3. DB/session access goes through `app/db/*`
4. `app/main.py` stays thin and aggregates through `app/api/v1/router.py`

For the contributor-facing version of these rules, see:

- [architecture_guide.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/architecture_guide.md)
- [development_conventions.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/development_conventions.md)

## Phase History

### Phase 1

Foundation cleanup:

- contract and naming drift reduction
- route aggregation setup
- schema cleanup

### Phase 2

Structure formation:

- `db/`
- `modules/`
- canonical router aggregation
- first real `tasks/files` internal splits

### Phase 3

Module deepening and runtime stabilization:

- `shares/xml/profile` promoted into real module files
- logging cleanup across runtime-critical paths
- smoke validation and config/runtime fixes

### Phase 4

Cleanup and hardening:

- compatibility wrappers reduced or removed
- import normalization advanced
- regression coverage added
- documentation and contributor rules hardened

## Current Module Maturity

### Higher maturity

- `tasks`
- `files`
- `shares`

These already have meaningful internal separation such as:

- `router.py`
- `service.py`
- `repository.py`
- `dependencies.py`
- `schemas.py`

### Still worth periodic review

- `auth`
- `profile`
- `xml`

These are structurally in the right place, but they are the most likely places for future cleanup or tightening.

## Recommended Interpretation

The migration should now be treated as:

- architecture established
- runtime stable
- compatibility debt reduced
- remaining work focused on consolidation

In practical terms, the large-scale migration is complete.

Future work should default to:

- using the canonical paths already in place
- avoiding new legacy import surfaces
- treating any remaining bridge/schema cleanup as optional follow-up, not as unfinished architecture

## Bottom Line

The backend is already operating on the intended hybrid architecture.

The remaining work is not to redesign it again. The remaining work is to keep the structure explicit, canonical, and hard to regress.

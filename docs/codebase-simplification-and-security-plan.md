# Codebase Simplification and Security Plan

> Status: active
> Baseline date: 2026-06-27
> Scope: Library/My Scores cleanup, share-link security baseline, and API response clarity.

## 1. Direction

NoteVerse keeps a single `Score` domain model and exposes focused product views:

- `/library` is the learning workspace.
- `/my-scores` is creator-owned score management.
- sharing, collaboration, and activity remain relationship domains, not extra `Score` states.

The current development phase favors clear, explicit code over compatibility shims. If a feature is not part of the active product surface, remove the route, field, API, or enum instead of keeping a dormant fallback.

## 2. Current Status

| Priority | Item | Status |
| --- | --- | --- |
| P0 | Remove legacy `/history` surface | Done |
| P1 | Make LibraryEntry the single bookmark source | Done |
| P1 | Upgrade share-link token model to id + one-time secret | Done |
| P2 | Remove dormant Library fields/source enums | Done |
| P2 | Add explicit API response models | Done for score-domain routers |
| P3 | Add Library source filtering only when needed | Deferred |

## 3. Completed Work

### P0 - Remove Legacy History Surface

Completed:

- Deleted `frontend/src/app/[locale]/history/*`.
- Deleted `frontend/tests/unit/history-redirect.test.ts`.
- Removed `/history` from `frontend/src/proxy.ts`.
- Updated Library baseline documentation so `/history` is no longer described as a supported redirect.

Acceptance:

- Runtime source no longer references `/history`.
- Frontend typecheck and lint pass after clearing stale `.next` generated types.

### P1 - Make LibraryEntry the Single Bookmark Source

Completed:

- Removed the legacy bookmark model and `/score-bookmarks` API surface.
- Removed frontend bookmark query/client helpers that targeted the legacy API.
- Updated share bookmark flow to create or update `ScoreLibraryEntry` with `source_type=BOOKMARK` and `is_favorite=True`.
- Kept `ShareGrantRedemption` because it records accepted share access separately from Library organization.
- Added an Alembic migration that drops the legacy bookmark table. Development data may be cleared, so no backfill is required.

Acceptance:

- Bookmark/save actions produce one active `ScoreLibraryEntry`.
- Library favorites/bookmarks views are backed by `score_library_entries`.
- Runtime code no longer references the legacy bookmark model or API.

### P1 - Upgrade Share Link Token Model

Completed:

- `grant_uuid` is now the public management id, not the bearer secret.
- Creating a grant generates a high-entropy secret and returns a one-time token shaped as `<grant_id>.<secret>`.
- The database stores only `token_hash`.
- Owner grant lists return status/expiry metadata without exposing historical secrets.
- Existing `grant_uuid`-only compatibility logic was not preserved.

Acceptance:

- Database leakage of `score_share_grants.grant_uuid` does not reveal working share URLs.
- Creating a grant returns the one-time secret-bearing token.
- Historical grant lists do not expose old secrets.

### P2 - Remove Dormant Library Fields and Source Enums

Completed:

- Removed `ScoreLibraryEntry.pinned_at`.
- Removed `ScoreLibraryEntry.last_opened_at` and `LibrarySort.OPENED_DESC`.
- Kept `last_practiced_at` because practice behavior is active.
- Reduced `LibraryEntrySourceType` to active values: `SELF_ADDED`, `BOOKMARK`.
- Added an Alembic migration that drops the unused columns and rebuilds the PostgreSQL enum.

Acceptance:

- No unused Library fields or source enums remain in active schemas.
- Library views still support all visible UI filters.
## 4. Remaining Work

### P2 - Add Explicit API Response Models

Completed for score-domain routers:

- Added explicit `response_model` declarations to Scores, My Scores, Library, Sharing, Publications, Artifacts, and Metadata JSON routes.
- Switched migrated routes from manual `model_dump()` calls to returning typed Pydantic objects through `success_response` / `paginated_response`.
- Kept file, redirect, and streaming routes as direct `FileResponse`, `RedirectResponse`, or `StreamingResponse` endpoints.
- Preserved existing JSON response shapes.

Acceptance:

- OpenAPI responses are explicit for migrated score-domain routes.
- Migrated router code no longer performs repetitive manual model dumping.
- Remaining manual serialization is outside this score-domain cleanup scope or inside service-layer model composition.

### P3 - Add Library Source Filtering Only When Needed

Goal: avoid making Library navigation heavier before source diversity exists.

Current decision:

- Do not add a permanent left-sidebar source section now.
- Keep source as metadata/filter capability.
- If sources become useful to users, add a top-level filter or lightweight card badge first.

Acceptance:

- Library left navigation remains focused on learning state and folders.
- Source filtering is introduced only after multiple active source types exist.






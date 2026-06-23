# NoteVerse Library Domain Implementation Plan

> Status: proposed
> Baseline date: 2026-06-24
> Scope: rename History product surface to "My Library", add folder-tree organization,
> support virtual library views, and prepare for a future public score library.

## 1. Purpose

The current `/history` page is no longer only a processing history surface. It now mixes
owned scores, processing entries, saved shared scores, thumbnails, filters, pagination, and
batch actions. The product direction is closer to a music-score library:

- users organize their own uploaded and saved scores;
- saved shared scores are library entries, not an authorization mechanism;
- folders organize the user's personal library;
- future public score discovery should be a separate public library/catalog domain.

This plan introduces a `library` domain while keeping the route migration incremental. The
first user-visible rename should be "我的乐谱库" / "My Library". The existing `/history`
route may remain as a compatibility route during development, but new code should use
library naming.

## 2. Product Principles

1. "全部乐谱" and "收藏" are virtual nodes, not database folders.
2. User-created folders are real records and belong to one user.
3. A folder organizes entries; deleting a folder must not silently delete score assets.
4. A bookmark is a library source, not a permission grant.
5. Folder membership is per user. Moving a bookmarked score does not affect the owner or
   other users.
6. URL state must fully describe the current view, folder, search, sort, and page.
7. The private library and future public library/catalog are separate domains.

## 3. Target Navigation

Initial route options:

```text
/library
/library?view=all
/library?view=favorites
/library?folder=<folder_uuid>
/library?folder=<folder_uuid>&search=chopin&sort=updated_desc&page=2
```

Development compatibility:

- keep `/history` temporarily redirecting to `/library` or rendering the same page;
- update internal links and product copy to "我的乐谱库";
- avoid adding new history-named APIs or types.

Virtual nodes:

```text
新建目录
全部乐谱        [count]
收藏            [count]

古典练习曲      [count]
  肖邦          [count]
  贝多芬        [count]
流行歌曲        [count]
待学            [count]
```

## 4. Backend Data Model

### 4.1 `ScoreLibraryFolder`

Suggested table: `score_library_folders`

```text
id
folder_uuid unique
user_id
parent_folder_id nullable
name
position
created_at
updated_at
deleted_at nullable
```

Rules:

- `(user_id, parent_folder_id, name)` should be unique for active folders.
- `parent_folder_id = null` means root-level folder.
- folder deletion is soft delete.
- deleting a parent folder soft-deletes or relocates child folders according to the selected
  delete mode.
- prevent cycles when moving folders.

### 4.2 `ScoreLibraryEntry`

Suggested table: `score_library_entries`

```text
id
entry_uuid unique
user_id
score_id
source_type = OWNED | BOOKMARK
folder_id nullable
is_favorite
is_archived
pinned_at nullable
last_opened_at nullable
last_practiced_at nullable
deleted_at nullable
created_at
updated_at
```

Rules:

- one active entry per `(user_id, score_id, source_type)`;
- owned score creation creates an `OWNED` entry;
- bookmarking a shared/public score creates a `BOOKMARK` entry;
- `folder_id = null` means root of the user's library;
- `deleted_at` means removed from the user's library view, not necessarily score deletion;
- `is_favorite` powers the virtual "收藏" node.

Deferred fields:

- `custom_name`: add only when users need per-user aliases for saved scores;
- `source_detail`: add later if import sources need rich provenance;
- `trash_expires_at`: add when automated trash retention is implemented.

## 5. Backend API

Create a new module:

```text
backend/app/modules/library/
  router.py
  schemas.py
  service.py
  repository.py
```

Register it in `backend/app/api/v1/router.py`.

### 5.1 Folder APIs

```text
GET    /api/v1/library/folders
POST   /api/v1/library/folders
PATCH  /api/v1/library/folders/{folder_id}
DELETE /api/v1/library/folders/{folder_id}
POST   /api/v1/library/folders/{folder_id}/move
```

Delete request:

```json
{
  "mode": "MOVE_CONTENTS_TO_PARENT" 
}
```

Supported modes:

- `MOVE_CONTENTS_TO_PARENT`
- `MOVE_CONTENTS_TO_ROOT`
- `TRASH_CONTENTS`

### 5.2 Entry APIs

```text
GET  /api/v1/library/entries
POST /api/v1/library/entries/batch-move
POST /api/v1/library/entries/batch-favorite
POST /api/v1/library/entries/batch-archive
POST /api/v1/library/entries/batch-trash
```

Query parameters:

```text
view=all|favorites|owned|bookmarks|archived|trash
folder_id=<folder_uuid>
search=<text>
sort=updated_desc|updated_asc|name_asc|name_desc|opened_desc|practiced_desc
page=1
page_size=20
```

Batch move request:

```json
{
  "entry_ids": ["..."],
  "target_folder_id": null
}
```

### 5.3 Read Model

`LibraryEntryRead` should include enough score data for the list without the frontend
reconstructing state from multiple APIs:

```text
entry_id
score_id
source_type
folder_id
title
taxonomy_tags
thumbnail_artifact_id nullable
metadata summary nullable
capabilities
is_favorite
is_archived
pinned_at
last_opened_at
last_practiced_at
created_at
updated_at
```

Counts for tree nodes can be returned by `GET /library/folders`:

```text
all_count
favorite_count
folder_counts: [{ folder_id, direct_count, recursive_count }]
```

## 6. Data Migration

Add an Alembic migration that:

1. creates `score_library_folders`;
2. creates `score_library_entries`;
3. backfills one `OWNED` entry for each active score owner;
4. backfills one `BOOKMARK` entry for each score bookmark;
5. preserves existing `ScoreBookmark` rows for redemption/audit semantics until a later
   cleanup decision.

Do not remove `ScoreBookmark` in this phase. It still records bookmark-specific lifecycle and
may be useful for share/public redemption history. The library entry is the user's current
organization surface.

## 7. Frontend Ownership

Introduce library naming while migrating from the existing history implementation:

```text
frontend/src/components/library/
  library-shell.tsx
  library-sidebar.tsx
  library-folder-tree.tsx
  library-entry-grid.tsx
  library-entry-list.tsx
  library-toolbar.tsx
  library-move-dialog.tsx
  library-folder-dialog.tsx

frontend/src/hooks/library/
  use-library-url-state.ts
  use-library-selection.ts
  use-library-batch-actions.ts
  use-library-thumbnails.ts

frontend/src/lib/api/library.ts
frontend/src/types/api/library.ts
```

Query hooks:

```text
frontend/src/hooks/queries/use-library-queries.ts
```

Query key root:

```text
queryKeys.library
```

Page route:

```text
frontend/src/app/[locale]/library/page.tsx
```

Temporary compatibility:

- `/history` redirects to `/library` or composes the new library page;
- old `components/history/*` are moved or replaced only when the new components are ready;
- user-visible copy changes from "历史记录" to "我的乐谱库".

## 8. UX Behavior

### 8.1 Sidebar

- "新建目录" opens a folder creation dialog.
- "全部乐谱" selects `view=all`.
- "收藏" selects `view=favorites`.
- User folders select `folder=<folder_uuid>`.
- Folder row actions: rename, move, delete.
- Counts should prefer recursive counts for folder tree display.

### 8.2 Entry List

- preserve grid/list toggle;
- preserve batch selection;
- add "移动到目录" batch action;
- keep download/delete/archive actions capability-gated;
- moving entries updates library cache and selected folder counts.

### 8.3 Delete Folder

When a folder is not empty, show explicit choices:

1. move contents to parent;
2. move contents to root;
3. move contents to trash;
4. cancel.

No folder deletion should physically delete score revisions or artifacts.

## 9. Relationship To Sharing And Publication

- Share links grant access; library entries organize a user's view.
- Saving a shared score creates or restores a library entry.
- Revoked/expired share access can leave the entry visible as unavailable.
- Public score discovery should use a future `public_library` or `catalog` surface, not the
  private `/library` folder tree.

## 10. Implementation Phases

### P0 - Contract Decisions

1. Decide route migration: immediate `/library` plus `/history` redirect, or copy-only rename
   first.
2. Decide folder delete modes for v1.
3. Decide whether `ScoreBookmark` remains separate permanently or becomes a source event.
4. Decide whether "收藏" uses `is_favorite` or existing bookmark records for v1.

Acceptance:

- product copy and route strategy are documented;
- no code path treats virtual nodes as persisted folders.

### P1 - Backend Schema And Read Model

1. Add ORM models and Alembic migration.
2. Backfill owned and bookmark entries.
3. Add repository and service methods.
4. Add folder tree and entry list APIs.
5. Add focused tests for ownership, virtual counts, folder moves, and soft deletion.

Acceptance:

- active owned scores and bookmarks appear as library entries;
- folder tree counts are stable;
- unauthorized users cannot see or move another user's entries.

### P2 - Frontend Data Layer

1. Add `types/api/library.ts`.
2. Add `lib/api/library.ts`.
3. Add `queryKeys.library` and `use-library-queries.ts`.
4. Add URL-state hook for `view`, `folder`, `search`, `sort`, and `page`.

Acceptance:

- no page-level direct fetch;
- query invalidation updates folder counts and entries after mutations.

### P3 - New Library Page Layout

1. Add `/library` route.
2. Build sidebar tree and right-side list/grid layout.
3. Rename copy to "我的乐谱库".
4. Keep existing score card, thumbnail, status, and pagination behavior where still valid.
5. Add `/history` redirect or compatibility composition.

Acceptance:

- refresh, back/forward, and direct URL open restore the same library view;
- existing upload and saved-share flows still navigate to the right score results.

### P4 - Folder Mutations And Batch Move

1. Create folder dialog.
2. Rename/delete/move folder actions.
3. Batch move selected entries to existing folder or root.
4. Empty and error states.

Acceptance:

- batch move is persisted and reflected after refresh;
- deleting folders never deletes score assets silently;
- unavailable shared/bookmarked scores remain clearly marked.

### P5 - Cleanup And Documentation

1. Move or delete obsolete `components/history` code.
2. Rename hooks and types from history to library where they now represent library behavior.
3. Update frontend/backend engineering principles.
4. Update E2E tests from history wording to library wording.

Acceptance:

- no new `history`-named API/type owns library behavior;
- docs describe private library versus future public score library clearly.

## 11. Validation

Backend:

```powershell
docker run --rm --env-file backend/.env.docker -v "${PWD}\backend:/app" -w /app noteverse-backend-runtime:dev pytest tests/test_library_domain.py -q
docker run --rm --env-file backend/.env.docker -v "${PWD}\backend:/app" -w /app noteverse-backend-runtime:dev pytest tests/test_score_revision_services.py -q
```

Frontend:

```powershell
cd frontend
npm run lint
npm run typecheck
npm run test
```

E2E:

- owned score appears in "全部乐谱";
- bookmarked score appears in "收藏";
- create folder, move selected scores, refresh, and verify placement;
- delete non-empty folder with move-to-root behavior;
- revoked share bookmark remains unavailable, not silently removed.

## 12. Non-Goals

- public community catalog implementation;
- organization/team libraries;
- comments, ratings, recommendations, or marketplace features;
- physical deletion of score revisions/artifacts through folder deletion;
- generic file-drive abstraction for non-score resources.


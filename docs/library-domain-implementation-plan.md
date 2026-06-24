# NoteVerse Library Domain Implementation Plan

> Status: v1 baseline, IA split, and learning workspace complete
> Baseline date: 2026-06-24
> Scope: replace the old History surface with a private library baseline, then split
> creator asset management (`/my-scores`) from learning/collection organization (`/library`).

## 1. Purpose

The old `/history` page was no longer only a processing history surface. It mixed owned
scores, processing entries, saved shared scores, thumbnails, filters, pagination, and batch
actions. The first migration replaced it with a private library baseline:

- users organize saved scores and, during the v1 baseline, uploaded scores;
- saved shared scores are library entries, not an authorization mechanism;
- folders organize the user's personal library;
- future public score discovery should be a separate public library/catalog domain.

The next architecture refinement separates two product mindsets:

- `/my-scores` is creator mode: assets the user owns and manages.
- `/library` is learning/collection mode: scores the user wants to practice, save, organize,
  and revisit, regardless of who owns the source score.

This avoids the long-term confusion of showing the same owned score as both a managed work
and a "my upload" inside the library tree. Because the project is still in development and
local data can be cleared, this plan avoids legacy compatibility surfaces and request-time
fallbacks.

## 2. Product Principles

1. `/my-scores` is the only creator asset management surface for owned scores.
2. `/library` is the user's learning and collection space, not an ownership management page.
3. Library virtual nodes should emphasize learning state and collection behavior, such as
   recent practice, favorites, to-practice, mastered, and user folders.
4. User-created folders belong to Library only. My Scores uses ownership/status filters,
   search, sorting, and tags rather than a folder tree.
5. A folder organizes library entries; deleting a folder must not silently delete score assets.
6. A bookmark is a library source, not a permission grant.
7. Folder membership is per user. Moving a bookmarked score does not affect the owner or
   other users.
8. URL state must fully describe the current view, folder, search, sort, and page.
9. The private library, creator asset management, and future public library/catalog are
   separate domains.

## 3. Target Navigation

Current Library route options:

```text
/library
/library?view=all
/library?view=favorites
/library?folder=<folder_uuid>
/library?folder=<folder_uuid>&search=chopin&sort=updated_desc&page=2
```

Planned My Scores route options:

```text
/my-scores
/my-scores?view=all
/my-scores?view=drafts
/my-scores?view=private
/my-scores?view=published
/my-scores?search=canon&sort=updated_desc&page=2
```

Development route policy:

- `/history` redirects to `/library`;
- update internal links and product copy to separate "我的乐谱库" from "我的作品";
- avoid adding new history-named APIs or types.

Target application sidebar:

```text
Dashboard

Practice

Library
  最近练习
  收藏
  待练习
  已掌握
  目录树

My Scores
  全部作品
  草稿
  私有
  已发布
  最近修改

Community
```

Library folder examples:

```text
新建目录
古典
  肖邦
  贝多芬
流行
待练习
演出曲目
```

The database may support arbitrary nesting with cycle prevention, but the product UI should
keep the recommended depth to 2-3 levels.

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
source_type = SELF_ADDED | BOOKMARK | SHARED | OFFICIAL | AI_RECOMMENDED
folder_id nullable
is_favorite
is_archived
pinned_at nullable
last_opened_at nullable
last_practiced_at nullable
practice_state = TO_PRACTICE | IN_PROGRESS | MASTERED
deleted_at nullable
created_at
updated_at
```

Rules:

- one active entry per `(user_id, score_id, source_type)`;
- owned score creation always creates a score visible in `/my-scores`;
- adding an owned score to the learning library creates a `SELF_ADDED` library entry;
- bookmarking a shared/public score creates a `BOOKMARK` library entry;
- `folder_id = null` means root of the user's library;
- `deleted_at` means removed from the user's library view, not necessarily score deletion;
- `is_favorite` powers the virtual "收藏" node.

`OWNED` is not a good long-term Library source label because it blurs creator management
with learning organization. Use `SELF_ADDED` when the user intentionally adds one of their
own scores to Library.

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

Create a separate My Scores module or score-owner read model:

```text
backend/app/modules/my_scores/
  router.py
  schemas.py
  service.py
  repository.py
```

`/my-scores` reads from `scores WHERE owner_user_id = current_user`. It should not read from
`score_library_entries` as its primary source of truth.

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
view=all|favorites|recent_practice|to_practice|mastered|bookmarks|archived|trash
folder_id=<folder_uuid>
search=<text>
sort=updated_desc|updated_asc|name_asc|name_desc|opened_desc|practiced_desc
page=1
page_size=20
```

Next IA refinement should remove `owned` as a primary Library view and replace it with
learning/collection views:

```text
view=all|favorites|recent_practice|to_practice|mastered|bookmarks|archived|trash
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
recent_practice_count
to_practice_count
mastered_count
folder_counts: [{ folder_id, direct_count, recursive_count }]
```

## 6. Data Migration

Add an Alembic migration that:

1. creates `score_library_folders`;
2. creates `score_library_entries`;
3. does not backfill old score or bookmark rows.

Development databases may be cleared before applying this migration. New uploads create
owned `Score` rows visible in `/my-scores`; saved shares create `BOOKMARK` library entries.
The next IA refinement should stop creating automatic `OWNED` library entries. If the product
wants owned scores to appear in Library, create an explicit `SELF_ADDED` entry through an
"Add to Library" action or an upload option. Do not add fallback code that synthesizes library
entries from legacy score/bookmark tables at request time.

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

Add My Scores ownership separately:

```text
frontend/src/components/my-scores/
  my-scores-shell.tsx
  my-scores-toolbar.tsx
  my-scores-grid.tsx
  my-scores-card.tsx

frontend/src/hooks/my-scores/
  use-my-scores-url-state.ts
  use-my-scores-selection.ts

frontend/src/lib/api/my-scores.ts
frontend/src/types/api/my-scores.ts
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

Route transition:

- `/history` redirects to `/library`;
- old `components/history/*` should be deleted once no runtime references remain;
- user-visible copy changes from "历史记录" to "我的乐谱库".

## 8. UX Behavior

### 8.1 Sidebar

- "最近练习" selects `view=recent_practice`.
- "收藏" selects `view=favorites`.
- "待练习" selects `view=to_practice`.
- "已掌握" selects `view=mastered`.
- "新建目录" opens a folder creation dialog.
- User folders select `folder=<folder_uuid>`.
- Folder row actions: rename, move, delete.
- Counts should prefer recursive counts for folder tree display.

Do not show "我的上传" as a Library primary node. Owned-score management belongs to
`/my-scores`.

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
- Owned scores are managed in `/my-scores`. Publishing, unpublishing, deleting, editing,
  version management, and owner share management happen there.
- Library may include an owned score only when the user explicitly adds it to the learning
  library as `SELF_ADDED`.
- Public score discovery should use a future `public_library` or `catalog` surface, not the
  private `/library` folder tree.

## 10. Implementation Phases

### P0 - Contract Decisions `[completed]`

1. Keep `/library` as the only product surface and make `/history` redirect to it.
2. Decide folder delete modes for v1.
3. Decide whether `ScoreBookmark` remains separate permanently or becomes a source event.
4. Decide whether "收藏" uses `is_favorite` or existing bookmark records for v1.

Acceptance:

- product copy and route strategy are documented;
- no code path treats virtual nodes as persisted folders.

### P1 - Backend Schema And Read Model `[completed for v1 baseline]`

1. Add ORM models and Alembic migration.
2. Do not backfill legacy owned/bookmark entries; development databases may be cleared.
3. Add repository and service methods.
4. Add folder tree and entry list APIs.
5. Add focused tests for ownership, virtual counts, folder moves, and soft deletion.

Acceptance:

- v1 baseline creates library entries for new owned scores and newly saved shared scores;
- P7 will remove automatic owned-score library entries and replace them with explicit
  `SELF_ADDED` behavior;
- folder tree counts are stable;
- unauthorized users cannot see or move another user's entries.

### P2 - Frontend Data Layer `[completed for v1 baseline]`

1. Add `types/api/library.ts`.
2. Add `lib/api/library.ts`.
3. Add `queryKeys.library` and `use-library-queries.ts`.
4. Add URL-state hook for `view`, `folder`, `search`, `sort`, and `page`.

Acceptance:

- no page-level direct fetch;
- query invalidation updates folder counts and entries after mutations.

### P3 - New Library Page Layout `[completed for v1 baseline]`

1. Add `/library` route.
2. Build sidebar tree and right-side list/grid layout.
3. Rename copy to "我的乐谱库".
4. Keep existing score card, thumbnail, status, and pagination behavior where still valid.
5. Add `/history` redirect only.

Acceptance:

- refresh, back/forward, and direct URL open restore the same library view;
- existing upload and saved-share flows still navigate to the right score results.

### P4 - Folder Mutations And Batch Move `[completed for v1 baseline]`

1. Create folder dialog is wired to the real API.
2. Rename/delete/move folder actions are wired to the real API.
3. Batch move selected entries to an existing folder or root is wired to the real API.
4. Empty and error states are present for the v1 baseline.

Acceptance:

- batch move is persisted and reflected after refresh;
- deleting folders never deletes score assets silently;
- unavailable shared/bookmarked scores remain clearly marked.

### P5 - Cleanup And Documentation `[completed for v1 baseline]`

1. Move or delete obsolete `components/history` code.
2. Rename hooks and types from history to library where they now represent library behavior.
3. Update frontend/backend engineering principles where the library domain affects current rules.
4. Update E2E/tests from history wording to library wording.

Acceptance:

- no new `history`-named API/type owns library behavior;
- docs describe private library versus future public score library clearly.

### P6 - My Scores / Library IA Split `[completed for v1 split]`

1. Add `/my-scores` as the creator asset management surface.
2. Add backend owner read model/API for My Scores based on `scores.owner_user_id`.
3. Move owner actions to My Scores: edit, delete, publish/unpublish, owner sharing, versions,
   metadata management, and visibility state.
4. Update navigation to show both "我的乐谱库" and "我的作品".
5. Keep `/library` focused on learning, practice, favorites, bookmarks, and folder
   organization.
6. Remove "我的上传" / `owned` as a primary Library product concept.

Acceptance:

- owned score management is only presented in My Scores;
- Library does not imply ownership management;
- a user can add an owned score to Library only through explicit `SELF_ADDED` semantics;
- results/editor/share routes preserve correct return paths for both entry points.

### P7 - Library Source-Type Cleanup `[completed for v1 split]`

1. Replace Library `source_type=OWNED` with `SELF_ADDED` in schema, API, frontend types, and UI.
2. Stop auto-creating Library entries for every uploaded score unless the upload flow explicitly
   asks to add the score to Library.
3. Keep `BOOKMARK` for saved shared/public scores.
4. Reserve `SHARED`, `OFFICIAL`, and `AI_RECOMMENDED` for future entry sources.
5. Because the project is still pre-production, clear local development data rather than adding
   compatibility fallbacks.

Acceptance:

- Library source labels describe why a score is in the learning library, not who owns it;
- My Scores remains the source of truth for owned-score management;
- no request-time fallback creates missing Library entries from owned scores.

### P8 - Library Learning State `[completed for v1 learning workspace]`

1. Add `practice_state` or equivalent read/write model for Library entries:
   `TO_PRACTICE`, `IN_PROGRESS`, `MASTERED`.
2. Add recent-practice read model using practice sessions or `last_practiced_at`.
3. Update Library virtual nodes to: recent practice, favorites, to-practice, mastered, folders.
4. Keep directory depth technically flexible but product-guided to 2-3 levels.

Acceptance:

- Library feels like a learning workspace, not a duplicate score-management table;
- practice status and folder placement are per user;
- deleting folders never deletes score ownership, revisions, or artifacts.

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

- owned score appears in "我的作品";
- a self-added owned score appears in Library only after explicit add-to-library behavior;
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

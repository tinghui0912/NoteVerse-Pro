# NoteVerse Library Domain Baseline

> Status: completed v1 baseline
> Baseline date: 2026-06-24
> Scope: private learning library and creator-owned My Scores.

## 1. Purpose

The old `/history` surface mixed processing history, owned scores, saved shares, thumbnails,
filters, pagination, and batch actions. The current product separates those concerns:

- `/my-scores` is creator asset management for scores owned by the current user.
- `/library` is the user's private learning and collection workspace.
- future public discovery belongs to a separate public catalog/community domain.

This split prevents the same score from being presented as both an owned work and a saved
learning-library item in the same tree.

## 2. Product Principles

1. `/my-scores` is the only creator asset management surface for owned scores.
2. `/library` organizes learning, practice, favorites, bookmarks, and user folders.
3. Library folders organize per-user entries, not canonical score ownership.
4. Deleting a library folder must never silently delete score revisions or artifacts.
5. A bookmark is a library source, not an authorization mechanism.
6. Share links grant access; library entries organize a user's own view.
7. Library source labels describe why an entry is in the library, not who owns the score.
8. URL state should describe the current view, folder, search, sort, and page.
9. Public catalog/community, team libraries, and marketplace features are separate future domains.

## 3. Current Routes

Library:

```text
/library
/library?view=all
/library?view=favorites
/library?view=recent_practice
/library?view=to_practice
/library?view=mastered
/library?view=bookmarks
/library?folder=<folder_uuid>
/library?folder=<folder_uuid>&search=chopin&sort=updated_desc&page=2
```

My Scores:

```text
/my-scores
/my-scores?view=all
/my-scores?view=drafts
/my-scores?view=private
/my-scores?view=published
/my-scores?search=canon&sort=updated_desc&page=2
```

Results return origins:

```text
/results/<score_id>?from=my-scores
/results/<score_id>?from=shares
```

## 4. Backend Model

### 4.1 `ScoreLibraryFolder`

Table: `score_library_folders`

```text
id
folder_uuid
user_id
parent_folder_id nullable
name
position
created_at
updated_at
deleted_at nullable
```

Rules:

- `(user_id, parent_folder_id, name)` is unique for active folders.
- `parent_folder_id = null` means root-level folder.
- folder deletion is soft deletion.
- folder moves prevent cycles.
- non-empty folder deletion uses an explicit content handling mode.

### 4.2 `ScoreLibraryEntry`

Table: `score_library_entries`

```text
id
entry_uuid
user_id
score_id
source_type = SELF_ADDED | BOOKMARK
folder_id nullable
is_favorite
practice_state = TO_PRACTICE | IN_PROGRESS | MASTERED
last_practiced_at nullable
created_at
updated_at
deleted_at nullable
```

Rules:

- one active entry per `(user_id, score_id, source_type)`;
- `SELF_ADDED` means the user intentionally added a score to their learning library;
- `BOOKMARK` means the user saved a shared/public score;
- `OWNED` is intentionally not a Library source type;
- uploaded/owned scores appear in `/my-scores`; confirmed scores are added to `/library` from the review completion flow;
- finishing a practice session updates active library entries for that user and score:
  `last_practiced_at = now`, and `TO_PRACTICE` advances to `IN_PROGRESS`.

### 4.3 Taxonomy Baseline

The score style/genre selector uses the taxonomy tag model:

```text
TaxonomyCategory(code='genre')
TaxonomyTag(code='classical' | 'pop' | 'jazz' | ...)
ScoreTaxonomyTag(score_id, tag_id)
```

The database migration chain includes a taxonomy seed baseline so worker-created scores can
attach submitted tags such as `genre:pop` without request-time fallback.

## 5. Backend API

Registered prefixes:

```text
/api/v1/library
/api/v1/my-scores
```

### 5.1 Library Folders

```text
GET    /api/v1/library/folders
POST   /api/v1/library/folders
PATCH  /api/v1/library/folders/{folder_id}
DELETE /api/v1/library/folders/{folder_id}?mode=<mode>
```

Delete modes:

```text
MOVE_CONTENTS_TO_PARENT
MOVE_CONTENTS_TO_ROOT
TRASH_CONTENTS
```

`GET /library/folders` returns:

```text
all_count
favorite_count
recent_practice_count
to_practice_count
mastered_count
folders[]
```

Each folder includes direct and recursive entry counts.

### 5.2 Library Entries

```text
GET   /api/v1/library/entries
PATCH /api/v1/library/entries/{entry_id}
POST  /api/v1/library/entries/batch-move
```

Supported entry list query:

```text
view=all|favorites|recent_practice|to_practice|mastered|bookmarks|trash
folder_id=<folder_uuid>
search=<text>
sort=updated_desc|updated_asc|name_asc|name_desc|practiced_desc
page=1
page_size=20
```

`PATCH /library/entries/{entry_id}` updates the entry's per-user state:

```json
{
  "practice_state": "MASTERED",
  "is_favorite": true,
}
```

`POST /library/entries/batch-move` moves selected entries to a folder or root:

```json
{
  "entry_ids": ["..."],
  "target_folder_id": null
}
```

### 5.3 My Scores

```text
GET /api/v1/my-scores
```

Query:

```text
view=all|drafts|private|published
search=<text>
sort=updated_desc|updated_asc|name_asc|name_desc
page=1
page_size=20
```

My Scores reads owned score rows directly from `scores.owner_user_id`. It does not derive
ownership from `score_library_entries`.

## 6. Frontend Ownership

Current API/type owners:

```text
frontend/src/lib/api/library.ts
frontend/src/lib/api/my-scores.ts
frontend/src/types/api/library.ts
frontend/src/types/api/my-scores.ts
frontend/src/hooks/queries/use-library-queries.ts
frontend/src/hooks/queries/use-my-scores-queries.ts
queryKeys.library
queryKeys.myScores
```

Current routes:

```text
frontend/src/app/[locale]/library/page.tsx
frontend/src/app/[locale]/my-scores/page.tsx
frontend/src/app/[locale]/history/page.tsx
```


## 7. Current UX

Library sidebar:

- All scores -> `view=all`
- Recent practice -> `view=recent_practice`
- Favorites -> `view=favorites`
- To practice -> `view=to_practice`
- Mastered -> `view=mastered`
- User folders -> `folder=<folder_uuid>`

Library entries:

- support grid cards;
- support batch selection and move;
- show per-user learning state;
- allow changing learning state from the card;
- route saved shared scores back through `from=shares`;
- route non-bookmark entries through `from=my-scores`.

My Scores:

- lists owned score assets;
- supports owner status views;
- is the source of truth for creator management.

## 8. Relationship To Sharing And Publication

- Share grants are view-only access grants.
- Saving a shared score creates/restores a `BOOKMARK` library entry.
- Revoked or expired share access may leave an unavailable library entry.
- Public publication is separate from private Library organization.
- Owned score publication, owner sharing, editing, deletion, and revision management belong
  to My Scores and score-owner flows, not the Library folder tree.

## 9. Completed Phases

### P0 - Contract Decisions `[completed]`

- `/library` is the product surface.
- legacy `/history` has been removed; `/library` is the canonical route.
- virtual nodes are not persisted folders.
- folder deletion modes are explicit.

### P1 - Backend Schema And Read Model `[completed]`

- added `ScoreLibraryFolder`;
- added `ScoreLibraryEntry`;
- added source type enum cleanup with `SELF_ADDED`;
- added learning state with `TO_PRACTICE`, `IN_PROGRESS`, `MASTERED`;
- added taxonomy seed baseline for genre/style tags;
- added Library and My Scores API modules.

### P2 - Frontend Data Layer `[completed]`

- added Library API facade, types, query keys, and query hooks;
- added My Scores API facade, types, query keys, and query hooks.

### P3 - Library And My Scores Pages `[completed]`

- added `/library`;
- added `/my-scores`;
- removed legacy `/history`;
- updated nav and result return origins.

### P4 - Folder Mutations And Batch Move `[completed]`

- create, rename, move, and delete folder are wired to API;
- batch move selected library entries is wired to API;
- deletion does not delete score assets.

### P5 - Cleanup And Documentation `[completed]`

- removed obsolete History component/hook runtime files;
- kept only the legacy redirect route;
- updated docs and routing tests.

### P6 - My Scores / Library IA Split `[completed]`

- owned score management is under My Scores;
- Library is learning/collection organization;
- Library no longer has an `owned` primary view.

### P7 - Library Source-Type Cleanup `[completed]`

- `OWNED` was removed from Library sources;
- `SELF_ADDED` is the explicit learning-library source for user-owned scores;
- automatic Library entry creation for upload was removed.

### P8 - Library Learning State `[completed]`

- entries have per-user `practice_state`;
- Library has recent-practice, to-practice, and mastered views;
- practice completion updates recent-practice state for active library entries.

## 10. Validation Performed

Recent validation for this baseline included:

```text
python -m py_compile backend changed files and migrations
npm run typecheck
npm run lint
npm run test:unit
docker compose -f docker-compose.backend-dev.yml run --rm api alembic heads
docker compose -f docker-compose.backend-dev.yml run --rm api alembic upgrade head
docker compose -f docker-compose.backend-dev.yml run --rm api alembic current
docker compose -f docker-compose.backend-dev.yml run --rm api pytest tests/test_api_smoke.py -q
```

Known test gap:

- there is no dedicated `backend/tests/test_library_domain.py` yet;
- current backend coverage is smoke-level for route protection plus migration/runtime checks.

## 11. Deferred Work

These are intentionally not part of the completed v1 baseline:

- public community catalog;
- team/organization libraries;
- marketplace, comments, ratings, recommendations;
- per-user custom score aliases;
- automated trash retention;
- richer capability projection in Library entries;
- full drag-and-drop folder reordering;
- collaborative edit invitations and team libraries.

## 12. Next Implementation Phases

The v1 baseline proves the domain split, but the product is not yet competitive with mature
content platforms. The following phases turn the baseline into a production-grade management
surface.

### P9 - Processing Queue In My Scores `[completed]`

Purpose: users must not need to remain on `/upload` to know whether a score succeeded.

Tasks:

- surface active and failed `ProcessingJob` rows in `/my-scores`; `[completed: initial UI]`
- add My Scores views for processing and failed uploads; `[completed: initial UI]`
- show processing progress, current step, failure reason, and produced score link when ready; `[completed]`
- allow failed jobs to be dismissed or retried through explicit job actions; `[completed]`
- keep failed jobs out of `/library`, because they are not playable learning entries yet.

Initial implementation notes:

- `/my-scores` now combines owned scores with active/failed processing jobs from `/jobs`;
- processing and failed views are frontend aggregate views, not score API views;
- job submission stores `requested_options`, so retries preserve score title and taxonomy tags;
- failed jobs can be dismissed or retried through `POST /jobs/{job_id}/retry`;
- retry creates a new processing job from the original uploaded files and saved request options;
- if the original upload file has been removed, retry fails explicitly instead of silently
  asking the user to re-upload.

Acceptance:

- uploading a score creates a visible item in My Scores immediately;
- a failed upload remains visible after navigation or refresh;
- users can inspect the failure and take a next action;
- successful jobs route to the produced score identity, not the job identity.

### P10 - My Scores Management Actions `[completed]`

Purpose: `/my-scores` should behave like a creator asset manager, not a static card list.

Tasks:

- add visible search and sort controls wired to existing API parameters; `[completed: initial UI]`
- add batch selection; `[completed]`
- add owner actions: delete; `[completed]`
- add owner actions: publish and unpublish; `[completed]`
- add restore-from-archive after the score model gains an explicit restore-state contract; `[completed]`
- show richer owner status: processing, failed, draft, private, published; `[completed: initial UI]`
- add pagination controls and empty states for each view; `[completed: pagination controls]`

Initial implementation notes:

- `/my-scores` supports selecting visible score cards and clearing selection;
- selected owned scores can be deleted through `POST /scores/batch-delete`;
- confirmed owned scores are added to the learning Library from the review completion flow;
- paginated My Scores API results can be traversed from the page UI without losing filters;
- Score reads include a lightweight publication summary so My Scores can show published state
  without fetching each score's publication separately;
- batch publish is exposed only in the Private view; batch unpublish is exposed only in the
  Published view; archived scores cannot be published at the backend service layer.

Acceptance:

- users can find, sort, and manage owned scores without opening each score;
- owned-score management stays out of the Library folder tree;
- Library membership for owned scores is created by review confirmation, not by a manual My Scores action.

### P11 - Library Management Actions And Folder Depth `[completed]`

Purpose: `/library` should behave like a personal learning workspace.

Tasks:

- add visible search and sort controls wired to existing API parameters; `[completed: initial UI]`
- add pagination controls wired to existing API pagination; `[completed]`
- add batch favorite, archive, trash, and move actions; `[completed]`
- enforce a product folder depth limit of 2 levels in UI and backend validation; `[completed]`
- keep database hierarchy cycle protection; `[completed]`
- expose clear empty states for recent practice, to-practice, mastered, favorites, and folders; `[completed]`

Acceptance:

- users can manage many saved scores at once;
- folder depth cannot exceed the product limit through UI or API;
- Library actions do not affect score ownership or canonical revisions.

### P12 - Component Extraction And Dedicated Tests `[completed]`

Purpose: keep the new management surfaces maintainable as behavior grows.

Tasks:

- split `/library` into domain components and hooks under `components/library` and
  `hooks/library` where useful; `[completed: initial components]`
- split `/my-scores` into domain components and hooks under `components/my-scores` and
  `hooks/my-scores` where useful; `[completed: initial components]`
- add backend Library/My Scores domain tests beyond route-auth smoke; `[completed: service regressions]`
- add frontend tests for Library folder tree and My Scores view helpers; `[completed]`
- add frontend tests for URL state, search/sort, batch actions, and processing/failed states; `[completed]`

Initial implementation notes:

- `/my-scores` now delegates filter controls, bulk actions, score cards, processing-job cards,
  and pagination to `components/my-scores`;
- `/library` now delegates sidebar navigation, entry cards, folder dialogs, filter controls,
  pagination, and bulk actions to `components/library`;
- My Scores and Library cards default to browsing mode without checkboxes; checkboxes and
  batch action bars appear only after the user enters batch edit mode;
- score cards keep primary navigation clean and expose secondary actions through a hover/focus
  overflow menu instead of permanent card-level buttons;
- My Scores and Library read models include `thumbnail_artifact_id`, allowing cards to render
  the first generated `RENDERED_PAGE` artifact while keeping list payloads light;
- Library folder tree helpers live in `lib/library/folder-tree.ts` with unit coverage for
  view normalization, folder depth, subtree height, descendants, and sorting;
- My Scores view helpers live in `lib/my-scores/views.ts` with unit coverage for
  score-backed views versus processing/failed aggregate views;
- Library and My Scores URL builders live in `lib/library/state.ts` and
  `lib/my-scores/state.ts`, with unit coverage for search, sort, folder/view, and page state;
- My Scores batch action visibility is covered for private and published views;
- backend service regressions cover review-confirmed Library entry creation and owner deletion behavior.

Acceptance:

- page files remain composition layers;
- domain behavior has focused tests;
- future Library/My Scores changes do not reintroduce History or `OWNED` semantics.




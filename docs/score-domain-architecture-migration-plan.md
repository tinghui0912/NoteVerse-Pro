# NoteVerse Score Domain Architecture Migration Plan

> Status: completed, implementation and current development database cutover verified
> Baseline date: 2026-06-22  
> Scope: processing jobs, scores, revisions, artifacts, metadata, sharing,
> publication, practice references, frontend contracts, and results playback layout.

## 1. Purpose

The current product uses `Task` as both a short-lived processing record and the durable
identity of a user's score. This plan separates those responsibilities without introducing
event sourcing, a revision graph, a generic EAV model, or speculative read models.

The target outcome is:

- processing failures and retries remain job concerns;
- a score remains a stable user-owned product resource;
- MusicXML edits create immutable, linear score revisions;
- structured metadata remains queryable and rebuildable;
- durable file outputs use a revision-aware artifact registry;
- publication pins an explicit revision;
- sharing, membership, bookmarks, and publication have distinct semantics;
- backend-computed capabilities are authoritative for every frontend surface;
- results can show the complete score while playback controls remain continuously available.

This document is the authoritative execution board for this migration. The completed
frontend architecture plan remains historical context, not the task board for this work.

## 2. Guardrails And Explicit Non-Goals

### 2.1 Required principles

1. Keep the canonical MusicXML revision as the source of truth.
2. Keep metadata a typed relational projection; an optional JSON snapshot may support
   diagnostics but cannot replace the query projection.
3. Use artifacts for stored payloads such as MusicXML, SVG, PDF, audio, and diagnostics.
4. Keep revisions linear. A parent revision records provenance, not a branching graph.
5. Keep publication separate from score editing and pin a published revision.
6. Keep public access and ordinary share links view-only; editable collaboration requires
   an authenticated invite or membership acceptance flow.
7. Compute authorization on the backend for every request; frontend capabilities only
   describe already-enforced backend decisions.
8. Do not preserve indefinite compatibility endpoints or re-export layers after cutover.
9. Preserve storage abstraction, worker idempotency, heartbeat, retry, and cleanup rules.
10. Make each delivery slice independently testable and remove temporary migration code
    before declaring its phase complete.

### 2.2 Deferred until a demonstrated requirement exists

- revision branching, merging, or a general revision graph;
- event sourcing;
- per-revision ACLs;
- a persisted temporary principal for every anonymous visitor;
- a generic polymorphic resource table for non-score domains;
- `PublishedScoreView` or a materialized public catalog table;
- comments, teams, organizations, ranking, and recommendation systems;
- automatic PDF/audio generation when no product feature consumes those artifacts.

## 3. Current-State Audit

### 3.1 Database ownership today

| Current model | Mixed responsibility | Migration consequence |
| --- | --- | --- |
| `Task` | processing state, legacy score metadata, durable score identity | split into `ProcessingJob` and `Score` |
| `TaskStep` | job execution steps | move unchanged to `ProcessingJobStep` |
| `File` | inputs, pipeline intermediates, canonical XML, rendered outputs | split job artifacts from revision-aware score artifacts |
| `TaskUpload` | uploaded source linkage | rename to processing-job input linkage |
| `Share` | bearer link plus view/edit/download policy | replace with `ScoreShareGrant` |
| `SavedShare` | collection entry and implicit access path | split bookmark from grant redemption |
| `PracticeSession` | session plus mutable `task_id`/source string | pin `score_id` and `revision_id` |

The current `File` uniqueness constraint `(task_id, kind, page_number)` means XML saves
replace a role such as `current_xml` or `final_xml`; it cannot represent immutable history.

### 3.2 Backend coupling today

- `modules/tasks` handles both job polling and durable score list/update/delete/archive.
- `modules/xml` reads and overwrites `CURRENT_XML` and `FINAL_XML` file records.
- `modules/files` authorizes and resolves downloads through `Task`.
- `modules/shares` exposes task details and task-owned files through share tokens.
- `modules/practice` resolves a task, selects current/final XML, and stores `task_id` and
  `share_token` in the session.
- `app/utils/permissions.py` combines owner, saved-share, and token rules outside a clear
  score-domain policy boundary.
- pipeline output keys and recorded files use `tasks/{task_uuid}/{kind}/...`.
- Celery maintenance, heartbeat, stale recovery, and idempotency correctly belong to the
  processing side and must not move into the score domain.

### 3.3 Frontend coupling today

- `/review/[id]`, `/results/[id]`, `/editor/[id]`, and `/practice/[id]` all interpret the
  same route value as a task ID and score ID.
- history lists tasks as user-owned scores and saved shares as another collection.
- API types expose `TaskDetails` containing score metadata and all task files.
- `tasks`, `xml`, `files`, `shares`, and `practice` API facades all pass `taskId`.
- React Query keys use task identity for score details and XML content.
- editor routing uses `source=current|final`, reflecting storage roles instead of revision
  identity.
- local draft keys, autosave, results actions, downloads, breadcrumbs, and E2E fixtures all
  assume task identity.

### 3.4 Playback layout today

- results now expands every Verovio page to its full height;
- `ScorePreviewPanel` owns both the rendering viewport and controls;
- controls remain after the complete score in normal document flow;
- window-level score following is not a first-class policy after removing the constrained
  inner viewport;
- the existing controller may scroll an internal overflow ancestor, but there is no explicit
  manual-scroll suspension or 鈥渞eturn to playback position鈥?interaction.

## 4. Target Domain Model

```text
Upload
  |
  v
ProcessingJob ---- ProcessingJobStep
  |        \
  |         `---- ProcessingArtifact (internal/intermediate)
  | produces
  v
Score ---- ScoreMembership
  |  \----- ScoreLibraryEntry
  |  \----- ScoreShareGrant ---- ShareGrantRedemption
  |  `----- ScorePublication
  |
  v
ScoreRevision ---- ScoreRevisionMetadata
  |
  `---- ScoreArtifact (MusicXML/render/export/audio/diagnostic payloads)

PracticeSession ---- pinned ScoreRevision
```

### 4.1 ProcessingJob

Owns only processing lifecycle and reliability:

```text
id, job_uuid, user_id, state, progress, current_step
idempotency_key, code, error, error_type
requested_at, started_at, last_heartbeat_at, finished_at
score_id nullable, created_at, updated_at
```

- A job may fail without creating a score.
- A job creates a score once normalized editable MusicXML exists.
- `score_id` records the produced resource without making score lifecycle depend on job state.
- worker payloads continue to carry durable upload IDs and job UUIDs, never API-local paths.

### 4.2 Score

Stable product aggregate:

```text
id, score_uuid, owner_user_id, title
state = IN_REVIEW | ACTIVE | ARCHIVED
head_revision_id
approved_revision_id nullable
originating_job_id nullable
version, created_at, updated_at
```

- `head_revision_id` is the latest editable document.
- `approved_revision_id` records review approval, not public publication.
- title belongs to the score, not the processing job.
- style/genre classification uses the taxonomy tag model rather than a fixed score column.
- `version` supports optimistic concurrency for score-level metadata changes.
- public visibility is deliberately absent; publication is a separate entity.

### 4.3 ScoreRevision

Immutable, linear document revision:

```text
id, revision_uuid, score_id, revision_number
parent_revision_id nullable
content_hash
origin = OMR | EDIT | IMPORT | FINGERING
created_by_user_id nullable
created_by_job_id nullable
base_revision_id nullable
created_at
```

Invariants:

- `(score_id, revision_number)` is unique.
- a revision never changes after commit;
- a new revision must name the current head as its base or receive `409 REVISION_CONFLICT`;
- identical content hashes produce an idempotent no-op rather than duplicate revisions;
- autosave uses content-hash deduplication and a stable request idempotency key;
- revisions remain linear even when a historical revision is opened: saving it creates a
  new head derived from the historical base only after an explicit conflict decision.

### 4.4 ScoreArtifact

Registry for immutable stored payloads associated with one revision:

```text
id, artifact_uuid, revision_id
kind = MUSICXML | RENDERED_PAGE | EXPORT_PDF | AUDIO_PREVIEW | DIAGNOSTIC_JSON
storage_backend, storage_key, filename, mime_type, size_bytes, sha256
page_number nullable
render_profile nullable
generator, generator_version
created_at
```

Rules:

- exactly one canonical `MUSICXML` artifact exists per revision;
- rendered pages are unique by `(revision_id, kind, render_profile, page_number)`;
- a render profile describes renderer-independent layout inputs; it does not expose Verovio
  implementation details to business modules;
- storage keys for new data use
  `scores/{score_uuid}/revisions/{revision_uuid}/{kind}/...`;
- existing storage objects are not moved merely to make paths visually consistent;
- original uploads and internal OMR/enhanced XML remain job inputs/artifacts unless they
  become an explicit score revision.

### 4.5 ProcessingArtifact

Optional replacement for job-owned `File` kinds that are not score revisions:

```text
id, job_id, kind
storage_backend, storage_key, filename, mime_type, size_bytes, sha256
page_number nullable, created_at
```

Expected kinds initially include original review images, OMR output, enhanced XML, and
diagnostics. Do not use `ScoreArtifact` as a dumping ground for pipeline internals.

### 4.6 ScoreRevisionMetadata

Typed, rebuildable one-to-one projection:

```text
revision_id
status = PENDING | READY | FAILED
measure_count nullable
playback_duration_ms nullable
part_count nullable
primary_key_fifths nullable
primary_mode nullable
key_signature_events JSON
time_signature_events JSON
tempo_events JSON
extractor_version
error_code nullable
computed_at nullable
```

Rules:

- MusicXML is canonical; metadata may be deleted and rebuilt.
- frequently filtered values are typed columns with indexes when real queries require them.
- changing keys, meters, and tempos remain structured event arrays.
- duration semantics must be documented: tempo changes and repeat expansion policy are part
  of the extractor version.
- Verovio page count is render-layout data, not score metadata.
- a metadata JSON artifact is optional for diagnostics and reproducibility, not required for
  normal API reads.

### 4.7 ScoreMembership

Persistent authenticated collaboration:

```text
score_id, user_id
role = OWNER | EDITOR | VIEWER
created_by, created_at, revoked_at nullable
```

- owner remains represented by `Score.owner_user_id`; an OWNER membership row is optional
  and should not create two owner sources of truth;
- EDITOR can create revisions but cannot publish or manage access;
- VIEWER is durable access, not a bookmark.

### 4.8 ScoreShareGrant

Bearer entrance grant for view-only share links:

```text
id, score_id, token_hash
target_mode = LATEST | PINNED
target_revision_id nullable
allow_download, allow_practice
expires_at nullable, revoked_at nullable
created_by, created_at
```

- raw tokens are returned once and never stored; only a secure hash is persisted;
- a valid grant may authorize anonymous read access while valid;
- share links never authorize editing;
- grant expiry/revocation is evaluated on every protected read or redemption;
- target invariants require a revision only for `PINNED` mode.

### 4.9 ScoreLibraryEntry And ShareGrantRedemption

Bookmarks organize the user's library and are not authorization by themselves:

```text
ScoreLibraryEntry(score_id, user_id, source_type=BOOKMARK, is_favorite, folder_id, practice_status, created_at)
ShareGrantRedemption(grant_id, user_id, created_at)
```

- saving a shared score creates or updates a library entry with `source_type=BOOKMARK` and records which valid grant was redeemed;
- a redeemed share grant remains bounded by the original grant expiry and revocation;
- an inaccessible library entry may remain visible with an unavailable state, but cannot bypass
  authorization;

### 4.10 ScorePublication

Public channel configuration, not a second score:

```text
score_id unique
public_slug unique
published_revision_id
status = PUBLISHED | UNPUBLISHED
discoverability = LISTED | UNLISTED
allow_download, allow_practice
published_by, published_at, updated_at
```

- only the owner can publish, republish, or unpublish;
- public reads always resolve `published_revision_id`;
- editing the score head does not silently change public content;
- republishing explicitly advances the pinned revision;
- cover, description, and tags belong to `Score` when intrinsic and to Publication only when
  they are genuinely public-channel overrides;
- no separate `PublishedScoreView` is created until public discovery queries justify it.

### 4.11 PracticeSession

Replace mutable task/source lookup with reproducible references:

```text
score_id
revision_id
user_id
access_origin = OWNER | MEMBERSHIP | SHARE | PUBLICATION
share_grant_id nullable
```

- session creation resolves access once and pins a revision;
- runtime registration uses the pinned revision artifact;
- subsequent score edits or republication cannot change an active or historical session;
- do not store raw share tokens in practice session rows.

## 5. Authorization Contract

### 5.1 Central policy input

```text
AccessContext
- subject: anonymous | authenticated user
- score
- revision optional
- channel: owner | member | share | publication
- validated grant/membership/publication optional
- requested action
```

The server derives channel and grants from credentials and route context. It never trusts a
client-provided `access_mode`.

### 5.2 Initial action set

```text
VIEW_SCORE
VIEW_REVISION
EDIT_SCORE
DOWNLOAD_ARTIFACT
START_PRACTICE
CREATE_SHARE
MANAGE_MEMBERS
PUBLISH_SCORE
MANAGE_SCORE
```

### 5.3 Capability response

Score-facing responses return an action-oriented object:

```json
{
  "can_view": true,
  "can_edit": false,
  "can_download": true,
  "can_practice": true,
  "can_share": false,
  "can_manage_members": false,
  "can_publish": false,
  "can_manage": false
}
```

Capabilities are contextual to the returned score/revision and current request identity.
They are hints for UI composition, never substitutes for endpoint authorization.

## 6. Target API Surface

Because the product is pre-release, introduce clear resources under `/api/v1` and remove the
old task-as-score endpoints in the final contract phase. If external consumers appear before
cutover, freeze `/v1` and move this contract to `/v2` instead.

### 6.1 Processing jobs

```text
POST   /jobs
GET    /jobs/{jobId}
POST   /jobs/status/batch
DELETE /jobs/{jobId}
```

Submission returns `job_id`; status returns `score_id` as soon as a score exists. Job list
endpoints are for active/failed processing, not the durable score library.

### 6.2 Scores and revisions

```text
GET    /scores
GET    /scores/{scoreId}
PATCH  /scores/{scoreId}
DELETE /scores/{scoreId}
POST   /scores/batch-delete
POST   /scores/archive
GET    /scores/{scoreId}/revisions
GET    /scores/{scoreId}/revisions/{revisionId}
GET    /scores/{scoreId}/revisions/{revisionId}/content
POST   /scores/{scoreId}/revisions
POST   /scores/{scoreId}/approve
```

Revision creation accepts canonical MusicXML, `base_revision_id`, and an idempotency key.
Approval advances `approved_revision_id` to the current head after validation.

### 6.3 Artifacts and metadata

```text
GET /scores/{scoreId}/metadata
GET /scores/{scoreId}/artifacts
GET /scores/{scoreId}/artifacts/{artifactId}/access-url
GET /scores/{scoreId}/artifacts/{artifactId}/download
POST /scores/{scoreId}/exports
```

Export creation is added only for formats the product actually supports. Artifact IDs replace
user-facing `file_type + task_id + page` addressing.

### 6.4 Sharing and membership

```text
GET    /scores/{scoreId}/share-grants
POST   /scores/{scoreId}/share-grants
POST   /scores/{scoreId}/share-grants/{grantId}/revoke
GET    /share-grants/{token}
POST   /share-grants/{token}/bookmark
GET    /scores/{scoreId}/members
DELETE /scores/{scoreId}/members/{userId}
```

The token route returns a score read model, resolved revision, capabilities, and grant expiry;
it does not return a nested task object.

### 6.5 Publication

```text
PUT    /scores/{scoreId}/publication
DELETE /scores/{scoreId}/publication
GET    /public/scores/{slug}
```

The public endpoint supports optional authentication so account-only actions can be shown,
but anonymous read behavior does not depend on backend session availability.

### 6.6 Library read model

```text
GET /library
```

The library response is a typed union of processing entries and score entries, ordered with
a stable `(created_at, kind, id)` cursor. It is assembled by repository queries and service
composition; do not create a persisted library/materialized-view table initially. Bookmarks
are returned as score entries with current access availability, not as a third resource type.

### 6.7 Practice

```text
POST /practice/sessions
{
  "score_id": "...",
  "revision_id": "..." // optional; server resolves contextual default
}
```

The response includes the pinned revision. Share/public access is derived from the access
context rather than a persisted raw token.

## 7. Frontend Target Contract

### 7.1 Route identity

| Surface | Current identity | Target identity |
| --- | --- | --- |
| upload polling | task ID | job ID |
| review | task ID | job ID with produced score ID |
| results | task ID | score ID |
| editor | task ID + current/final | score ID + base revision |
| practice | task ID + current/final | score ID + pinned revision |
| share | share token | share-grant token |
| public | absent | publication slug |
| history/library | task rows | score rows plus active-job status |

The target editor route is `/editor/[scoreId]`. Normal editing loads the score head. Opening
a historical revision is explicit and saving it must resolve conflicts; `source=current|final`
is deleted after cutover.

### 7.2 Frontend type packages

Add focused contracts:

```text
types/api/jobs.ts
types/api/scores.ts
types/api/revisions.ts
types/api/artifacts.ts
types/api/access.ts
types/api/publications.ts
```

Keep `@/types/api` as the public barrel. Remove task-owned score fields once consumers move.

### 7.3 API facades and Query keys

Target facades:

```text
lib/api/jobs.ts
lib/api/scores.ts
lib/api/revisions.ts
lib/api/artifacts.ts
lib/api/access.ts
lib/api/publications.ts
```

Target Query roots:

```text
jobs
scores
revisions
artifacts
shareGrants
publications
practice
```

Mutation owners invalidate score detail, head revision, metadata, artifact, library, and
publication caches explicitly. Do not invalidate job caches for ordinary score edits.

### 7.4 Page behavior changes

- upload polls `Job` and follows `score_id` when review/results become available;
- review compares job inputs with the produced score head and approves that revision;
- results reads one score detail read model, head revision content, metadata, capabilities,
  artifacts, grants, and publication state;
- editor saves a new revision using `base_revision_id` and handles conflicts explicitly;
- history lists durable scores; active or failed jobs are represented as processing entries,
  not fake score records;
- share consumes grant capabilities without reconstructing owner/public/member rules;
- public gets a separate read-only page and route exception;
- practice creates a session for a score revision and displays the pinned revision.

## 8. Results Playback Layout Plan

This work is independent from the database migration and should ship first.

### 8.1 Target interaction

- keep complete Verovio pages in normal document flow;
- remove nested score scrolling on results;
- render a compact playback dock fixed to the viewport bottom while results is mounted;
- reserve bottom page padding equal to the dock height plus safe-area inset;
- show play/pause, stop, loop, progress, elapsed time, and duration at all times;
- put future speed/metronome/volume controls in an expandable secondary panel;
- keep modal/editor consumers on the existing inline-controls composition;
- support keyboard play/pause without stealing focus from form fields.

### 8.2 Component ownership

```text
ResultsScorePlayer
鈹溾攢鈹€ ScorePreviewViewport
鈹溾攢鈹€ ResultsPlaybackDock
鈹斺攢鈹€ useScorePreviewPlayback

ListenModal
鈹溾攢鈹€ ScorePreviewViewport
鈹溾攢鈹€ InlineScorePreviewControls
鈹斺攢鈹€ useScorePreviewPlayback
```

Do not add renderer-specific behavior to results components. The hook owns playback state and
resource cleanup; the Verovio controller owns rendered SVG and cursor DOM.

### 8.3 Follow policy

- window/document scrolling becomes an explicit supported target;
- automatic following scrolls only when the active system leaves a safe viewport region;
- wheel, touch, scrollbar, Page Up/Down, Home/End, or manual navigation suspends auto-follow;
- while suspended, playback continues and a 鈥渞eturn to playback position鈥?control appears;
- resuming follow performs one controlled scroll and then restores threshold-based following;
- stopping or seeking to the beginning must not unexpectedly move the page unless the user
  explicitly resumes follow;
- follow state remains imperative/local and must not enter broad React context.

### 8.4 Responsive behavior

- desktop: centered dock aligned to the usable score workspace, capped to a readable width;
- mobile: full-width bottom dock with `env(safe-area-inset-bottom)` and compact labels;
- dock does not cover dialogs, toasts, cookie notices, or the final score system;
- right-column metadata remains sticky only where viewport height permits it.

### 8.5 Playback acceptance

1. Controls are visible before playback and at the first, middle, and final score systems.
2. A long multi-page score has one browser scrollbar and no visible nested score scrollbar.
3. The final score system and footer are not obscured by the dock.
4. Manual scrolling is not immediately undone during playback.
5. 鈥淩eturn to playback position鈥?restores following.
6. Cursor, opening-rest position, seek, loop, relayout, and AudioContext cleanup still pass.
7. Desktop and mobile Playwright coverage verifies the dock and safe-area layout.

## 9. Data Migration Strategy

The repository is pre-production, but migrations should still be deterministic and testable.
Default to a forward Alembic migration plus a repeatable backfill command. Squash migration
history only immediately before the first production baseline and only after every environment
can be reset deliberately.

### 9.1 Expand

1. Create new job, score, revision, metadata, artifact, access, publication, and bookmark tables.
2. Add nullable mapping fields needed for backfill.
3. Keep old tables read-only during backfill; do not introduce long-lived dual writes.
4. Add constraints only after backfill validation where necessary.

### 9.2 Backfill rules

For every current task:

1. Create a `ProcessingJob` preserving UUID, owner, state, progress, reliability timestamps,
   idempotency key, error data, and steps.
2. Preserve uploads through processing-job input links.
3. If no current/final XML exists, keep only the job.
4. If score XML exists, create one Score. Reuse the task UUID as the backfilled score UUID to
   preserve local route references; new data uses independent job and score UUIDs.
5. Convert distinct current/final XML payloads into revisions ordered by their creation role and
   content hash. Do not create duplicates for equal hashes.
6. Set head to the latest authoritative payload. Set approved revision when a final XML exists or
   the legacy workflow is already successful.
7. Attach preview/final rendered pages to the matching revision when the mapping is unambiguous;
   otherwise retain them as legacy processing artifacts and schedule regeneration.
8. Keep enhanced XML and OMR intermediates as processing artifacts.
9. Convert shares into score share grants with hashed tokens. Existing plaintext tokens require
   a one-time hashing migration before the plaintext column is removed.
10. Convert saved shares into bookmarks and grant redemptions without granting access beyond the
    original share expiry/revocation.
11. Pin practice sessions to the resolved legacy current/final revision and remove stored raw
    share tokens only after access-origin data is backfilled.

### 9.3 Storage migration

- database records may continue pointing at existing `tasks/...` storage keys;
- new writes use `jobs/...` and `scores/.../revisions/...` namespaces;
- a later storage compaction job may copy and verify old objects by hash;
- deleting or moving existing objects is not part of the schema cutover;
- all cleanup uses storage adapters, never direct durable path construction.

### 9.4 Validation report

The backfill command must emit counts for:

```text
jobs created
scores created
revisions created/deduplicated
canonical XML artifacts
unmapped rendered artifacts
metadata pending/ready/failed
share grants and redemptions
practice sessions pinned/unresolved
orphan rows and missing storage objects
```

Cutover is blocked while unresolved canonical XML or practice revision mappings remain.

### 9.5 Contract

1. Switch backend services and frontend to new tables/endpoints in one controlled phase.
2. Run backfill verification and full regression suites.
3. Remove old API routes, old Query keys, and current/final source routing.
4. Drop legacy tables/columns only after code and fixture searches have zero runtime references.
5. Do not leave compatibility wrappers as permanent extension points.

## 10. Ordered Delivery Board

### P0-1 Architecture decisions and contract fixtures

**Status:** completed on 2026-06-22.
**Dependencies:** none.

Tasks:

1. Record short ADRs for job/score identity, linear revisions, metadata projection, artifact
   boundaries, view-only sharing, and publication pinning.
2. Freeze target enums, invariants, error codes, and response examples.
3. Add representative MusicXML fixtures for changing key/meter/tempo, repeats, multi-part
   scores, and malformed metadata.
4. Define score lifecycle and review transition tests before implementation.
5. Confirm there are no external `/api/v1/tasks` consumers; otherwise select `/api/v2`.

Acceptance:

- decisions are explicit enough that schema and API work do not invent conflicting semantics;
- deferred features remain documented as non-goals;
- fixtures characterize current MusicXML and workflow behavior.

Delivered:

- ADR 0002 fixes job/score identity, linear immutable revisions, head/approved pointers,
  content-hash idempotency, and classified revision conflicts;
- ADR 0003 fixes the boundary between revision-owned stored artifacts and typed rebuildable
  metadata projections, including logical-measure and changing key/meter/tempo semantics;
- ADR 0004 fixes centralized policy actions, view-only share grants, bookmark separation,
  and revision-pinned publication;
- `backend/docs/contracts/score-domain-v1.json` freezes enums, identities, invariants,
  capabilities, target error codes, and request examples for both backend and frontend tests;
- backend fixtures cover two-part logical measure counting, key/meter/tempo changes, repeats,
  and well-formed MusicXML containing semantically invalid metadata;
- repository search found no external `/api/v1/tasks` consumer beyond the bundled frontend
  and tests, so the pre-release cutover may retain `/api/v1`; this decision must be revisited
  if an external consumer appears before P3/P4;
- focused validation passed: 4 backend contract/fixture tests, Ruff, 2 frontend contract
  tests, and ESLint.

### P0-2 Results persistent playback dock

**Status:** completed on 2026-06-23.
**Dependencies:** none; deliver independently before data-model work.

Tasks:

1. Separate score viewport and controls presentation without duplicating playback state.
2. Add results-only bottom dock and bottom-space reservation.
3. Add window follow, manual-scroll suspension, and return-to-cursor behavior.
4. Preserve inline controls in `ListenModal`.
5. Add long-score desktop/mobile Playwright coverage and focused hook/controller tests.

Acceptance: all criteria in section 8.5 pass.

Delivered:

- score viewport rendering is shared independently from controls presentation, while
  `use-score-preview-playback` remains the single owner of playback state and lifecycle;
- results renders the complete Verovio score without a nested vertical scroll area and keeps
  a compact, mobile-safe playback dock fixed to the viewport bottom;
- results reserves page-end space so the dock does not cover the final system or footer;
- playback follows the active system through window scrolling, suspends that follow after
  manual wheel, touch, keyboard, or scrollbar navigation, and exposes an explicit return action;
- `ListenModal` and other preview surfaces retain their existing inline control presentation;
- focused hook/controller tests cover follow suspension and window scrolling, while the
  long-score Playwright scenario covers desktop, mobile, middle-scroll, and footer behavior;
- validation passed: full ESLint, TypeScript, 48 unit/component tests, production build, and
  the results layout Playwright scenario.

### P1-1 New schema and model layer

**Status:** completed on 2026-06-22.
**Dependencies:** P0-1.

Tasks:

1. Add SQLModel models and Alembic expand migration.
2. Add database constraints and indexes for identity, revision ordering, artifact uniqueness,
   token hashes, publication slugs, memberships, bookmarks, and metadata status.
3. Add independent model-layer mypy coverage.
4. Add DB-backed repository tests for every invariant.

Acceptance:

- migrations upgrade and downgrade in a clean database;
- model-layer mypy passes;
- constraints reject invalid revision, grant, and publication combinations.

Delivered:

- added separate SQLModel ownership for processing jobs/artifacts, scores/revisions/artifacts/
  metadata, and score access/publication records under `app/db/models`;
- added an expand-only Alembic migration after `e7f8a9b0c123`; legacy task, file, share, and
  practice columns remain available while nullable score-domain practice references coexist;
- database constraints enforce UUID and idempotency identities, linear revision numbering and
  same-score pointers, content deduplication, one canonical MusicXML artifact, rendered-page
  identity, classified metadata failures, share target consistency, token hashes, memberships,
  bookmarks, redemptions, publication slugs, and revision-pinned publication;
- circular job/score/revision foreign keys are created and dropped in an explicit second phase;
- DB-backed invariant coverage rejects cross-score revision, share, and publication references
  plus duplicate artifacts, grants, memberships, and bookmarks;
- validation passed: Ruff, full mypy, independent model-layer mypy, 209 backend tests, and a
  clean PostgreSQL `upgrade head -> downgrade e7f8a9b0c123 -> upgrade head` cycle;
- no application repository or API has switched to the new tables; that cutover starts in P1-2.

### P1-2 Processing job extraction

**Status:** completed on 2026-06-22.
**Dependencies:** P1-1.

Tasks:

1. Create `modules/jobs` with router/service/repository/schemas/dependencies.
2. Move submission, status, maintenance, heartbeat, step tracking, worker service, and
   idempotency behavior from task ownership to job ownership.
3. Rename pipeline context identifiers and storage namespaces for new writes.
4. Preserve late acknowledgement, worker-lost rejection, prefetch, stale recovery, and failure
   marking exactly.
5. Update upload workflow contract to receive and poll a job ID.

Acceptance:

- processing can succeed/fail/retry without a Score row being required;
- existing Celery reliability tests remain green under job naming;
- no worker payload contains local paths.

Delivered:

- added the canonical `modules/jobs` router, schemas, service, submission, repositories,
  synchronous worker service, execution service, dependencies, and maintenance ownership;
- `POST /jobs`, `GET /jobs/{jobId}`, batch status, and delete now use `ProcessingJob`; the
  retired task submit/status endpoints and frontend clients were removed;
- upload submission and polling exchange `job_id`; completed jobs now return real `score_id`
  values from the score-domain creation path, with no legacy projection fallback;
- pipeline ownership now uses `JobContext`, `job_id`, and `job_temp`; new durable outputs use
  `jobs/{job_uuid}/{kind}/...` and are registered as `ProcessingArtifact` rows with hashes;
- worker payloads contain upload hashes only and always materialize them through storage;
- Job uploads are explicitly linked so orphan cleanup cannot delete queued or running inputs;
- Celery keeps late acknowledgement, worker-lost rejection, failure acknowledgement, soft/hard
  limits, prefetch 1, heartbeat updates, stale recovery, and dispatch-failure marking;
- legacy Task/File compatibility projection was removed during P4; score-facing routes now use
  Score, Revision, Artifact, Grant, Publication, and Practice contracts directly;
- validation passed after P4: backend Ruff, backend mypy, 193 backend tests, frontend
  lint/typecheck/build, 47 frontend unit/component tests, and 4 deterministic Playwright tests.

### P1-3 Score creation and revision service

**Status:** completed on 2026-06-22.
**Dependencies:** P1-2.

Tasks:

1. Create `modules/scores` and `modules/revisions` boundaries.
2. Create Score when normalized editable MusicXML is finalized by a job.
3. Commit the first immutable revision and canonical MusicXML artifact transactionally.
4. Implement revision deduplication, base-revision conflict detection, and idempotent saves.
5. Replace current/final overwrite semantics with head and approved pointers.
6. Make review approval advance approved revision without copying files.
7. Ensure score deletion defines artifact, publication, membership, bookmark, and practice
   retention behavior explicitly.

Acceptance:

- no XML save overwrites a canonical artifact;
- concurrent stale saves return a classified conflict;
- review approval is a pointer/state transition, not a file copy.

**Result:** `modules/scores` and `modules/revisions` own score creation, immutable revision
append, deduplication, base-revision conflict handling, approval pointers, and deletion
retention rules. Completed jobs create a Score plus initial canonical MusicXML artifact in
one transaction; later saves append revisions instead of overwriting `current` or `final`
objects.

### P1-4 Artifact boundary and file delivery

**Status:** completed on 2026-06-22.
**Dependencies:** P1-3.

Tasks:

1. Add score and processing artifact repositories.
2. Route XML, rendered image, export, and access-URL flows through artifact IDs.
3. Update renderer output to attach to a revision and render profile.
4. Keep enhanced XML internal to processing artifacts.
5. Replace file-type/task-ID download contracts.
6. Add orphan cleanup and storage-object existence diagnostics.

Acceptance:

- canonical and derived artifacts identify their revision;
- backend rendering does not mutate older revision artifacts;
- downloads enforce score/revision access before storage URL creation.

**Result:** score and processing artifacts are separate boundaries. XML, render, download,
archive, access-URL, diagnostics, and fingering flows go through artifact IDs and
score/revision authorization. `enhanced_xml` remains only a processing artifact; it is not a
frontend source or fallback.

### P1-5 Metadata extraction and projection

**Status:** completed on 2026-06-22.
**Dependencies:** P1-3.

Tasks:

1. Implement a deterministic extractor under `processing/musicxml` behind a typed result.
2. Define repeat-aware duration semantics and extractor versioning.
3. Persist one projection per revision with pending/ready/failed status.
4. Trigger extraction after revision commit; failure must not corrupt the revision.
5. Add rebuild command and fixtures for key/meter/tempo changes and multi-part scores.
6. Expose metadata in score detail and results UI with explicit unavailable/processing states.

Acceptance:

- projections can be deleted and rebuilt from canonical XML;
- results never displays fabricated zero values after extraction failure;
- common metadata reads do not parse MusicXML in the request path.

**Result:** metadata extraction lives behind typed MusicXML processing results with extractor
versioning and per-revision projection rows. Revision commits schedule or record metadata
states, the rebuild command can regenerate projections from canonical MusicXML, and UI/API
read models expose unavailable or processing states instead of invented zeros.

### P2-1 Central score authorization

**Status:** completed on 2026-06-22.
**Dependencies:** P1-3.

Tasks:

1. Add a score-domain policy service and typed actions/access context.
2. Move owner, member, grant, publication, download, and practice decisions out of
   `app/utils/permissions.py` and ad hoc services.
3. Require every score/revision/artifact mutation and read to call the policy boundary.
4. Add capabilities to owner/member/share/public read models.
5. Add a permission matrix test suite with deny-by-default cases.

Acceptance:

- frontend capability combinations match backend-enforced actions;
- no route or repository independently reconstructs access rules;
- invalid, expired, revoked, or mismatched grants cannot access score artifacts.

**Result:** `modules/score_access` is the central capability and enforcement boundary for
owner, member, share grant, public publication, download, practice, and artifact access.
The old ad hoc permission helper was removed, and score-domain services resolve typed
capabilities before serving reads or mutations.

### P2-2 Share grants, memberships, and bookmarks

**Status:** completed on 2026-06-22.
**Dependencies:** P2-1.

Tasks:

1. Store only hashed share tokens.
2. Implement view-only grant flows.
3. Keep edit membership separate from share links.
4. Split bookmark creation from authorization and record grant redemption.
5. Migrate history 鈥渟aved shares鈥?to bookmark read models with unavailable states.
6. Preserve expiry, revocation, download, and practice restrictions.

Acceptance:

- anonymous share access works only through a valid token;
- share links never grant editing;
- revoking a grant removes grant-derived access without silently deleting bookmarks;
- editor membership survives token rotation according to explicit owner actions.

**Result:** share grants persist hashed tokens only, record redemptions, split bookmarks
from authorization, and keep revocation/expiry/download policy in the capability layer.
Share links are view-only; edit access belongs to authenticated membership.

### P2-3 Publication and public page

**Status:** completed on 2026-06-22.
**Dependencies:** P2-1, P1-5.

Tasks:

1. Implement owner-only publish, republish, and unpublish operations.
2. Pin a revision and expose publication capabilities and metadata.
3. Add exact anonymous `/public/[slug]` route and API exception.
4. Keep `/results`, `/editor`, `/history`, and `/review` protected.
5. Gate download/practice by publication policy.
6. Add SEO metadata only from real publication fields.

Acceptance:

- editing the head does not modify public content until republish;
- unpublish removes public access without affecting owner/member/share access;
- public routes cannot expose management controls or unpublished revisions.

**Result:** publications pin explicit revisions and expose a public read model/capability
set separate from owner/member/share access. Publishing, republishing, and unpublishing are
owner-only transitions, and `/public/[slug]` is the only public publication surface.

### P3-1 New API contract and frontend data layer

**Status:** completed on 2026-06-22.
**Dependencies:** P1-3 through P2-3 as applicable.

Tasks:

1. Add domain API types, facades, Query keys, and query/mutation hooks.
2. Keep transient XML editor state and playback state outside Query cache.
3. Implement cancellation for score, revision, artifact, grant, publication, and metadata reads.
4. Implement classified revision-conflict handling.
5. Update API smoke tests and frontend request-level tests.

Acceptance:

- frontend code no longer consumes score data through `TaskDetails`;
- Query invalidation follows domain ownership;
- no page contains direct backend fetches.

**Result:** frontend score, revision, artifact, grant, publication, metadata, jobs, history,
and practice contracts live in domain API/type modules behind stable facades and query keys.
Requests support cancellation where relevant, revision conflicts are classified, and pages
compose domain hooks instead of direct backend fetches.

### P3-2 Upload and review cutover

**Status:** completed on 2026-06-22.
**Dependencies:** P1-2, P3-1.

Tasks:

1. Make upload poll jobs and navigate using returned score IDs.
2. Make review load job inputs plus produced score head.
3. Make 鈥渓ooks good鈥?approve the head revision.
4. Make 鈥渘eeds edit鈥?open `/editor/{scoreId}` without source strings.
5. Preserve retry/recovery behavior for pending and failed jobs.

Acceptance:

- job IDs never enter score URLs after a score exists;
- approval performs no current-to-final copy;
- failed jobs remain diagnosable without fake Score rows.

**Result:** upload and review use jobs for processing lifecycle and score IDs for score
routes after creation. Review approval advances the approved/head revision pointer, while
failed jobs remain processing records with diagnostics rather than fake Score rows.

### P3-3 Results, editor, and history cutover

**Status:** completed on 2026-06-22.
**Dependencies:** P3-1, P0-2.

Tasks:

1. Make results compose score, head revision, metadata, artifacts, grants, publication, and
   capabilities.
2. Make title/taxonomy tag mutations target Score with concurrency control.
3. Make editor autosave append deduplicated revisions against a base revision.
4. Change draft storage identity to score ID plus base revision.
5. Replace current/final source routing and query keys.
6. Make history list scores and processing entries with separate identities.
7. Update downloads, archives, thumbnails, breadcrumbs, and batch actions.

Acceptance:

- task ID is absent from score-facing component props and route logic;
- stale editor saves surface a recoverable conflict;
- history pagination and selection do not mix job and score IDs.

**Result:** results, editor, and history compose Score/Revisions/Artifacts/Metadata/Grants/
Publication capabilities. Title and taxonomy tags mutate Score state, editor autosave appends
deduplicated revisions against a base revision, draft identity includes score/revision, and
history keeps processing entries and score assets as separate identities.

### P3-4 Share, public, and practice cutover

**Status:** completed on 2026-06-22.
**Dependencies:** P2-2, P2-3, P3-1.

Tasks:

1. Make share consume grant read models and backend capabilities.
2. Keep share links read-only before editor navigation.
3. Add public score page with publication policy controls.
4. Make practice create sessions for a pinned revision.
5. Remove raw token persistence from practice sessions and frontend session DTOs.
6. Verify WebSocket/runtime behavior remains revision-stable.

Acceptance:

- owner, member, anonymous share, redeemed share, expired/revoked share, and public paths are
  covered end to end;
- active practice sessions are unchanged by later edits or republication.

**Result:** share and public pages consume grant/publication read models with backend
capabilities, practice sessions pin score and revision identity, and the frontend no longer
stores raw grant tokens in practice DTOs. Practice access credentials travel as request
headers and session state records the resolved access origin.

### P4-1 Backfill, cutover, and legacy removal

**Status:** completed on 2026-06-23.
**Dependencies:** all earlier data and contract phases.

Tasks:

1. Run the deterministic backfill and validation report on a realistic database copy.
2. Cut backend and frontend to the new contract.
3. Remove old task-as-score routers/services/schemas and task-owned file APIs.
4. Remove `CURRENT_XML`, `FINAL_XML`, saved-share authorization, and source-route logic.
5. Remove zero-reference models, columns, Query keys, types, tests, and compatibility code.
6. Add the contract migration and operational notes to current engineering principles.
7. Optionally squash migrations only before the first production baseline.

Acceptance:

- runtime searches find no task-as-score or current/final compatibility path;
- every canonical score has a head revision and MusicXML artifact;
- every practice session references a valid revision;
- full backend/frontend quality gates pass.

**Result:** legacy task-to-score backfill has been removed from the active development baseline; disposable local data should be recreated and migrated to head.\nbackfill and validation report for legacy task, file, share, saved-share, and practice
rows. The cleanup migration enforces non-null practice score/revision/access-origin
references, verifies that legacy jobs/XML scores/shares/bookmarks have been mapped, and
drops legacy task/share/file tables and enums only after validation. Runtime routers,
services, models, frontend facades, query hooks, types, and tests for task-as-score, XML
source routing, saved-share authorization, and task-owned file delivery were removed.

Current development database migration on 2026-06-23 completed the safe sequence
`e7f8a9b0c123 -> f1a2b3c4d5e6 -> backfill dry-run -> backfill --apply -> head`.
Backfill applied 2 scores, 2 revisions, 2 grants, and 4 practice-session mappings with
zero validation blockers. Post-cleanup structural audit found no ORM-obsolete tables,
no ORM-missing tables, no legacy `tasks/files/shares/saved_shares/task_*` tables, no
legacy `practice_sessions.task_id/share_token/source_type` columns, and no legacy
`taskstate/taskstepstatus/filekind/practicesourcetype` enum types.

Operational note: if the API reports `relation "scores" does not exist`, the running
database is behind the new score-domain code. For a disposable local database, reset or
recreate the database and run `docker compose -f docker-compose.backend-dev.yml run --rm api
migrate`. For a database with legacy `tasks/files/shares/practice_sessions` data, do not
run `migrate` straight to head. Upgrade only to `f1a2b3c4d5e6`, run
recreate the disposable local database, then upgrade directly to head.

## 11. Test And Quality Gates

### 11.1 Backend inner loop

```powershell
cd backend
..\scripts\backend_quality.ps1 ruff
..\scripts\backend_quality.ps1 mypy
..\scripts\backend_quality.ps1 mypy-model-layer
..\scripts\backend_quality.ps1 pytest
```

Required focused coverage:

- Alembic upgrade/downgrade and backfill idempotency;
- revision ordering, deduplication, conflict, approval, and immutable artifacts;
- metadata extraction/rebuild/failure states;
- authorization matrix for owner/member/share/public/anonymous;
- share token hashing, expiry, revocation, redemption, and bookmark separation;
- publication pin/republish/unpublish;
- practice revision pinning and runtime registration;
- job retry, heartbeat, stale recovery, and orphan cleanup.

### 11.2 Frontend inner loop

```powershell
cd frontend
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

Required behavior coverage:

- upload job-to-score navigation;
- review approval without current/final copy semantics;
- editor revision conflict and draft recovery;
- results metadata/capabilities/publication/actions;
- long-score persistent playback dock and manual follow suspension;
- share/public/member permission paths and return URLs;
- history mixed processing/score entries without identity collisions;
- practice pinned-revision lifecycle and cleanup.

### 11.3 Phase boundary gate

No phase is complete until:

- the smallest focused tests pass;
- the relevant full suite passes at the phase boundary;
- docs and API examples describe the implemented state;
- temporary adapters and feature flags introduced by that phase are removed or explicitly
  assigned to a later phase with an owner;
- storage and runtime cleanup paths have been reviewed.

## 12. Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| task/score ID confusion | distinct types, routes, DTO names, and navigation tests |
| autosave revision explosion | content-hash deduplication, idempotency keys, measured retention later |
| stale concurrent edits | base revision check and classified 409 conflict |
| metadata becomes stale | revision-keyed projection and versioned rebuild command |
| artifact abstraction becomes EAV | closed artifact kinds and typed domain services |
| public content changes unexpectedly | publication pins an immutable revision |
| share link grants editing | ordinary share links are VIEW only; editing requires login and membership acceptance |
| bookmark accidentally grants access | bookmark and grant redemption remain separate |
| storage migration causes data loss | leave existing keys in place; verify hashes before optional copy |
| practice changes while session runs | session pins revision at creation |
| player fights manual scrolling | explicit follow suspension and return-to-cursor control |
| migration creates permanent compatibility debt | one cutover phase and zero-reference removal gate |

## 13. Recommended Execution Order

Execute in this order unless a documented dependency changes:

1. P0-1 architecture decisions and fixtures.
2. P0-2 results playback dock in an independent frontend change.
3. P1-1 schema/model layer.
4. P1-2 processing job extraction.
5. P1-3 score/revision service.
6. P1-4 artifact boundary.
7. P1-5 metadata projection.
8. P2-1 centralized authorization.
9. P2-2 share/membership/bookmark model.
10. P2-3 publication/public page.
11. P3-1 frontend data contract.
12. P3-2 upload/review cutover.
13. P3-3 results/editor/history cutover.
14. P3-4 share/public/practice cutover.
15. P4-1 backfill verification and legacy removal.

Do not combine the schema migration, player UX change, dependency upgrades, and broad
frontend route cutover in one change. Each should remain independently reviewable.

## 14. Completion Criteria

The migration is complete only when:

- processing jobs and scores have distinct identities and APIs;
- title, taxonomy tags, library, sharing, publication, and practice are score-owned;
- canonical MusicXML saves create immutable linear revisions;
- head, approved, and published revision semantics are explicit;
- artifacts identify their revision and metadata is rebuildable;
- enhanced XML remains internal and no current/final compatibility role is exposed;
- share/public links are view-only, and edit access requires authenticated membership acceptance;
- public access pins a revision and remains read-only;
- backend capabilities and endpoint authorization share one policy source;
- results shows complete pages with a continuously available playback dock;
- manual score navigation is respected during playback;
- old task-as-score tables, routes, frontend types, Query keys, and tests are removed;
- migration validation and all backend/frontend quality gates pass.



# NoteVerse Backend Engineering Principles

> Current baseline: score-domain architecture after the completed migration in
> `../../docs/archive/completed-migrations/score-domain-architecture-migration-plan.md`.

## 1. Purpose

This document is the backend maintenance baseline for NoteVerse. It describes the
current architecture, ownership rules, safety boundaries, migration discipline, and
quality gates that future backend work should follow.

It is not a migration plan and it is not a generic project template. It answers one
practical question: when adding or changing backend behavior, where should the code live,
which contracts must stay true, and what should be checked before the work is considered
safe.

## 2. Current Architecture

The backend now uses a hybrid architecture:

- business features live under `app/modules/*`;
- database sessions and ORM models live under `app/db/*`;
- durable storage lives under `app/storage/*`;
- processing orchestration lives under `app/pipeline/*`;
- OCR, MusicXML, rendering, realtime, and audio engines live under `app/processing/*`;
- Celery runtime wiring and durable outbox dispatch adapters live under `app/worker/*`;
- application runtime concerns live under `app/core/*`;
- route aggregation lives in `app/api/v1/router.py`;
- `app/main.py` stays thin.

Current feature modules:

```text
app/modules/
|-- account
|-- auth
|-- async_operations
|-- billing
|-- files
|-- import_jobs
|-- library
|-- mail
|-- metadata
|-- my_scores
|-- notifications
|-- ops
|-- playback
|-- practice
|-- publications
|-- realtime
|-- revisions
|-- review
|-- score_access
|-- score_assets
|-- score_invites
|-- score_sharing
|-- scores
`-- storage_usage
```

Retired task-as-score modules and contracts must not be recreated:

- `modules/tasks`
- `modules/xml`
- `modules/shares`
- task-owned score/file APIs
- `TaskDetails`
- `current_xml` / `final_xml`
- `source=current|final`
- saved-share-as-authorization behavior

## 3. Canonical Score Domain

The durable product model is score-based, not task-based.

```text
Upload
  |
  v
ImportJob ---- ImportJobStep
  |        \
  |         `---- ImportArtifact
  | review confirms
  v
Score ---- ScoreMembership
  |  \----- ScoreLibraryEntry
  |  \----- ScoreShareGrant ---- ShareGrantRedemption
  |  `----- ScorePublication
  |
  v
ScoreRevision ---- ScoreRevisionMetadata
  |  \---- ScoreRevisionSource
  |  \---- ScoreRenderAsset
  |  `---- ScorePlaybackAsset

PracticeSession ---- pinned ScoreRevision
```

Core rules:

- `ImportJob` owns upload processing, progress, retries, heartbeat, stale recovery,
  and worker execution.
- Review is a pipeline stage owned by `ImportJob` and job artifacts until the user
  confirms it.
- `Score` is the stable user-owned product resource.
- `ScoreRevision` is immutable and linear.
- `ScoreRevisionSource` stores revision-owned canonical source payloads such as MusicXML.
- `ScoreRenderAsset` stores rebuildable visual render outputs such as rendered pages.
- `ScorePlaybackAsset` stores rebuildable playback outputs such as audio.
- `ImportArtifact` stores job internals such as OMR output, enhanced XML, diagnostics,
  and other non-product pipeline artifacts.
- `ScoreRevisionMetadata` is a rebuildable typed projection from canonical MusicXML.
- `ScoreShareGrant`, `ScoreMembership`, `ScoreLibraryEntry`, `ShareGrantRedemption`, and
  `ScorePublication` have distinct authorization and product semantics.
- `PracticeSession` pins `score_id`, `revision_id`, and `access_origin` at creation time.

Job identity and score identity are deliberately separate:

- upload and review polling use job IDs;
- review correction uses job IDs and updates temporary review artifacts;
- score detail, editor, history, share, public, and practice score surfaces use score IDs and
  revision IDs;
- a failed job must remain diagnosable without creating a fake score;
- once review confirmation creates a score, score-facing navigation should use the returned
  score ID.

## 4. Module Ownership

### `modules/import_jobs`

Owns import lifecycle:

- job submission;
- polling and batch status;
- idempotency keys;
- job steps;
- heartbeat and stale recovery;
- worker execution services;
- import artifact registration;
- upload linkage and orphan-upload protection.

Do not put durable score editing, publication, or sharing rules here.

### `app.pipeline` and `app.processing`

`app.pipeline` owns the import workflow composition:

- step ordering;
- per-step progress updates;
- worker-local scratch paths;
- recording import artifacts through `modules/import_jobs`.

`app.processing` is an engine and algorithm library:

- OMR engines;
- render engines;
- MusicXML extraction and normalization helpers;
- text recognition and text integration processors;
- real-time practice matching and reports.

`app.processing` should remain product-agnostic. It must not import `ImportJob`,
`ImportArtifact`, Score memberships, sharing, notifications, or API schemas. Product
lifecycle belongs in `modules/import_jobs`, `modules/review`, `modules/scores`, and
`app.pipeline` orchestration.

### `modules/review`

Owns the pre-Score human review boundary:

- reading `PENDING_REVIEW` job artifacts;
- returning original images, preview images, and review MusicXML by `job_id`;
- updating the temporary review MusicXML artifact through `PATCH /review/{job_id}`;
- confirming review and creating the first active Score;
- attaching the created `score_id` back to the import job and import notification.

Do not expose review as a Score route. Do not create Score revisions when editing review
artifacts. Do not allow sharing, invites, publication, or practice to target unconfirmed
review output.

### `modules/scores` and `modules/revisions`

Own stable score resources and immutable revision creation:

- score list/detail/update/delete/archive;
- score title, taxonomy tags, state, and version;
- head and approved revision pointers;
- first score creation after review confirmation yields canonical MusicXML;
- revision append, same-base no-op detection, base-revision conflict checks, and
  idempotent save retries.

Do not overwrite MusicXML in place. Do not model review approval as a file copy.

### `modules/score_assets`

Owns score revision source and render asset delivery:

- canonical revision source access;
- revision source downloads;
- render asset listing, viewing, access URLs, downloads, and archives;
- renderer output attached to a revision and render profile;
- render storage-object diagnostics.

Revision source IDs and render asset IDs replace task ID plus file kind addressing.

### `modules/metadata`

Owns typed, rebuildable metadata projections:

- measure count;
- duration;
- part count;
- key, meter, and tempo events;
- extractor status, version, and failure state.

Request paths should read metadata from the projection, not parse MusicXML repeatedly.

### `modules/score_access`

Owns authorization and capabilities for all score-domain reads and writes.

Capabilities are UI hints only. Endpoints must still enforce authorization server-side.

Access decisions must account for:

- owner;
- membership;
- share grant;
- publication;
- requested score;
- requested revision;
- requested action.

Do not reconstruct permissions ad hoc inside routers, repositories, or page-specific
services.

### `modules/score_sharing`

Owns view-only share grants, bookmark creation, and grant redemption:

- store only hashed share tokens;
- return raw tokens once at creation;
- share grants authorize anonymous reads while valid;
- share grants never authorize editing.

Bookmarks organize the user's library and do not grant access by themselves.

### `modules/publications`

Owns public score publication:

- owner-only publish, republish, and unpublish;
- pinned published revision;
- public slug;
- public capabilities;
- download/practice policy.

Editing a score head must not change public content until explicit republish.

### `modules/practice`

Owns REST lifecycle for practice sessions.

Practice runtime, audio buffers, realtime message codecs, frame classification, and score
following belong under `app/processing/*`, not in the REST module.

Practice sessions must not store raw share tokens or current/final source strings.

## 5. Storage And Artifact Rules

Durable file and object storage must go through `app/storage/*`.

Rules:

- never pass API-local filesystem paths to Celery;
- pass durable upload IDs or storage keys;
- workers materialize inputs in their own `WORK_ROOT`;
- business modules do not construct durable paths directly;
- score-owned source, render, and playback assets use score/revision/asset identity;
- job-owned artifacts use job identity;
- `enhanced_xml` is a processing artifact only;
- missing canonical MusicXML should fail explicitly, never fall back to enhanced XML.

New score source, render, and playback assets should use score/revision-aware keys such as:

```text
scores/{score_uuid}/revisions/{revision_uuid}/...
```

New job artifacts should use job-aware keys such as:

```text
jobs/{job_uuid}/...
```

Existing storage objects do not need to be moved merely for cosmetic path consistency.

## 6. Processing, Engines, And Workers

Pipeline code coordinates workflow. Processing code implements technical capabilities.
Worker code wires Celery runtime.

Keep these boundaries:

- pipeline uses stable context objects such as job IDs and durable upload references;
- OMR uses engine abstractions, not hard-coded tool details in business modules;
- rendering uses `ScoreRenderEngine` abstractions;
- MusicXML normalization and metadata extraction live under processing;
- realtime practice runtime stays out of Celery;
- long-running offline work belongs in workers;
- websocket/session state belongs in realtime runtime.

Engine selection is a boundary. Do not add hidden fallback behavior that masks failure of
the selected engine.

External dependencies:

- LEGATO is a pinned external source dependency;
- optional local checkouts may live under `external/legato` for inspection;
- worker images clone the pinned LEGATO commit into `/opt/noteverse/legato`
  during image build;
- API and beat images do not contain LEGATO;
- LEGATO is not backend application code;
- local patches must be documented and should become a fork or patch file when needed.

## 7. Reliability Rules

The processing system must be safe under retries, worker restarts, and duplicate user
actions.

Preserve:

- durable upload registration before job dispatch;
- job idempotency keys;
- Celery late acknowledgement;
- worker-lost rejection;
- prefetch 1 behavior;
- heartbeat updates;
- stale job maintenance;
- dispatch-failure marking;
- upload links that prevent queued/running inputs from being cleaned as orphans;
- storage materialization in worker-local runtime paths.

Do not reintroduce API-local paths in Celery payloads.

## 8. Database And Migration Discipline

Alembic migrations are the schema contract.

The score-domain migration is complete in the current development database. The old
task-as-score tables and columns have been removed:

- `tasks`
- `task_steps`
- `task_uploads`
- `files`
- `shares`
- `saved_shares`
- `practice_sessions.task_id`
- `practice_sessions.share_token`
- `practice_sessions.source_type`

If another database still contains legacy task/share/file data, do not run straight to
Alembic head unless the database is disposable.

Development cutover sequence:

```powershell
docker compose -f docker-compose.backend-dev.yml run --rm api alembic upgrade head
```

This project is still in development. Prefer clearing disposable local data over keeping legacy backfill scripts alive. Cleanup migrations should fail closed when score, revision, source, render asset, share, library, or practice mappings are incomplete.

## 9. Coding Standards

Routers should only:

- bind request parameters;
- bind dependencies;
- call services;
- return response schemas.

Services should:

- enforce business state transitions;
- call policy boundaries;
- coordinate repositories and processing capabilities;
- raise canonical exceptions;
- return stable DTOs or schema models.

Repositories should:

- encapsulate database reads and writes;
- use business-intent method names;
- avoid response JSON construction;
- avoid HTTP-layer exceptions;
- not coordinate cross-module workflows.

Schemas should:

- live in module `schemas.py`;
- define request/response contracts and stable internal result shapes;
- avoid loose `dict[str, object]` for known contracts;
- keep enum values consistent end to end.

Shared code should remain low-coupling. Do not put feature-specific ORM-heavy objects in
`app/shared/*` just because multiple modules currently import them.

Celery submission is a worker adapter, not a shared domain primitive. The modules in
`app/worker/dispatch/*` bridge already-claimed import, render, playback, and mail records
to Celery, and release their claims when broker submission fails. Domain services retain
their state transitions and do not import Celery directly.

## 10. API And Response Rules

Use the project response and exception conventions:

- `ValidationException`
- `UnauthorizedException`
- `ResourceNotFoundException`
- `AppException`
- `success_response(...)`
- `ErrorCode`
- `SuccessCode`

Avoid local one-off JSON error shapes.

Score-facing responses should include backend-computed capabilities where the UI needs
conditional actions, but the backend endpoint remains the enforcement point.

## 11. Runtime Development

Local backend development uses Docker as the supported runtime:

- API, worker, and beat run in Docker;
- Redis and PostgreSQL may run on the Windows host;
- source is bind-mounted into `/app`;
- model roots are mounted read-only;
- backend data directories are mounted for local storage and worker scratch
  persistence;
- logs go to stdout/stderr and are collected by the runtime platform.

Recommended runtime checks:

```powershell
docker compose -f docker-compose.backend-dev.yml build api
docker compose -f docker-compose.backend-dev.yml build worker
docker compose -f docker-compose.backend-dev.yml run --rm api check
docker compose -f docker-compose.backend-dev.yml run --rm api alembic current
docker compose -f docker-compose.backend-dev.yml run --rm api migrate
```

Use `migrate` only when the target database is already in the correct migration state or
is disposable. Use the safe cutover sequence for databases with legacy data.

## 12. Quality Gates

Choose validation based on blast radius. For broad backend changes, run:

```powershell
..\scripts\backend_quality_docker.ps1 -Check all
```

For score-domain changes, add focused coverage for the relevant behavior:

- revision ordering, conflict, approval, immutable sources, and restore semantics;
- metadata extraction, rebuild, and failure states;
- authorization matrix for owner, member, share, public, and anonymous paths;
- share token hashing, expiry, revocation, redemption, and bookmark separation;
- publication pin, republish, and unpublish;
- practice revision pinning and runtime registration;
- job retry, heartbeat, stale recovery, and orphan cleanup;
- Alembic upgrade and backfill idempotency when migrations are involved.

For score-domain cleanup or regression review, run a residue search:

```powershell
rg -n "app\.modules\.(tasks|shares|xml)|app\.db\.models\.(task|share)|TaskDetails|current_xml|final_xml|source=(current|final)|tasksApi|xmlApi|sharesApi" backend\app backend\tests apps\customer-web\src apps\customer-web\tests
```

No runtime code should match that search after the completed cutover.

## 13. Documentation Rules

Current docs should describe the implemented state, not a pile of historical phases.

Rules:

- keep active architecture rules in current docs;
- archive historical plans when they stop being active task boards;
- update docs when architecture, runtime, external dependencies, storage, engine behavior,
  or reliability rules change;
- remove or clearly label superseded assumptions;
- prefer concise current rules over long migration history.

`docs/score-domain-architecture-migration-plan.md` remains the detailed historical record
and completion evidence for the score-domain migration. This document is the compact
maintenance baseline.

## 14. Review Checklist

Before finalizing backend work, check:

- no new legacy imports or wrapper paths;
- no task-as-score, current/final XML, saved-share authorization, or task-owned file
  contracts;
- no job ID used as a score route identity after a score exists;
- no canonical MusicXML mutation that overwrites an existing revision source;
- no endpoint reconstructs score permissions outside `modules/score_access`;
- no raw share token persistence beyond one-time token return;
- no public access follows mutable head revision without explicit republish;
- no practice session can drift with later score edits, share revocation, or republication;
- no direct durable file path construction outside `app/storage`;
- no Celery payload contains an API-local path;
- routers stay thin;
- services do not absorb repository, worker, engine, or response-format responsibilities;
- repositories do not build HTTP responses or coordinate business workflows;
- schemas and ORM field names do not drift;
- stable contracts do not use loose dictionaries;
- selected engine failures are not hidden by fallback behavior;
- tests or documented validation cover the changed behavior.

## 15. Healthy-Code Signals

Backend code is usually healthy when:

- a new behavior has one clear owning module;
- route, service, repository, storage, processing, and worker responsibilities are distinct;
- imports point to canonical locations;
- schema and model names align;
- authorization goes through the score access policy;
- durable files go through storage adapters;
- workers can retry and materialize inputs across processes or machines;
- complex runtime failures have diagnostics;
- docs point future maintainers to the current architecture instead of old compatibility
  paths.

When a change needs explanations like "temporarily use this old path", "both names are
fine", "this source fallback is harmless", or "we will test this later", it is probably
creating the next round of architecture debt.




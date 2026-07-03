# Review Pipeline Migration Plan

Status: Completed
Date: 2026-07-02
Owner: Codex / NoteVerse Pro

## Goal

Migrate review from a Score workspace to a pre-Score pipeline step.

Target product model:

```text
Upload
  -> ProcessingJob
  -> Review by job_id
  -> Confirm
  -> Create Score
  -> Score view / edit / practice / share / collaboration
```

Target routes:

```text
/upload
/review/:jobId
/score/:scoreId
/score/:scoreId/edit
/score/:scoreId/practice
```

Non-goals:

- Do not keep `/score/:id/review` as a compatibility route.
- Do not keep `Score.state = IN_REVIEW`.
- Do not create collaboration, invite, share, publication, or practice state for unconfirmed OCR output.
- Do not add fallback logic for both old and new review identities. The project is pre-release, so use a clean cutover.

## Original Findings Before Migration

### Backend

- `ProcessingJob` currently owns progress and processing artifacts, but it also has `score_id`.
- `JobContext.complete()` calls `sync_score_creation_service.create_from_job(...)` before finalizing the job.
- `SyncScoreCreationService.create_from_job(...)` creates:
  - `Score(state=IN_REVIEW)`
  - initial `ScoreRevision(origin=OMR)`
  - canonical `ScoreArtifact(kind=MUSICXML)`
  - `ScoreRevisionMetadata(PENDING)`
  - `ProcessingJob.score_id`
- `SyncJobService.finalize_success(...)` sets `ProcessingJob.state = PENDING_REVIEW` and sends a `processing.completed` notification with `score_id`.
- `ScoreService.approve(...)` changes the early-created Score from `IN_REVIEW` to `ACTIVE`, sets `approved_revision_id`, marks the job `SUCCESS`, creates a library entry, and renders pages.
- `ScoreAccessPolicy` grants owners `can_approve`, so review approval is currently a Score capability.
- ADR 0002 originally mixed parts of review lifecycle into the Score domain. ADR 0005 now records the accepted review pipeline boundary.

### Frontend

- Review route is currently `frontend/src/app/[locale]/score/[id]/review/page.tsx`.
- `useReviewPageData(scoreId)` loads:
  - Score detail by `scoreId`
  - head revision content by `scoreId + revisionId`
  - originating job by `score.originating_job_id`
  - job artifacts for original/preview images
  - score approval mutation `POST /scores/:id/approve`
- Upload completion requires `job.score_id`; `PENDING_REVIEW` routes to `/score/:scoreId/review`.
- Notification click behavior routes `processing.completed` to `/score/:scoreId/review`.
- My Scores shows `Score.state === IN_REVIEW` as a review target.
- ScoreShell currently includes a `review` workspace type.

## Target Backend Contract

### ProcessingJob

Keep `ProcessingJob` as the source of truth for OCR/import pipeline state.

States:

```text
PENDING -> PROGRESS -> PENDING_REVIEW -> SUCCESS
                  \-> FAILURE
```

Meaning:

- `PENDING_REVIEW`: OCR/import output exists and is ready for human review.
- `SUCCESS`: user confirmed review and a canonical Score was created.
- `FAILURE`: processing failed; no Score exists.

Required job fields:

- `job_uuid`
- `user_id`
- `state`
- `progress`
- `requested_options`
- `score_id` nullable, populated only after confirm
- timestamps and error fields

Processing artifacts required for review:

- `original_image`
- `preview_image`
- `musicxml` or equivalent canonical review XML artifact

### Score

Score becomes a stable resource only after review confirmation. The current Score model does
not carry a lifecycle state column; existence of a Score means it is a confirmed canonical
resource.

Removed:

- `scores.state` / `ScoreState`
- `scores.approved_revision_id`
- review-specific approval capability from Score access policy
- review approval endpoint under `/scores/{score_id}/approve`

Keep:

- revisions
- artifacts
- metadata projection
- sharing/invites/publication/practice
- collaboration on active Scores

### New Review API

Add job-scoped review endpoints:

```text
GET  /api/v1/review/{job_id}
PATCH /api/v1/review/{job_id}
POST /api/v1/review/{job_id}/confirm
```

`GET /review/{job_id}` returns:

```json
{
  "job_id": "uuid",
  "state": "PENDING_REVIEW",
  "title": "requested or inferred title",
  "taxonomy_tags": [],
  "musicxml": {
    "artifact_id": "uuid",
    "content": "<score-partwise>...</score-partwise>"
  },
  "original_images": [],
  "validation": {
    "warnings": []
  }
}
```

`PATCH /review/{job_id}`:

- Requires job owner.
- Requires job state `PENDING_REVIEW`.
- Validates the submitted MusicXML.
- Replaces the job-scoped `review_musicxml` processing artifact.
- Does not create a Score revision.
- Does not create a Score.

Request shape:

```json
{
  "content": "<score-partwise>...</score-partwise>"
}
```

`POST /review/{job_id}/confirm`:

- Requires job owner.
- Requires job state `PENDING_REVIEW`.
- Reads the review MusicXML artifact.
- Creates the Score, initial revision, canonical MusicXML artifact, metadata projection, and library entry in one transaction boundary where possible.
- Enqueues rendered-page/thumbnail generation asynchronously as a best-effort side effect.
- Sets `ProcessingJob.score_id`.
- Sets `ProcessingJob.state = SUCCESS`.
- Returns the created `score_id`.

Request shape:

```json
{
  "content": "<score-partwise>...</score-partwise>",
  "title": "optional edited title",
  "taxonomy_tags": []
}
```

Reason: review may allow the user to edit XML through the editor before confirmation; the confirmed content should be the source of the initial Score revision.

### Backend Refactor Tasks

1. Create review service/module
   - Add `backend/app/modules/review/`.
   - Add `ReviewService.detail(job_id, user_id)`.
   - Add `ReviewService.confirm(job_id, user_id, request)`.
   - Add `ReviewRepository` only if queries become non-trivial; otherwise keep inside service initially.

2. Stop creating Score during pipeline completion
   - Remove `sync_score_creation_service.create_from_job(...)` from `JobContext.complete()`.
   - Store produced MusicXML as a `ProcessingArtifact(kind="musicxml")`.
   - Keep `finalize_success()` setting job state to `PENDING_REVIEW`.
   - Send `processing.completed` notification with `job_id`, not `score_id`.

3. Move Score creation to review confirm
   - Rename `SyncScoreCreationService.create_from_job(...)` to a cleaner command such as `create_confirmed_score_from_job(...)`.
   - Make it callable from async review service through a sync session helper or port it to async.
   - Set `head_revision_id` to the initial revision.
   - Set `ProcessingJob.score_id` after Score creation.
   - Ensure idempotency: if the job already has a `score_id` and state `SUCCESS`, return the existing Score.

4. Remove Score review approval
   - Delete `POST /scores/{score_id}/approve`.
   - Delete `ScoreService.approve(...)`.
   - Remove `ScoreAction.APPROVE` and `can_approve` usage where it is only for review.
   - If `can_approve` exists only for review, remove it from `ScoreCapabilities` and DTOs.

5. Clean state model
   - Remove `scores.state` / `ScoreState`.
   - Remove `scores.approved_revision_id`.
   - Update repository filters that treat score state as product lifecycle.
   - Update contracts in `backend/docs/contracts/score-domain-v1.json`.
   - Add an Alembic migration:
     - For current development data, drop the unused fields directly after the review pipeline cutover.
     - Since no compatibility is required, prefer a clean dev migration with explicit destructive notes.

6. Update notifications
   - `processing.completed` data should contain `job_id`, `job_title`, and no `score_id`.
   - On click, frontend routes to `/review/:jobId`.
   - After confirm, optional future event can notify "Score created", but do not overload processing completion.

7. Update tests
   - Pipeline completion leaves no Score and job is `PENDING_REVIEW`.
   - Job review detail returns XML and image artifacts.
   - Confirm creates Score and initial revision.
   - Confirm is idempotent.
   - Score listing excludes unconfirmed jobs.
   - Processing completed notification is job-scoped.

## Target Frontend Contract

### Routes

Add:

```text
frontend/src/app/[locale]/review/[jobId]/page.tsx
```

Remove:

```text
frontend/src/app/[locale]/score/[id]/review/page.tsx
```

Review should no longer be rendered inside `ScoreShell`.

### Review Data Hook

Replace `useReviewPageData(scoreId)` with `useReviewPageData(jobId)`.

New data source:

- `useJobReview(jobId)`
- `useConfirmJobReview(jobId)`
- `jobsApi.review(jobId)`
- `jobsApi.confirmReview(jobId, payload)`

Remove from review hook:

- `useScoreDetail`
- `useRevisionContent`
- `useApproveScore`
- `scoreCapabilities`
- `can_approve`
- `score.originating_job_id`

### Upload Flow

Current:

```text
PENDING_REVIEW requires job.score_id -> /score/:scoreId/review
```

Target:

```text
PENDING_REVIEW -> /review/:jobId
SUCCESS with score_id -> /score/:scoreId
FAILURE -> stay /upload?job_id=:jobId
```

Update:

- `getCompletedScoreRoute(...)` should become `getCompletedJobRoute(job)`.
- `useUploadWorkflow` should no longer treat missing `score_id` as failure for `PENDING_REVIEW`.

### Notifications

Update `notificationHref(...)`:

```text
processing.failed    -> /upload?job_id=:jobId
processing.completed -> /review/:jobId
score events         -> /score/:scoreId
```

### My Scores

My Scores should list confirmed Scores as Score cards.

Pending review jobs should move to one of:

- Upload recovery area, or
- a small "Pending reviews" section backed by `/jobs?state=PENDING_REVIEW`.

Implemented MVP:

- Add a dedicated `review` tab backed by `PENDING_REVIEW` jobs.
- Include `PENDING_REVIEW` jobs in the `all` tab as job cards, not Score cards.
- Route `PENDING_REVIEW` jobs to `/review/:jobId`.
- Keep failed processing jobs clickable through `/upload?job_id=:jobId`.
- Allow `PENDING_REVIEW` jobs to be selected and deleted like failed jobs.

### Editor Return Flow

Current:

```text
/score/:scoreId/review -> /score/:scoreId/edit?returnUrl=/score/:scoreId/review
```

Target:

No Score exists before confirm, so normal Score editor must not edit review output.

Implemented MVP:

```text
/review/:jobId -> /review/:jobId/edit?returnUrl=/review/:jobId
```

- `/review/:jobId/edit` reuses the shared editor workspace UI.
- It loads the job-scoped review MusicXML artifact.
- Saving calls `PATCH /review/:jobId`.
- It updates the temporary review artifact, not a Score revision.
- Saving returns to `/review/:jobId`.

Reason: this keeps Review in the pipeline layer while still allowing correction before creating the canonical Score.

### Frontend Cleanup Tasks

1. Add job review API client and query keys.
2. Move review route to `/review/:jobId`.
3. Rewrite review hook to consume job review endpoint.
4. Remove ScoreShell review workspace.
5. Remove `workspace="review"` from ScoreShell type.
6. Remove `useApproveScore` and related score approval frontend code.
7. Update upload completion routing.
8. Update notification routing and tests.
9. Update My Scores pending-review logic.
10. Add job-scoped review editor at `/review/:jobId/edit`.
11. Update translations that mention score review route semantics.

## Documentation Cleanup

Update active docs:

- `docs/adr/0002-job-score-and-linear-revisions.md`
- `docs/score-shell-workspace-migration-plan.md`
- `docs/results-to-score-route-migration-plan.md`
- `docs/pending-invites-notifications-plan.md`
- `frontend/docs/frontend_engineering_principles.md`
- `backend/docs/backend_engineering_principles.md`
- `backend/docs/contracts/score-domain-v1.json`

Historical docs may keep old references only if clearly marked as historical. Active plans should not present `/score/:id/review` as the target.

## Residue Search Checklist

Before declaring migration complete, searches must return no active product references except historical notes:

```text
/score/${...}/review
/score/:id/review
score/[id]/review
ScoreState.IN_REVIEW
can_approve
ScoreAction.APPROVE
POST /scores/{score_id}/approve
useApproveScore
approveScore
originating_job_id used by review
processing.completed -> score review
```

Expected remaining references:

- migration files that record history
- historical ADRs explicitly marked superseded

## Execution Plan

### Phase 1: Backend pipeline boundary

- [x] Add review API schemas and service.
- [x] Store review MusicXML as a processing artifact.
- [x] Stop early Score creation in `JobContext.complete()`.
- [x] Change processing-completed notifications to job-scoped.
- [x] Add backend tests for job review detail and pipeline boundary.
- [x] Add backend tests for review confirm in Phase 2.

Acceptance:

- [x] OCR completion records review MusicXML and finalizes the job without creating a Score.
- [x] Review detail can load review XML and image assets by `job_id`.

### Phase 2: Confirm creates Score

- [x] Move Score creation to review confirm.
- [x] Remove score approval endpoint/service logic.
- [x] Remove Score state from the current model.
- [x] Remove `approved_revision_id` from the current model.
- [x] Update library entry creation to happen during confirm.
- [x] Update metadata/render side effects.
- [x] Add idempotency tests.

Acceptance:

- [x] Confirm returns a real `score_id`.
- [x] Created Score is immediately active and usable in view/edit/practice/share.
- [x] Re-confirm returns the same Score instead of duplicating.

### Phase 3: Frontend review route

- [x] Create `/review/:jobId`.
- [x] Rewrite review hook and components around job review data.
- [x] Update upload routing to `/review/:jobId`.
- [x] Update notification routing to `/review/:jobId`.
- [x] Remove `/score/:id/review`.

Acceptance:

- [x] Upload completion opens review by job id.
- [x] Confirm review redirects to `/score/:scoreId`.
- [x] Refreshing `/review/:jobId` works before confirm.
- [x] Opening `/review/:jobId` after confirm redirects to `/score/:scoreId`.

### Phase 4: Score shell cleanup

- [x] Remove review workspace from ScoreShell.
- [x] Remove Score review capability and UI checks.
- [x] Ensure Score Shell only hosts stable Score workspaces:
  - view
  - edit
  - practice
  - performance
  - share/public where applicable

Acceptance:

- [x] ScoreShell has no review-specific branches.
- [x] Score access/capability context has no review approval field.

### Phase 5: My Scores and job visibility

- [x] Ensure My Scores lists only active confirmed Scores.
- [x] Keep failed jobs accessible from upload recovery.
- [x] Add a Pending Reviews tab backed by `PENDING_REVIEW` jobs.
- [x] Allow pending-review jobs to open `/review/:jobId`.
- [x] Allow pending-review jobs to be deleted like failed jobs.

Acceptance:

- [x] Unconfirmed OCR output does not appear as a Score.
- [x] Failed jobs keep `/upload?job_id=:jobId` behavior.
- [x] Pending-review jobs keep `/review/:jobId` behavior.

### Phase 5.5: Job-scoped review editor

- [x] Add `/review/:jobId/edit`.
- [x] Add `PATCH /review/:jobId`.
- [x] Reuse the shared editor workspace UI.
- [x] Save review edits back to the temporary review artifact.
- [x] Keep review edits out of Score revisions until confirm.

Acceptance:

- [x] Review "Needs edit" opens `/review/:jobId/edit`.
- [x] Saving returns to `/review/:jobId`.
- [x] Confirm creates the initial active Score from the edited review XML.

### Phase 6: Documentation and tests

- [x] Add ADR 0005 for pipeline review and mark ADR 0002's review lifecycle as superseded.
- [ ] Update active frontend/backend engineering docs.
- [x] Run residue searches.
- [x] Run focused backend and frontend tests.

Verification commands:

```powershell
docker compose -f docker-compose.backend-dev.yml run --rm api ruff check app tests
docker compose -f docker-compose.backend-dev.yml run --rm api pytest tests/test_score_revision_services.py tests/test_api_smoke.py -q
npm run typecheck
npm run test:unit
npm run test:e2e -- tests/e2e/notification-center.spec.ts
```

## Open Product Decisions

1. Should Review have a job-scoped XML editor in MVP?
   - Decision: yes. `/review/:jobId/edit` edits the temporary review artifact, not a Score revision.

2. Should pending reviews appear in My Scores?
   - Decision: yes, but as job cards in a dedicated `review` tab, not as Score cards.

3. Should review confirmation allow edited title/taxonomy?
   - Recommendation: yes. These are submission metadata today and should become Score metadata at confirm.

4. Should collaborators ever access pre-Score review?
   - Recommendation: not in this migration. Add explicit review collaboration later if product needs it.

## Final Target Invariant

After migration:

```text
No Score exists until the user confirms review.
No Score route handles OCR review.
No collaboration/share/practice/publication feature can target unconfirmed OCR output.
```

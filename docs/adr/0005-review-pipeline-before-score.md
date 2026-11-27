# ADR 0005: Keep OCR Review In The Processing Pipeline Before Score Creation

- Status: Accepted
- Date: 2026-07-02
- Scope: Review pipeline, score lifecycle, editor entry points

## Context

OCR output requires human confirmation before it becomes a stable score. Job-scoped review and score editing therefore have separate resource and persistence boundaries.

## Decision

1. Review is a processing pipeline stage, not a Score workspace.
2. No `Score` exists until the user confirms review.
3. OCR/import output ready for review is stored as `ImportArtifact(kind=review_musicxml)`
   and related job artifacts.
4. `ImportJob.READY_FOR_REVIEW` means the job has review artifacts and is waiting for human
   confirmation.
5. `ImportJob.CONFIRMED` records completed review confirmation. Score owns its unique
   `created_from_import_job_id` relationship to that history. Import Activity projects a
   live Score link; Score deletion preserves the confirmed history and removes that link.
6. `/imports/:jobId/review` is the review route.
7. `/imports/:jobId/review/edit` is a job-scoped editor for the temporary review MusicXML artifact.
8. Saving in `/imports/:jobId/review/edit` updates the review artifact through `PATCH /import-jobs/{job_id}/review`.
   It does not create a Score revision.
9. Confirming review creates the first Score, its first revision, the canonical MusicXML
   revision source, pending metadata projection and revision-owned durable render/playback work.
   Accepted Score Revision Render execution generates the first render assets asynchronously;
   Review MusicXML and original uploads remain job-scoped before confirmation.
10. Score routes and capabilities start after confirm:
    `/score/:scoreId`, `/score/:scoreId/edit`, `/score/:scoreId/practice`, Guest Preview, invites,
    and collaboration all require a confirmed Score.

## Route Contract

```text
Upload
  -> ImportJob
  -> /imports/:jobId/review
  -> optional /imports/:jobId/review/edit
  -> confirm
  -> /score/:scoreId
  -> /score/:scoreId/edit
  -> /score/:scoreId/practice
```

## API Contract

```text
GET   /api/v1/import-jobs/{job_id}/review
PATCH /api/v1/import-jobs/{job_id}/review
POST  /api/v1/import-jobs/{job_id}/review/confirm
```

`PATCH /import-jobs/{job_id}/review` validates and replaces the temporary review MusicXML artifact.
`POST /import-jobs/{job_id}/review/confirm` creates or returns the canonical Score for that job.

## Consequences

- Guest Preview, invites, practice, and collaboration cannot target unconfirmed OCR output.
- Review correction can still happen before Score creation through a job-scoped editor.
- Upload Import Activity displays pending reviews as job cards, separate from Library Scores.
- Score has no review lifecycle state column.
- Import-completed notifications route to `/imports/:jobId/review` until confirm. After confirm,
  `admit_import_confirmation_consequences(...)` synchronously enriches the retained
  import notification with Score identity/title and appends the current realtime consequences
  inside the confirmation transaction.

Import Review and execution orchestration belong to `app.modules.import_jobs`.
Shared OMR/MusicXML/text processing engines remain independent capabilities.
Confirmation creates the Score and delegates initial revision admission to
RevisionWriter. Score/revision, durable derivative work, source/input accounting,
Job CONFIRMED state/confirmed_at, temporary artifact/link release, retirement admission,
notification enrichment and realtime consequences commit as one transaction. Physical deletion is background work.
The user-facing Review workspace URLs are independent of the API resource namespace.

# ADR 0005: Keep OCR Review In The Processing Pipeline Before Score Creation

- Status: Accepted
- Date: 2026-07-02
- Scope: Review pipeline, score lifecycle, editor entry points

## Context

The product handles AI/OCR music recognition, human review, editing, practice, sharing, and
collaboration. Earlier designs treated review as a Score workspace, which meant the upload
pipeline created a `Score` before the user confirmed the recognition result. That made review
look like a normal Score lifecycle state and risked leaking unstable OCR output into sharing,
collaboration, practice, and publication flows.

The product is still pre-release, so the migration can be a clean cut. We do not need long-lived
compatibility routes or fallback support for the older review-as-score model.

## Decision

1. Review is a processing pipeline stage, not a Score workspace.
2. No `Score` exists until the user confirms review.
3. OCR/import output ready for review is stored as `ImportArtifact(kind=review_musicxml)`
   and related job artifacts.
4. `ImportJob.PENDING_REVIEW` means the job has review artifacts and is waiting for human
   confirmation.
5. `ImportJob.CONFIRMED` means review confirmation created the canonical Score and recorded
   `ImportJob.score_id`.
6. `/review/:jobId` is the review route.
7. `/review/:jobId/edit` is a job-scoped editor for the temporary review MusicXML artifact.
8. Saving in `/review/:jobId/edit` updates the review artifact through `PATCH /review/:jobId`.
   It does not create a Score revision.
9. Confirming review creates the first Score, its first revision, the canonical MusicXML
   Score artifact, metadata projection, and a library entry. Rendered pages/thumbnails are
   generated asynchronously as rebuildable artifacts.
10. Score routes and capabilities start after confirm:
    `/score/:scoreId`, `/score/:scoreId/edit`, `/score/:scoreId/practice`, sharing, invites,
    publication, and collaboration all require a confirmed Score.

## Route Contract

```text
Upload
  -> ImportJob
  -> /review/:jobId
  -> optional /review/:jobId/edit
  -> confirm
  -> /score/:scoreId
  -> /score/:scoreId/edit
  -> /score/:scoreId/practice
```

The old `/score/:scoreId/review` route is not retained.

## API Contract

```text
GET   /api/v1/review/{job_id}
PATCH /api/v1/review/{job_id}
POST  /api/v1/review/{job_id}/confirm
```

`PATCH /review/{job_id}` validates and replaces the temporary review MusicXML artifact.
`POST /review/{job_id}/confirm` creates or returns the canonical Score for that job.

## Consequences

- Sharing, invites, practice, publication, and collaboration cannot target unconfirmed OCR output.
- Review correction can still happen before Score creation through a job-scoped editor.
- My Scores may show pending reviews, but they must render as job cards, not Score cards.
- Score no longer needs a lifecycle state column for the current product model.
- Score access capabilities no longer need review approval fields such as `can_approve`.
- Import-completed notifications route to `/review/:jobId` until confirm. After confirm,
  existing import notifications may include the created `score_id` for direct score navigation.

## Rejected Alternatives

- Create `Score(state=IN_REVIEW)` during OCR completion: rejected because it pollutes the stable
  Score resource with unstable pipeline output.
- Keep `/score/:scoreId/review` as a compatibility route: rejected because the project is
  pre-release and clean routing is more valuable than compatibility.
- Remove "Needs edit" from review entirely: rejected because users need to correct recognition
  before creating the canonical Score; the correct implementation is a job-scoped review editor,
  not the normal Score editor.

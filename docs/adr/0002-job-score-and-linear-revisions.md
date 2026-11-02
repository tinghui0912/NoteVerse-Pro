# ADR 0002: Separate Import Jobs From Scores And Use Linear Revisions

- Status: Accepted
- Date: 2026-06-22
- Scope: score-domain contract

## Context

Import processing and stable user-owned scores have different identities and lifecycles. Immutable linear revisions provide explicit save conflict semantics.

## Decision

1. `ImportJob` owns submission, progress, steps, retries, heartbeat, stale recovery,
   idempotency, and processing errors.
2. `Score` is the stable user-owned resource and owns title, taxonomy tags, and its current
   head revision pointer.
3. A job may fail without producing a score. Once normalized review MusicXML exists, the
   job enters `PENDING_REVIEW` and stores that output as a job artifact. It does not create
   a score yet.
4. `ScoreRevision` is an immutable snapshot with a unique number per score, a content hash,
   and an optional parent for provenance.
5. Revisions are linear. Branching and merging are not part of this model.
6. `Score.head_revision_id` identifies the current editable document.
7. Saving requires `base_revision_id`. A stale base returns `revision_conflict` instead of
   silently overwriting the head.
8. Saving unchanged content against the same base revision is a no-op success. Repeated
   idempotency keys return the original save result. Returning to older content later still
   creates a new revision.
9. Review confirmation creates the first stable score and revision. Score resources have no review-approval lifecycle.

## Lifecycle contract

```text
ImportJob: PENDING -> RUNNING -> PENDING_REVIEW -> CONFIRMED
                         \-> FAILURE

Score: no lifecycle state column in the current model
```

`ImportJob.PENDING_REVIEW` means review artifacts exist and are ready for human
confirmation. `ImportJob.CONFIRMED` means confirmation created a canonical score and
recorded `score_id`.

## API identity contract

- upload submission and polling use `job_id`;
- review routes use `job_id`; confirming review returns the created `score_id`;
- results, editor, history, Guest Preview management and practice use `score_id`;
- Practice admissions pin `revision_id`;
- score-facing DTOs do not expose processing progress as score state.

## Consequences

- Upload and review can continue to expose processing diagnostics without polluting score
  APIs.
- Editor saves are append-only except for same-base unchanged-content no-ops and require
  conflict handling.
- Batch archive/delete must operate on score IDs, while job cancellation/deletion remains a
  separate operation.

# ADR 0002: Separate Import Jobs From Scores And Use Linear Revisions

- Status: Accepted
- Date: 2026-06-22
- Scope: score-domain contract

## Context

Import processing and stable user-owned scores have different identities and lifecycles. Immutable linear revisions provide explicit save conflict semantics.

## Decision

1. `ImportJob` owns submission, progress, steps, retries, heartbeat, stale recovery,
   idempotency, and processing errors.
2. `Score` is the stable user-owned resource and owns `display_title`, `genres`,
   `metadata_version`, and its current `head_revision_id` pointer.
3. A job may fail without producing a score. Once normalized review MusicXML exists, the
   job enters `READY_FOR_REVIEW` and stores that output as a job artifact. It does not create
   a score yet.
4. `ScoreRevision` is an immutable snapshot with a unique number per score, a content hash,
   and a complete canonical MusicXML source. Revision numbers define history order;
   snapshots need no traversal or patch replay.
5. Revisions are linear. Branching and merging are not part of this model.
6. `Score.head_revision_id` identifies the current editable document.
7. Creating or restoring a revision requires `expected_head_revision_id`. The Score
   row is locked; a stale expected head returns `revision_conflict` with `expected_head_revision_id` and
   `current_head_revision_id` instead of silently overwriting the head. A successful save
   appends a complete snapshot numbered from the current head plus one.
8. Saving unchanged content against the same current head is a no-op success. Repeated
   idempotency keys return the original save result. Returning to older content later still
   creates a new revision.
9. Restoring an older snapshot appends the next revision and preserves existing history.
   `ScoreRevisionEvent(type="RESTORE")` owns target, actor, note and time provenance.
10. Review confirmation creates the first stable score and revision. Score resources have no review-approval lifecycle.

## Concurrency domains

Metadata PATCH locks Score and compares `expected_metadata_version` with
`metadata_version`. Stale writes return `score_metadata_conflict`. A matching,
normalized metadata no-op preserves both the token and `updated_at`; an actual
change increments only `metadata_version`.

Notation writes compare `expected_head_revision_id` with the current head and
never change metadata or its token. Metadata edits and notation edits are
independent concurrency domains. `ScoreRead.head_revision_number` projects the
head's immutable `ScoreRevision.revision_number`; Score stores no revision number.
`updated_at` records resource recency for metadata changes and revision appends,
and is not a concurrency token.

## Lifecycle contract

```text
ImportJob: QUEUED -> PROCESSING -> READY_FOR_REVIEW -> CONFIRMED
                         \-> FAILED

Score: no lifecycle state column in the current model
```

`ImportJob.READY_FOR_REVIEW` means review artifacts exist and are ready for human
confirmation. `ImportJob.CONFIRMED` means confirmation created a canonical score and
recorded `score_id`.

## API identity contract

- upload submission and polling use `job_id`;
- review routes use `job_id`; confirming review returns the created `score_id`;
- results, editor, history, Guest Preview management and practice use `score_id`;
- Practice admissions pin `revision_id`;
- score-facing DTOs do not expose processing progress as score state.

## Presentation scheduling

Revision transactions persist render/playback outboxes before commit and immediately
attempt dispatch afterward. Workers generate only for an active Score head; presentation retention protects only that head. Score presentation reads the current
head only; unowned historical derivatives are disposable immediately, while canonical
snapshots remain durable. Beat recovers
missed deliveries and stale leases. See [revision derivatives](../architecture/revision-derivatives.md).

## Consequences

- Upload and review can continue to expose processing diagnostics without polluting score
  APIs.
- Editor saves are append-only except for same-head unchanged-content no-ops and require
  conflict handling.
- Batch archive/delete must operate on score IDs, while job cancellation/deletion remains a
  separate operation.

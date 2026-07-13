# ADR 0002: Separate Import Jobs From Scores And Use Linear Revisions

- Status: Accepted; review lifecycle details superseded by ADR 0005, and asset storage
  details superseded by ADR 0003
- Date: 2026-06-22
- Scope: P0-1 score-domain contract

## Context

The current `Task` row is both a processing execution record and the durable identity used
by results, editor, history, sharing, downloads, and practice. XML saves replace
`current_xml` or `final_xml` file roles, so document history is not immutable and job
reliability concerns leak into product-resource APIs.

The product is pre-release. Repository searches found no external API consumer beyond the
bundled frontend and tests, so the new `/api/v1/import-jobs` and `/api/v1/scores` resources may
replace task-as-score endpoints during the controlled cutover. If an external consumer is
introduced before that cutover, the replacement contract moves to `/api/v2`.

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
9. The product-facing `current|final` source vocabulary is retired after cutover. Review
    confirmation creates the first stable score/revision; there is no score approval route.

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
- results, editor, history, sharing, publication, and practice use `score_id`;
- practice sessions and publications pin `revision_id`;
- score-facing DTOs do not expose processing progress as score state.

## Consequences

- Upload and review can continue to expose processing diagnostics without polluting score
  APIs.
- Editor saves are append-only except for same-base unchanged-content no-ops and require
  conflict handling.
- Existing tasks with XML need a deterministic score/revision backfill.
- Existing task UUIDs may be reused as score UUIDs only during backfill to preserve local
  links; newly created jobs and scores use independent UUIDs.
- Batch archive/delete must operate on score IDs, while job cancellation/deletion remains a
  separate operation.

## Rejected alternatives

- Keep `Task` and add revision tables: rejected because identity and ownership remain mixed.
- Make every autosave an event stream: rejected because event sourcing is unnecessary.
- Add a revision graph now: rejected because the editor has no merge product contract.
- Continue `current_xml`/`final_xml`: rejected because role replacement cannot express
  immutable history or publication pinning.

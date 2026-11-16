# Import Processing

`ImportJob` owns the user/domain import lifecycle, processing progress, heartbeat,
steps, artifacts and processing diagnostics. A normalized per-user idempotency
key prevents duplicate submissions. No Score exists until review confirmation
creates its canonical revision.

HTTP submission, list/detail and retry use the request's synchronous `Session`.
`ImportJobReadModel` bulk-hydrates the shared list/detail projection. Submission
commits the Job, Dispatch and ordered upload links as one admission transaction.
`POST /api/v1/import-jobs` accepts `upload_ids`, public UUIDs from the Upload resource
at `/api/v1/uploads`. Retry reuses the same ordered Upload identities. Artifact
filenames remain file facts and are independent of Upload resource identity.
`ImportPipelineRunner` in `pipeline_runner.py` materializes admitted inputs, builds and
runs the pipeline, maps exceptions once and invokes `ImportExecutionRecorder` in
`execution_recorder.py`. The recorder persists progress, steps, adopted artifacts
and accepted processing outcomes using a synchronous `Session`. The Import-specific
`lifecycle.py` owns state, timestamp and failure-fact transition effects without commit.

The aggregate states are `QUEUED → PROCESSING → READY_FOR_REVIEW → CONFIRMED`, with
processing failure accepted as `FAILED`. `READY_FOR_REVIEW` closes processing while
leaving the user workflow open. The execution-closed set also includes `FAILED` and
`CONFIRMED`; only the latter two are aggregate terminal outcomes. Recovery resets
PROCESSING to QUEUED; operator rearm resets FAILED to QUEUED. Customer retry admits
a new job with the original ordered Upload identities.

`created_at` is the sole submission/admission instant. `processing_started_at` marks
the current execution's first progress, `processing_last_heartbeat_at` records pipeline
progress observation and `processing_finished_at` records an accepted ready/failed
processing outcome. Dispatch exhaustion can finish processing without a start instant.
`confirmed_at` records Score admission in the confirmation transaction; it never
replaces processing finish. Repeated confirmation preserves it. `updated_at` records
mutation time. All instants are aware UTC. Database checks enforce state/score/time
consistency, complete-or-absent failure taxonomy and progress between zero and 100.

Finalization commits Job state, diagnostics, its ready-for-review/failed notification,
notifications.changed realtime and import_jobs.changed realtime in
one transaction. Review-thumbnail admission shares the success transaction. Admission
failures roll back all these database consequences. Exact-attempt locks and current
execution-closed state ensure redelivery does not repeat notification or realtime rows.
Delivery exhaustion admits failure consequences only when it transitions unfinished work.

Each Job has one `ImportDispatch`, created atomically with the Job and its upload
links. The dispatch owns broker/worker delivery status, attempt count, lease,
delivery diagnostics, originating request correlation and W3C trace context.
`dispatch_uuid` identifies the async delivery operation in worker tracing and
control-plane operations; `job_uuid` identifies its Import domain resource.
Operation creation time belongs to Dispatch; its update time is the later Job or
Dispatch update.

`DurableDeliveryLifecycle` owns dispatch admission, claim, release, completion,
lease recovery and exhaustion. Maintenance recovers expired leases and lists due
dispatches with `SKIP LOCKED`. The relay admits each dispatch before publishing;
broker rejection releases it without consuming an execution attempt. Celery late
acknowledgement, reject-on-worker-loss and single-message prefetch complement
these durable transitions.

A successful claim issues an immutable `ImportExecutionLease` containing the
dispatch UUID, Job UUID, attempt number and fresh opaque token. Worker mutations
lock ImportDispatch before ImportJob and validate the entire lease before binding
execution provenance, updating progress/steps, adopting artifacts or finalizing.
Artifact adoption rechecks the lease transactionally; unadopted writes remain
owned by ObjectWriteIntent cleanup.

Expired DISPATCHED work leaves Job progress untouched. Expired PROCESSING work
with an unfinished Job resets attempt-local execution state and steps when
attempts remain, preserving uploads, options and execution-manifest binding.
Exhaustion records a domain failure for unfinished work. A durable READY_FOR_REVIEW,
FAILED or CONFIRMED outcome reconciles an in-flight command as COMPLETED and is
never reset or re-executed. An Import FAILED can coexist with ImportDispatch COMPLETED when
the command finishes with a domain failure, including on its final allowed
attempt. Ops reports FAILED with Job diagnostics for that outcome. Delivery
FAILED with exhausted attempts reports EXHAUSTED with Dispatch diagnostics.
Completed and exhausted deliveries retain their terminal state under duplicate
claim/dispatch calls. Deletion and owned binary cleanup lock Dispatch before
reloading and locking Job, then reject a Job that is currently PROCESSING.

Orphan-storage maintenance uses configured retention bounds. Operational
remediation uses the isolated control-plane API and audited policy; public errors
do not expose engine/provider failures. Public Import APIs expose domain state,
not delivery leases. See [Tracing](../../operations/observability/distributed-tracing.md)
and [Scheduler Operations](../../operations/observability/scheduler-operations.md).
Review API and score identity are defined in
[ADR 0005](../../adr/0005-review-pipeline-before-score.md).

## Review candidates and canonical sources

The pipeline records raw OMR/intermediate XML as job-scoped review candidates; those
artifacts are not trusted canonical revision sources. User Review MusicXML updates
and confirmation use [canonical document admission](../score-semantics.md#document-admission)
before storing the trusted editable document or revision source. RevisionWriter owns
canonical revision admission. Admission requires
partwise representation, materializes explicit tempo facts and validates the exact
stored bytes with canonical written semantics. Pipeline artifact recording remains
independent of downstream Practice and metadata projection support.

## Failure facts and Customer projection

ImportJob terminal failures own `failure_code`, `failure_stage`,
`failure_classification`, `failure_retryable` and optional `failure_detail`.
The four taxonomy facts are complete in FAILED and absent in every other state.
ImportDispatch independently owns delivery failures and retry/lease decisions.
The execution owner maps each pipeline exception once to DurableFailure;
finalization records those facts with at most 4000 diagnostic characters.

Ops projects the terminal Job failure or the nonterminal Dispatch failure.
Customer responses expose only `public_code`, explicitly mapped from the canonical
code and stage. Unmapped failures have no public code. The browser localizes known
product codes and uses the Import failed copy otherwise; diagnostic detail stays
inside operator/engineering boundaries. Shared delivery records use the same typed
failure-facts helpers, and callers continue to own their transactions.

## Import-owned review and confirmation

`app.modules.import_jobs.review` owns ImportReviewService, its read model, temporary
candidate updates and fenced thumbnail implementation. Its API is the ImportJob
sub-resource `/api/v1/import-jobs/{job_id}/review` (GET/PATCH) with POST `/confirm`.
The browser workspace remains `/review/:jobId` and `/review/:jobId/edit`.

`app.modules.import_jobs.pipeline` owns step composition, deadline/progress tracking
and ImportArtifact recording. Shared processing engines stay in `app.processing`;
Celery structural task protocols belong to `app.task_queue.protocols`.

Confirmation locks ImportDispatch before ImportJob, prepares physical source/thumbnail
writes, then reacquires those locks and revalidates admission. Its single business
transaction creates Score, calls RevisionWriter, promotes required thumbnail/inputs,
updates Job CONFIRMED/score link/confirmed_at, transfers accounting and releases temporary Import
artifacts/upload links through ImportJobDeletionService. That release primitive never
commits and is shared with the customer deletion use case, which owns its commit.
StoredObject retirement owns physical convergence; confirmation does no storage delete.

Confirmation enriches the retained `import.ready_for_review` notification with Score identity and
Score display title in the same business transaction. If retention has removed the notification,
confirmation succeeds without recreating notification history. No confirmed browser
realtime type is introduced. Repeated confirmation returns the existing Score without
repeating writes, accounting, cleanup or notification/realtime consequences. External
work remains in the specific durable outboxes; post-commit relays are latency hints.

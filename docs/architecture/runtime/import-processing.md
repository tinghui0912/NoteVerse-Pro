# Import Processing

`ImportJob` owns the user/domain import lifecycle, processing progress, heartbeat,
steps, artifacts and processing diagnostics. A normalized per-user idempotency
key prevents duplicate submissions. No Score exists until review confirmation
creates its canonical revision.

Each Job has one `ImportDispatch`, created atomically with the Job and its upload
links. The dispatch owns broker/worker delivery status, attempt count, lease,
delivery diagnostics, originating request correlation and W3C trace context.
`dispatch_uuid` identifies the durable command; `job_uuid` identifies the import.

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
Exhaustion records a domain failure for unfinished work. A durable PENDING_REVIEW,
FAILURE or CONFIRMED outcome completes delivery reconciliation and is never reset
or re-executed. An Import FAILURE can coexist with ImportDispatch COMPLETED when
the command finishes with a domain failure.

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
before storing the trusted editable document or revision source. The synchronous
confirmed-score creation entry point enforces the same boundary. Admission requires
partwise representation, materializes explicit tempo facts and validates the exact
stored bytes with canonical written semantics. Pipeline artifact recording remains
independent of downstream Practice and metadata projection support.

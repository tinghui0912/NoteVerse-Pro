# Import Processing

An `ImportJob` owns submission, progress, retry state, heartbeat and processing
errors. A normalized per-user idempotency key prevents duplicate submissions.
Job-scoped storage holds processing and review artifacts. No Score exists until
review confirmation creates its canonical revision.

Submission persists pending work in PostgreSQL. The dispatch service claims due
records using row locking with `SKIP LOCKED`, publishes bounded deliveries and
records retry state. Broker delivery is not an exactly-once guarantee. Worker
claims, terminal-state checks and idempotent domain operations protect execution.
Celery late acknowledgement, lost-worker handling, bounded retries and heartbeat
recovery are complementary protections, not substitutes for durable state.

Stale-job and orphan-storage maintenance use configured age/retention bounds.
Operational remediation uses the isolated control-plane API and audited policy;
public errors do not expose raw engine/provider failures.

Durable work records carry originating request correlation and validated W3C
trace context. Relay and worker attempts produce distinct execution spans.
See [Tracing](../../operations/observability/distributed-tracing.md) and
[Scheduler Operations](../../operations/observability/scheduler-operations.md).

The implementation boundaries are `backend/app/modules/import_jobs`, worker
dispatch/tasks, storage adapters and the import-job database model. Their tests
cover idempotency, competing claims, retry/terminal transitions and review
confirmation. Review API and score identity are defined in
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

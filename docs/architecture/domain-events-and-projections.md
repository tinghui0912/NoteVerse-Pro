# Domain Events and Database Projections

The Domain Event journal owns immutable committed business facts. Named projectors
own durable database representations. NotificationEvent is a notification read
model, RealtimeEvent is browser delivery/replay state, ScoreRevisionEvent is revision
history, StorageUsageEvent is accounting, and OpsAuditEvent is operator audit.
These records retain their separate domain responsibilities.

## Journal authority

`backend/app/db/models/domain_event.py` defines `domain_events`. Each fact has a
monotonic BIGINT ID, unique UUID, semantic event type, schema version, semantic
aggregate type/identity, unique dedupe key, typed JSON payload, occurrence time and
recording time. Aggregate identity has no resource FK. Journal facts survive
resource deletion and have no processing status or mutable timestamps.

Business code appends frozen typed definitions through
`modules/domain_events/journal.py`. It validates the definition and uses conflict-safe
semantic deduplication without committing. Identical immutable facts are idempotent:
event type, schema version, aggregate type/identity and canonical JSON payload must
all match the persisted fact. Reusing a key with any different semantic value is an
invariant violation and raises `DomainEventDedupeConflict`. Payload comparison uses
object equality, independent of JSON key order. IDs, event UUIDs, occurrence times
and recording times do not participate in equivalence; the first persisted fact's
metadata remains authoritative. Conflict exceptions do not include payload values.
PostgreSQL serializes appends with a
transaction-scoped advisory lock held until the business transaction ends. IDs
therefore follow commit order: a checkpoint cannot pass an earlier uncommitted fact
simply because another transaction allocated a larger sequence value. Sequence gaps
are harmless. Transactions acquire the append gate after their domain locks and
perform no external work while holding it.

The ORM rejects journal updates/deletes. PostgreSQL also enforces append-only rows
with a mutation-rejection trigger. The journal has indexes on `(event_type, id)` and
`(aggregate_type, aggregate_id, id)`. It has no retention or user deletion command.

## Transactional projection progress

`domain_projection_checkpoints` stores `projection_name`, `last_event_id` and
`updated_at`. A projection's name identifies an immutable processing contract.
Different projections have independent progress, locks and failure recovery.

`modules/domain_events/projections.py` creates a checkpoint with conflict-safe
insertion, then locks and refreshes it. Each invocation reads at most 100 journal
rows in ID order. Owned event types require an explicitly supported version,
validated payload and matching aggregate identity. Unrelated event types advance
the scan without invoking that projector. An unsupported owned version or invalid
payload blocks the batch; it is not silently skipped.

Projection writes and checkpoint advancement commit in one transaction. Any handler
failure rolls back the entire batch, including notification rows, realtime rows and
transactional PostgreSQL NOTIFY. A retry starts from the same committed checkpoint.
Concurrent runners serialize on the database checkpoint, including first creation.
No process-local mutex is needed. A failed projector does not prevent other named
projectors from running; maintenance reports failure after attempting each one.

Projectors perform database-only work. They do not send mail, call storage or remote
HTTP, or publish Celery tasks. A projector can create a domain-owned durable outbox;
external execution remains the responsibility of that outbox's delivery lifecycle.
Projection checkpoints are not DeliveryRecords and have no dispatch/retry leases.

The retained journal supports rebuilding database representations from an initial
checkpoint. Rebuild orchestration owns preparation of those target representations;
there is no Customer or operator rebuild endpoint. Journal facts are never inferred
from notifications or browser delivery rows.

## Import vertical slice

`modules/import_jobs/events.py` defines schema-version-1 facts:

- `import.job.completed`: Job UUID, recipient user ID and requested-title snapshot.
- `import.job.failed`: Job UUID, recipient user ID and an optional public failure code.

Dedupe keys are `import.job.completed:{job_uuid}` and
`import.job.failed:{job_uuid}`. Payloads contain no notification copy, browser event
types, raw worker exceptions or private diagnostics. Public failure codes use the
Import domain's existing safe vocabulary.

`SyncImportJobService` locks and validates the current attempt, updates the Job and
appends its fact in one commit. Success also admits the review-thumbnail outbox in
that transaction when a review source exists. Failure retains diagnostics on the
Job, not in the event payload. Import delivery exhaustion appends the same typed
failure fact when it establishes a Job failure. Delivery transition rules remain
owned by ImportDispatch and DurableDeliveryLifecycle.

After worker finalization commits, it immediately attempts these database projectors:

| Projection | Database representations |
| --- | --- |
| `import_notifications_v1` | `NotificationEvent(import.completed/import.failed)` and its `RealtimeEvent(notification.created)` wake-up, atomically with the checkpoint. |
| `import_realtime_v1` | `RealtimeEvent(import_job.completed/import_job.failed)`, atomically with its independent checkpoint. |

Notification data retains `job_id` and the success `job_title`; current English copy
belongs to the notification projector. Browser realtime event names and payloads
retain their existing contract. PostgreSQL NOTIFY is a committed-row wake-up
optimization; the RealtimeEvent row is durable delivery/replay state.

A failed immediate projection attempt cannot roll back the committed Job and fact.
`run_domain_projection_maintenance` delegates to
`worker/execution/domain_projections.py` through `run_scheduler_scan`. Beat invokes it
every five seconds. Each scan processes one bounded batch per registered projector;
repeated scans drain backlog without rerunning the Import pipeline. A poisoned event
keeps that projection blocked and logged until its cause is resolved.

Structured events `domain_event.recorded`, `domain_projection.completed` and
`domain_projection.failed` identify journal/projection progress without logging
payloads. Append logs explicitly identify their pending business commit. Projection
failure reports include event identity, projection name, attempted count and error
class; scheduler errors do not expand payload-bearing validation exceptions.

Only Import completion/failure uses these projectors. RevisionService retains its
own current post-commit orchestration. Notification presentation and browser realtime
wire schemas remain separate from journal infrastructure.

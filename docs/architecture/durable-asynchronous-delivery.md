# Durable Asynchronous Delivery

Each domain owns its outbox table, admission, payload and worker. The delivery flow is:

```text
Domain outbox
    → domain admission and payload
    → DurableDeliveryLifecycle
    → dispatch / processing / retry / lease recovery
    → domain worker
```

RevisionMetadataOutbox is revision-owned execution with the same fenced attempt
contract. RevisionWriter admits it atomically with the revision. The metadata worker
computes outside locks and commits result/completion/realtime together after exact
lease/source validation. Semantic extraction failure completes delivery with a FAILED
metadata result; infrastructure failure retries. Five-second metadata maintenance
relays missed work and recovers leases. See [revision writes](revision-writes.md).

Owning business transactions admit their deterministic same-database consequences,
including notification history and realtime wake-ups. DurableDeliveryLifecycle governs
external execution of domain-owned outboxes.

`backend/app/modules/durable_work/delivery.py` owns the shared lifecycle.
`DeliveryRecord` is a narrow structural protocol, not an ORM base. `DeliveryStatuses`
maps the domain's persisted statuses, and `DeliveryLifecyclePolicy` carries explicit
attempt, retry and lease settings. Callers supply `now`. The core depends only on
the Python standard library and performs no IO.

Dispatch accepts due PENDING/FAILED records below the attempt limit. Broker rejection
returns DISPATCHED work to PENDING without consuming an attempt. Claim admission
returns READY, INACTIVE, NOT_DUE or EXHAUSTED; an accepted claim increments the
one-based attempt once and installs a fresh opaque token. The immutable
`DeliveryAttemptLease` carries this attempt number and token. Services build required
domain targets before claiming and include the committed lease in the worker payload.
Tokens are execution capabilities, not log or trace identifiers. Broker-delivered
PENDING/DISPATCHED commands are claimable; FAILED retries respect their due time.

Retry delay is `retry_base_seconds * 2 ** max(0, attempt_count - 1)`. Error text is
bounded to 4000 characters. Completion uses the mapped success status and shared
timestamp/error updates. Dispatch and processing leases use separate timeouts and
expire at the exact cutoff. Recovery makes FAILED work immediately due without
incrementing attempts and immediately clears the previous token. Worker completion,
failure and execution-time domain terminals require all three conditions under a
refreshed row lock: PROCESSING status, matching attempt count and matching token.
The shared `attempt_matches`, `complete_attempt`, `fail_attempt` and `finish_attempt`
mechanics reject stale outcomes without changing durable state. Only accepted current
Render/Playback outcomes publish derived-asset ready/failed realtime signals.
Reset/rearm centralizes common lifecycle field clearing without deciding whether
domain work should be reactivated. Admission short circuits remain domain decisions
and do not invent worker leases.

ImportDispatch, ScoreRevisionRenderOutbox, PlaybackOutbox, MailOutbox, ScoreDeletionOperation and
StoredObjectRetirement enforce PROCESSING if and only if `attempt_token` is non-null
with database CHECK constraints. ObjectWriteIntent enforces the same equivalence for
CLEANUP_PROCESSING; its separate `write_token` identifies a physical-write generation.
Dispatch, failure, completion, recovery and other terminal/reset transitions clear
the processing token. A fresh claim is the only processing entry.

Attempt fencing also guards final semantic adoption. Render and Playback generate and
prewrite outside aggregate/delivery locks, then lock and refresh Score followed by
the exact revision-owned outbox. Admission
checks the common lease and the domain target/source identity before StoredObject
adoption, asset replacement, accounting or retirement enqueue. Successful semantic
adoption and exact delivery completion share one caller-owned transaction. Worker
ready realtime rows are added after accepted completion in that transaction.

Ownership loss raises `StaleDeliveryAttempt`, distinct from domain supersession or
generation failure. It creates no asset/accounting/outbox/realtime mutation. Physical
prewrites remain unadopted ObjectWriteIntents and converge through durable cleanup.
Expensive rendering and storage writes never retain delivery locks across execution.

Authoritative metadata and Render/Playback outcome transactions use strict sync
score realtime publication. Recipient resolution, all RealtimeChange writes/flushes
and pg_notify participate in the same transaction without exception swallowing.
Partial publication failure rolls back the authoritative outcome and every partial
recipient row. Metadata and ready-adoption failure may fail the exact processing
lease in a separate transaction for bounded retry. Accepted derivative FAILED
state and failed realtime also commit together; failed-signal publication failure
leaves PROCESSING for lease recovery. No commit follows a swallowed publication error.

Best-effort notification hints select the explicit best-effort API, whose outer
policy handles its own commit/rollback and logging. They do not provide an atomic
authoritative outcome guarantee. PostgreSQL NOTIFY remains transactional and is
delivered only after commit; the persisted realtime row remains replay authority.

Domain responsibilities remain explicit:

| Domain                  | Domain-owned semantics                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render / Playback       | Revision presentation demand, SUPERSEDED, resource admission, asset short circuits, payloads, revision/score locks and explicit failure facts          |
| Mail                    | Source identity/cancellation, expiry, EXPIRED/PERMANENT_FAILURE decisions, body availability and scrubbing, recipients, provider message identity and explicit mail failure facts; success is SENT |
| Import                  | Job admission/exhaustion, upload availability, Dispatch-before-Job lock order, execution payload and transactional terminal notification/realtime consequences |
| Score deletion          | Score graph cleanup, resource/operation identity and lock order |
| Account erasure         | Closure intent, saved phases and bounded domain cleanup; physical retirement remains independent |
| StoredObject retirement | Repo-wide reference checks, exact physical snapshots, CANCELLED when ownership exists, attempt-token fencing and physical deletion; success is COMPLETED  |

Domains own SQL predicates, row locks and maintenance ordering/batches. Application
or execution boundaries own transactions and explicit durable-delivery phases.
They supply immutable `DurableFailure(code, stage, classification, retryable)` facts
and use `set_failure_facts()` / `clear_failure_facts()` after shared transitions.
`app/shared/durable_failure.py` owns the shared `DurableFailureClass` vocabulary.
`durable_work/failure.py` owns behavioral failure facts, sets or clears them and
bounds diagnostic detail; classification comes from
typed domain outcomes, never from exception text. The four taxonomy fields are all
null or all populated, with one of transient, permanent, user_error or system_error.
`retryable` means automatic durable retry remains; manual operator rearm is a separate
domain eligibility decision. Exhaustion records a domain attempts-exhausted code and
retryable=false. Generic execution exceptions are system_error. Successful completion,
claim, rearm and supersession clear failure facts. Render and Playback retain their exhaustion behavior; Mail selects
permanent failure at its attempt limit. StoredObject retirement combines shared attempt fencing with a fresh claim token, so cancellation/rearm cannot revive an earlier worker. Semantic Take deletion and Bundle GC release references and logical accounting in their own transactions; retirement owns physical IO independently. Tables, domain fields and terminal meaning remain domain-owned.

ObjectWriteIntent owns PREPARED, WRITTEN and ADOPTED physical-write admission meaning. Its cleanup phase maps CLEANUP_PENDING, CLEANUP_DISPATCHED, CLEANUP_PROCESSING, CLEANUP_FAILED and CLEANED to the shared delivery lifecycle. Write generation and per-claim attempt tokens fence stale cleanup and adoption. The cleanup worker holds the intent lock across storage deletion and checks exact StoredObject authority before IO. Write/semantic policy remains outside the delivery core.

Attempt fencing protects durable state ownership, not exactly-once external execution.
Mail sends through its provider before committing the accepted result. An uncertain
network outcome or worker loss can cause an external send to be repeated. A stale
provider response cannot change the current delivery status or provider message ID;
the external delivery guarantee remains at-least-once.

Domain-specific workers and recovery scans retain their workflows and SQL admission.
There is no universal delivery table, domain record or job runner.
`app/db/durable_delivery.py` owns only fresh ORM field factories for mechanical
attempt/lease columns and their DB predicates. Each domain supplies its own
constraint names and processing status; it retains its table, status vocabulary,
target, payload, admission, queries, policies, worker and terminal meaning.
The shared fields exclude resource `created_at` / `updated_at` behavior. Domain
models retain their SQL client defaults as well as per-instance aware UTC defaults.

ImportDispatch, ScoreRevisionRenderOutbox, PlaybackOutbox, MailOutbox, ScoreDeletionOperation,
RevisionMetadataOutbox and StoredObjectRetirement map PROCESSING to attempt-token
ownership. ObjectWriteIntent maps CLEANUP_PROCESSING instead; its `write_token`
continues to own the separate physical-write generation.

Structured failure field factories and the all-null/all-present predicate serve
ImportJob, ImportDispatch, ScoreRevisionRenderOutbox, PlaybackOutbox, MailOutbox and
ScoreDeletionOperation. The predicate derives accepted classifications directly
from the same `app/shared/durable_failure.py` vocabulary, without a DB dependency
on application modules. AccountDeletionOperation and StoredObjectRetirement use the
same structured facts and all-or-none constraint. RevisionMetadataOutbox and
ObjectWriteIntent persist diagnostic detail without structured failure facts.
ImportJob retains its domain state/failure coupling and lifecycle checks.
`DurableDeliveryLifecycle` remains table-free, IO-free and ORM-free;
`durable_work/failure.py` owns behavioral failure facts, not persistence.

Broker publication uses the single
`app.task_queue.producer.send_durable_task` mechanical authority.

Ops reads import, render, playback, mail, score_deletion, account_deletion and
stored_object_retirement. Its canonical
query-time UNION ALL projection normalizes queued, dispatched, processing, retrying,
succeeded, failed, superseded and cancelled. Automatic retry facts determine retrying regardless
of due time. Terminal ImportJob failure supplies domain facts; active delivery uses
ImportDispatch facts. ImportJob.failure_detail holds bounded operator-only
exception evidence. Customer Import responses expose only an explicit product-code
projection as `public_code`; unknown causes have no invented public code.

List filtering, stable ordering and pagination happen in SQL after this projection.
Summary groups the same projection, and generic open/processing/completed-duration
metrics use its status policy. Open work is queued/dispatched/processing/retrying;
superseded and cancelled are terminal and contribute neither backlog nor successful duration.
The operator response exposes failure={code,stage,classification,retryable,detail}
or null, and accepts failure_class as its classification filter.

Ops delegates manual rearm to each domain owner and reads that same projection.
The Ops audit commit atomically persists the accepted rearm and its audit event.
Healthy queued, dispatched, processing, succeeded, cancelled and superseded work reject rearm.
Failed Render, Playback and Score deletion can be manually rearmed after exhaustion;
permanent/expired Mail cannot. Import rearm takes Dispatch then Job locks and resets
execution steps under those locks. Audit remains owned by the Ops route. Domain-owned
records remain the only durable lifecycle authority.


Lifecycle status vocabulary remains domain-specific. Revision metadata uses
`app/db/models/revision_metadata_outbox.py::RevisionMetadataOutboxStatus`, physical
write/cleanup uses `ObjectWriteIntentStatus`, and retirement uses
`StoredObjectRetirementStatus` from their respective model modules. Their ORM
status fields and non-native SQLAlchemy Enum CHECKs project these same enums.
Delivery policies, maintenance predicates and workers consume enum members.
Attempt-token constraints take a domain enum member, including
`ObjectWriteIntentStatus.CLEANUP_PROCESSING`; they do not own a status vocabulary.

`RevisionMetadataDeliverySettings` owns metadata dispatch interval, batch size,
max attempts, retry base, dispatch timeout and processing timeout. Defaults are
5 seconds, 50 rows, 5 attempts, 60 seconds, 300 seconds and 300 seconds respectively.
Beat and delivery read the composed runtime Settings. The lifecycle policy uses
explicit keyword arguments; processing timeout is separate from retry ceiling.

Account erasure and physical retirement persist safe fixed diagnostic summaries, never
raw exception strings containing user data or object keys. Domain failure facts distinguish
dispatch, expired leases, execution, integrity and attempt exhaustion. Permanent integrity
failures stop automatic retry. Ops exposes `can_retry` from domain eligibility; execution
revalidates that eligibility under a row lock. Account rearm preserves its phase;
Retirement rearm preserves its deletion fence. Active leases, success and cancellation
cannot be manually reset. Automatic retryability and operator eligibility are different facts.


Mail delivery uses explicit source identities and domain validity admission described
in [business resource lifecycles](business-resource-lifecycle.md#credential-and-contact-data-lifecycle).
CANCELLED is a terminal Mail state projected as cancelled in Ops. Cancelling a source
clears its current attempt capability and scrubs contact/payload; SENT evidence is
not relabeled as cancelled. Claim and final provider-handoff admission validate the
source without holding database locks across the network. Provider requests already
in flight cannot be recalled; credentials retain their independent invalidation.

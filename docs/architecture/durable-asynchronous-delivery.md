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

[Domain Event projectors](domain-events-and-projections.md) create durable database
representations or outboxes from committed business facts. Their named checkpoints
commit with projection writes and have no delivery status, attempt or lease.
DurableDeliveryLifecycle governs external execution of domain-owned outboxes; it is
independent of journal/checkpoint processing.

`backend/app/modules/async_operations/durable_delivery.py` owns the shared lifecycle.
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

ImportDispatch, RenderOutbox, PlaybackOutbox, MailOutbox, ScoreDeletionOperation and
StoredObjectRetirement enforce PROCESSING if and only if `attempt_token` is non-null
with database CHECK constraints. ObjectWriteIntent enforces the same equivalence for
CLEANUP_PROCESSING; its separate `write_token` identifies a physical-write generation.
Dispatch, failure, completion, recovery and other terminal/reset transitions clear
the processing token. A fresh claim is the only processing entry.

Attempt fencing also guards final semantic adoption. Render and Playback generate and
prewrite outside aggregate/delivery locks, then lock and refresh Score followed by
the exact outbox. Review thumbnails use ImportJob followed by RenderOutbox. Admission
checks the common lease and the domain target/source identity before StoredObject
adoption, asset replacement, accounting or retirement enqueue. Successful semantic
adoption and exact delivery completion share one caller-owned transaction. Worker
ready realtime rows are added after accepted completion in that transaction.

Ownership loss raises `StaleDeliveryAttempt`, distinct from domain supersession or
generation failure. It creates no asset/accounting/outbox/realtime mutation. Physical
prewrites remain unadopted ObjectWriteIntents and converge through durable cleanup.
Expensive rendering and storage writes never retain delivery locks across execution.

Domain responsibilities remain explicit:

| Domain                  | Domain-owned semantics                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render / Playback       | Revision presentation demand, SUPERSEDED, resource admission, asset short circuits, payloads, revision/score locks and diagnostic classification          |
| Mail                    | Expiry, EXPIRED/PERMANENT_FAILURE decisions, body availability and scrubbing, recipients, provider message identity and mail diagnostics; success is SENT |
| Import                  | Job admission/exhaustion, upload availability, Dispatch-before-Job lock order, execution payload and terminal DomainEvents |
| Score deletion          | Score graph cleanup, resource/operation identity and lock order |
| StoredObject retirement | Repo-wide reference checks, exact physical snapshots, CANCELLED when ownership exists, attempt-token fencing and physical deletion; success is COMPLETED  |

Services own SQL predicates, row locks, maintenance ordering/batches and transactions.
They project `apply_async_diagnostic()` / `clear_async_diagnostic()` after shared
transitions. Render and Playback retain their exhaustion behavior; Mail selects
permanent failure at its attempt limit. StoredObject retirement combines shared attempt fencing with a fresh claim token, so cancellation/rearm cannot revive an earlier worker. Semantic Take deletion and Bundle GC release references and logical accounting in their own transactions; retirement owns physical IO independently. Tables, columns and terminal meaning remain domain-owned.

ObjectWriteIntent owns PREPARED, WRITTEN and ADOPTED physical-write admission meaning. Its cleanup phase maps CLEANUP_PENDING, CLEANUP_DISPATCHED, CLEANUP_PROCESSING, CLEANUP_FAILED and CLEANED to the shared delivery lifecycle. Write generation and per-claim attempt tokens fence stale cleanup and adoption. The cleanup worker holds the intent lock across storage deletion and checks exact StoredObject authority before IO. Write/semantic policy remains outside the delivery core.

Attempt fencing protects durable state ownership, not exactly-once external execution.
Mail sends through its provider before committing the accepted result. An uncertain
network outcome or worker loss can cause an external send to be repeated. A stale
provider response cannot change the current delivery status or provider message ID;
the external delivery guarantee remains at-least-once.

Domain-specific workers and recovery scans retain their workflows and SQL admission.
There is no universal delivery ORM or job runner. Broker publication uses the single
`app.task_queue.producer.send_durable_task` mechanical authority.

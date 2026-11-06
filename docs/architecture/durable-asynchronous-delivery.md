# Durable Asynchronous Delivery

Each domain owns its outbox table, admission, payload and worker. The delivery flow is:

```text
Domain outbox
    → domain admission and payload
    → DurableDeliveryLifecycle
    → dispatch / processing / retry / lease recovery
    → domain worker
```

`backend/app/modules/async_operations/durable_delivery.py` owns the shared lifecycle.
`DeliveryRecord` is a narrow structural protocol, not an ORM base. `DeliveryStatuses`
maps the domain's persisted statuses, and `DeliveryLifecyclePolicy` carries explicit
attempt, retry and lease settings. Callers supply `now`. The core depends only on
the Python standard library and performs no IO.

Dispatch accepts due PENDING/FAILED records below the attempt limit. Broker rejection
returns DISPATCHED work to PENDING without consuming an attempt. Claim admission
returns READY, INACTIVE, NOT_DUE or EXHAUSTED; an accepted claim increments the
one-based attempt once. Services build required domain payloads before claiming and
publish the committed attempt count in the worker payload. Broker-delivered
PENDING/DISPATCHED commands are claimable; FAILED retries respect their due time.

Retry delay is `retry_base_seconds * 2 ** max(0, attempt_count - 1)`. Error text is
bounded to 4000 characters. Completion uses the mapped success status and shared
timestamp/error updates. Dispatch and processing leases use separate timeouts and
expire at the exact cutoff. Recovery makes FAILED work immediately due without
incrementing attempts. Optional completion/failure fencing rejects a mismatched
attempt; matching completed attempts are idempotent. Reset/rearm centralizes common
lifecycle field clearing without deciding whether domain work should be reactivated.

Domain responsibilities remain explicit:

| Domain | Domain-owned semantics |
| --- | --- |
| Render / Playback | Revision presentation demand, SUPERSEDED, resource admission, asset short circuits, payloads, revision/score locks and diagnostic classification |
| Mail | Expiry, EXPIRED/PERMANENT_FAILURE decisions, body availability and scrubbing, recipients, provider message identity and mail diagnostics; success is SENT |
| Performance Take deletion | Take/MediaBlob checks, physical deletion, quota release and atomic completion; success is COMPLETED |
| Practice Bundle deletion | Bundle ownership, CREATING/READY/DELETING scans, cancellation and its two object keys; success is COMPLETED |

Services own SQL predicates, row locks, maintenance ordering/batches and transactions.
They project `apply_async_diagnostic()` / `clear_async_diagnostic()` after shared
transitions. Render and Playback retain their exhaustion behavior; Mail selects
permanent failure at its attempt limit. Take and Bundle deletion retain optional
attempt fencing. Bundle deletion consumes the configured deletion delivery policy
used by Take deletion. Tables, columns and persisted status values remain domain-owned.

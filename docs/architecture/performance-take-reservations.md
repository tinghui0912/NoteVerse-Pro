# Performance Take Upload Reservations

UploadReservation is a persisted lifecycle aggregate. Its pure owner is
`backend/app/modules/performance_takes/upload_reservation/domain.py`.
HTTP DTOs carry intent and recording evidence. `PerformanceTakeUploadService`
authorizes the exact Source, calls the Practice planner, orchestrates storage IO,
and executes explicit transition effects. `PerformanceTakeService` owns the durable
Take library: reads, playback, Source reads, and deletion.

## Lifecycle and persistence

The domain owns `UploadReservationStatus`, `FinalizeLease`, orphan candidates,
invariants and transitions. Time, tokens, object keys and lease expiry are explicit
command inputs. No domain transition accesses a database, storage, HTTP or clock.

RESERVED owns a Source and has no finalize lease. FINALIZING owns a Source and one
complete token/key/expiry lease. COMPLETED, CANCELLED and EXPIRED own neither a
Source reference nor a finalize lease. Hydration rejects impossible combinations.
Database checks enforce the same source-ownership and lease tuples.

`upload_reservation/persistence.py` hydrates and applies lifecycle values. It is the
only writer of lifecycle ORM columns and the only orphan-candidate JSON codec.
The canonical JSON array contains `{key, remove_after}` entries with a required
timestamp. Domain commands deduplicate keys and preserve the longest cleanup grace.

Transitions cover upload-capability refresh, finalize acquisition/takeover, fenced
recovery, expiry, cancellation, completion, and cleanup acknowledgment. Each returns
before/after values and effects specifying Source-reference release, quota-hold
release, or quota commit to a completed object. Orphan cleanup ownership is explicit
in the resulting lifecycle value. Application services execute these effects rather
than inferring them from prior status.

## Object ownership

| Object | Owner |
| --- | --- |
| staging object | reservation |
| current final candidate | current finalize lease |
| abandoned or uncertain candidate | orphan cleanup list |
| completed media object | `PerformanceTake.media_object_key` |

Finalization verifies staging size, MIME/container and full SHA-256, copies to a
unique token-owned candidate, and verifies candidate size and SHA-256 equality.
An active finite lease cannot be taken over. Expired takeover assigns a new token
and key and retains the old candidate with a thirty-minute unknown-outcome grace.
Copy and completion both check lease identity; completion also requires a live lease.

Take creation, reservation completion, Source-ownership transfer and quota commit
share one database transaction. Cancellation/expiry terminate reservation Source
ownership and release quota in one transaction. The exact Source is retained by
RESERVED/FINALIZING and then by the completed Take. Replay and finalize do not
reauthorize a live revision or replan scope/tempo.

## Replay, cancellation and recovery

Equal normalized request intent/evidence replays the same reservation. RESERVED
can refresh the upload capability; FINALIZING returns state without a new upload;
COMPLETED returns the same Take. Changed metadata conflicts. CANCELLED/EXPIRED
cannot be reopened with the same client request ID.

Cancellation accepts RESERVED and is idempotent for CANCELLED. Other states return
an error rather than reporting successful cancellation.

Database-disconnect recovery reads current reservation/Take lineage in a fresh
transaction. An atomically completed Take wins; otherwise only the matching
lease may recover to RESERVED, retaining the uncertain candidate for cleanup.
Unexpected active-reservation/Take combinations are invariant violations.

`UploadReservationCleanupService` performs bounded expiry/recovery scans and
storage cleanup. It uses the same domain commands and explicit effects as the
upload service. Recovery commits before slow storage IO. Staging cleanup waits
until all issued upload capabilities have expired. Orphan deletion checks Take
references and grace; acknowledgment rehydrates current state so extended grace
cannot be erased by a stale result. Completed reservation cleanup also supports
an intentionally deleted Take; it does not recreate that Take.

Background cleanup consumes the same reservation lifecycle rules; it does not
repair or invent reservation state. Take deletion outbox owns durable Take
deletion only.

The save request and planning agreement are defined by the
[Practice product contract](practice-product-contract.md#performancetake-upload-reservation).

# Performance Take reservations

## Domain ownership

Performance Takes own recording intent, immutable TakeManifest, client-request
idempotency, Finalization Lease, media readiness and Take lifecycle. Media storage
owns upload transport, exact physical generation, adoption and garbage collection.
Quota Holds and Usage allocations belong to storage governance.

A Manifest freezes admitted practice binding, artifact identity, title snapshot,
capture metadata, score timebase, scope, tempo plan and recording timebase. It remains
self-contained when Score or Practice Bundle references are released. Finalization
does not reconstruct admission from a mutable source or provider key prefix.

## Admission and persistence

`PerformanceTakeReservationService.reserve_upload` validates practice authorization,
recording container policy and file limits. It serializes User lifecycle and capacity,
then creates Manifest, Reservation, UploadSession and durable UPLOAD Hold together.
`(user_id, client_request_id)` is unique. Replay compares the full admitted metadata
and returns the same immutable reservation/session identity; conflicting facts fail.

Reservation has a unique RESTRICT `upload_session_id`, user/manifest ownership,
quota_hold_id, expiry, status and finalizing token/deadline. It contains no private
staging key, provider handle or physical orphan list. UploadSession owns those facts.
Take and Reservation share one Manifest with structural owner constraints.

| Reservation state | Legal progress |
| --- | --- |
| RESERVED | Finalize obtains a lease, or cancellation/expiry releases an unconsumed Hold |
| FINALIZING | Exact current lease admits one result; a known rollback permits retry; expiry permits fenced recovery |
| COMPLETED | Persistent Take/Manifest identity answers replay |
| CANCELLED / EXPIRED | No new Take admission; transfer cleanup continues independently |

## Dual-mode transfer

The reservation response contains `upload_session`. Its owner-authenticated APIs
provide current transfer state, exact part capabilities, provider parts and completion.

SINGLE_PUT inputs up to 20 MiB use signed staging PUT. Completion bounds the full
read and SHA-256. Finalize validates raw capture/container bytes, uses the write
coordinator for a verified copy and adopts the immutable final object.

MULTIPART inputs use 16 MiB default parts and precisely signed per-part lengths.
Audio is limited to 500 MiB, video to 2 GiB. Only the server completes the MPU.
Completion checks parts and exact object size/type/ETag. Finalize does not download
large media, copy it or calculate a full digest. It adopts the final key in place.
Provider checksum/composite metadata remains distinct from a full-object SHA-256.

## Finalization transaction

1. Lock current User/capacity/reservation according to domain admission order.
2. Commit the exact Finalization Lease and close the business Session.
3. Validate or prepare the completed transfer outside database locks.
4. Reacquire admission locks and verify the same lease/Manifest/session.
5. Consume Session, create StoredObject and Take, consume Hold, allocate UPLOAD,
   and complete Reservation in one transaction.

Unknown COMMIT recovery reads a fresh Session and committed Take/Manifest/Hold
lineage. It does not reuse a failed transaction, duplicate accounting or re-consume
a Hold. Concurrent finalizers have one business winner. Stale leases cannot adopt.

## Media readiness

Take media states are UPLOADED, PROCESSING, READY and FAILED. Small verified inputs
become READY directly. Multipart adoption creates TakeProcessingOutbox atomically
and returns UPLOADED. The domain worker claims durable delivery, closes its transaction,
streams the full immutable recording through ObjectIntegrityVerifier, validates the
container, then fills missing StoredObject SHA-256 and marks READY in a fresh fenced
transaction. Retryable availability failures retain bounded retries; invalid content
fails closed. Signed playback is available only for READY recordings.

Celery Beat scans durable processing and transfer work. A lost initial dispatch does
not lose responsibility. Worker execution and provider verification use independent
sessions; no long network stream holds a PostgreSQL transaction.

## Delivery and erasure

`GET /performance-takes/{take_id}/playback-url` authorizes the active owner and returns
`take_id`, `playback_url`, `download_url` and `expires_in`. Audio/video Range transport
belongs to the provider/CDN. The application exposes no Take byte-proxy endpoint.

Deleting a Take releases UPLOAD and semantic recording reference transactionally,
then registers retirement when unreferenced. Shared objects survive remaining owners.
Manifest/reservation history remains until its owning lifecycle permits erasure.

Account erasure uses TAKES for semantic release, TRANSFERS for upload cleanup ACK,
and FINALIZE for Manifest/Reservation/Session history. A pending physical transfer
cannot disappear through User CASCADE. CONSUMED multipart sessions transfer physical
ownership permanently to StoredObject; transfer GC never deletes that final object.
Unknown IO remains explicit and can block final identity erasure rather than discard
cleanup responsibility.

## Verification

The PostgreSQL suites validate quota/usage atomicity, finalize rollback stages,
concurrent finalization, independent unknown-COMMIT recovery, completed manifests
surviving source retention, large-media no-copy/no-read adoption and GC safety.
[Media storage](object-storage.md) describes physical fences and provider boundaries;
[the ADR](../adr/0009-media-storage-refoundation.md) defines shared configuration.

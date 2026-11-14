# Performance Take Upload Reservations

UploadReservation is a persisted lifecycle aggregate. Its pure owner is
`backend/app/modules/performance_takes/upload_reservation/domain.py`.
HTTP DTOs carry intent and recording evidence. `PerformanceTakeUploadService`
authorizes the exact bound Bundle, calls the Practice planner, orchestrates storage IO,
and executes explicit transition effects. `PerformanceTakeService` owns the durable
Take library: reads, playback, download and deletion, using the shared immutable Manifest.

## Capture, saved recording and Composite Video

Capture is browser-produced recording evidence before Save. READY recording owns
AUDIO or VIDEO original media, a LocalMediaAsset and its RecordingTimebase. Capture
supports the [Original Recording Media Admission](../../contracts/practice/recording-media-admission.json);
its generated projections feed browser Recording and the backend PerformanceTake admission adapter.
Codec parameters normalize to the
container MIME for Save admission without transcoding or changing the accepted MIME set.

PerformanceTake is a durable saved Take retaining the exact original recording bytes.
Signed upload, staging verification and the final recording object preserve those bytes
and container. WebM requires its EBML header; MP4 audio/video requires the ISO BMFF
`ftyp` signature at byte offset four. Media kind and Content-Type agree with the
admitted container. Manifest.capture records browser evidence admitted by the server;
recording_media projects the committed recording StoredObject's verified MIME and size.
The saved aggregate requires those independently admitted facts to agree.

Save retains a recording lease before async reserve/PUT/finalize and releases it in
finally. Original download returns exact original AUDIO or VIDEO recording bytes.
Composite Video independently renders clean score plus original recording into a local
derivative video. It is never uploaded or persisted as the Take.

PerformanceTake has no product-level per-file byte-size or recording-duration ceiling.
Capture byte size is positive, and `StorageUsageService.reserve` admits the exact bytes
against the user's available StorageQuota. Insufficient capacity returns
`storage_quota_exceeded`. RecordingTimebase duration and segments follow their structural
and representational invariants. Manifest JSON uses deterministic canonical serialization
without a semantic byte-size ceiling. Finalize verifies actual stored object size,
Content-Type, container signature and full SHA-256 against the admitted recording facts.

## Lifecycle and persistence

The domain owns `UploadReservationStatus`, `FinalizeLease`, orphan candidates,
invariants and transitions. Time, tokens, object keys and lease expiry are explicit
command inputs. No domain transition accesses a database, storage, HTTP or clock.

RESERVED has no finalize lease. FINALIZING has one complete token/key/expiry lease.
COMPLETED, CANCELLED and EXPIRED have no finalize lease. Hydration rejects impossible
combinations; database checks enforce the same status and lease tuples. The lifecycle
aggregate knows only upload/storage lifecycle, independently of score and provenance.

`upload_reservation/persistence.py` hydrates and applies lifecycle values. It is the
only writer of lifecycle ORM columns and the only orphan-candidate JSON codec.
The canonical JSON array contains `{key, remove_after}` entries with a required
timestamp. Domain commands deduplicate keys and preserve the longest cleanup grace.

Transitions cover upload-capability refresh, finalize acquisition/takeover, fenced
recovery, expiry, cancellation, completion, and cleanup acknowledgment. Each returns
before/after values and effects specifying quota-hold release or quota commit to a completed object. Orphan cleanup ownership is explicit
in the resulting lifecycle value. Application services execute these effects rather
than inferring them from prior status.

## Object ownership

| Object                           | Owner                     |
| -------------------------------- | ------------------------- |
| staging object                   | reservation               |
| current final candidate          | current finalize lease    |
| abandoned or uncertain candidate | orphan cleanup list       |
| completed media object           | `StoredObject.object_key` |

Finalization verifies staging size, MIME/container and full SHA-256, copies to a
unique token-owned candidate, and verifies candidate size and SHA-256 equality.
An active finite lease cannot be taken over. Expired takeover assigns a new token
and key and retains the old candidate with a thirty-minute unknown-outcome grace.
Copy and completion both check lease identity; completion also requires a live lease.

New durable save admission authorizes and verifies a live exact bound Bundle under Score,
Revision, selected access fact, Binding and Bundle locks. The lock order and delete/admit ordering
belong to [Practice Bundle](practice-bundle.md#save-and-browser-admission).

`PerformanceTakeManifest` owns one immutable admitted saved-performance snapshot: public Take
UUID, user identity, detached Bundle/Score/Revision/artifact provenance strings, title at admission,
`capture` kind/MIME/byte size admitted from the browser, resolved scope, score timebase, tempo plan and RecordingTimebase.
`manifest.py` owns the frozen `TakeManifest` value and its versioned canonical document:
`{"schemaVersion":1,"manifest":...}`. It owns encoding, decoding and SHA-256 of the exact
canonical UTF-8 document bytes. The row stores `id`, `user_id`, `take_uuid`, `manifest_json`,
`manifest_sha256` and `created_at`. The digest is a non-unique integrity fingerprint,
independent of StoredObject's physical-byte SHA. `manifest_persistence.py` maps the value
and row, requiring exact canonical representation and digest agreement. Invalid documents
fail closed. API responses project the semantic snapshot without persistence fields.

Reservation and Take reference the exact same Manifest row. Reservation owns idempotency,
quota hold, staging and finalize/cleanup lifecycle. Take joins one Manifest and one StoredObject
and owns the live navigation pointer and library membership. Manifest has no storage locator, upload
state, navigation pointer or Bundle/Revision FK. Only revision bindings retain PracticeBundle.

Reserve commits Manifest, Reservation and quota hold atomically. Concurrent equal client requests
retain one of each. Both Reservation and Take responses expose the same nested `manifest`
projection; their public `take_id` comes from Manifest.take_uuid. The composite Reservation
Manifest/owner FK enforces agreement with its idempotency user. Take.manifest_id is unique.

Finalization holds an immutable TakeManifest value across slow storage IO and creates a Take
with its manifest_id, recording_object_id and library facts. StoredObject creation, Take creation,
reservation completion and quota commit share one transaction. Finalize performs no Bundle read, authorization or replanning.
It resolves an optional current Score navigation link by the Manifest score UUID; a missing or
deleting Score produces a null pointer. Read-time Score access controls navigation.

Take deletion removes semantic Take ownership and releases its logical quota in one transaction. It queues recording StoredObject retirement only when no semantic owner remains. Manifest and Reservation remain as idempotency lineage. Cancellation and expiry preserve the same Manifest without introducing a separate Manifest cleanup lifecycle.

## Replay, cancellation and recovery

Equal normalized request intent/evidence replays the same reservation. RESERVED
replay compares the Manifest's typed `admitted_upload_metadata` projection with request
metadata, without Bundle reauthorization or planning. RESERVED
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
until all issued upload capabilities have expired. Orphan deletion checks committed StoredObject
identity and grace; acknowledgment rehydrates current state so extended grace
cannot be erased by a stale result. Completed reservation cleanup also supports
an intentionally deleted Take; it does not recreate that Take.

Background cleanup consumes the same reservation lifecycle rules; it does not
repair or invent reservation state. Committed StoredObjects use the independent
repo-wide durable retirement boundary.

The save request and planning agreement are defined by the
[Practice product contract](practice-product-contract.md#performancetake-upload-reservation).

## Durable Practice score timebase

The Manifest persists `ticks_per_quarter BIGINT NOT NULL`, exact resolved scope ticks and
ordered tempo positions. Both response paths read `manifest.score_timebase`; the separate
`manifest.recording_timebase` maps integer performance microseconds to integer media microseconds.
Its `nominalMediaDurationUs` is the sole nominal recording duration authority.

Admission derives scope, tempo and score grid from the exact bound Bundle. Replay and finalize
consume that same immutable Manifest after Score/Revision deletion or Bundle GC. Manifest alone
owns the positive JSON-safe grid and scope-coordinate database constraints.

Browser Save uses one manifest-level agreement function for Reservation and Take. It compares
the server grid, binding, scope and tempo with executed Plan truth. A RESERVED mismatch follows
cancellation policy before upload. Saved score-based export reauthorizes the revision Bundle
and requires exact Manifest Bundle/artifact identity, score timebase and scope agreement.

## Durable server bytes

`modules/storage_objects/facts.py` owns immutable StoredObjectFacts; `modules/storage_objects/persistence.py` is its
single hydration boundary. A StoredObject records object key, exact byte size,
full server-computed SHA-256 and canonical content type. Locator uniqueness is object key within the deployment namespace. Hashes are observations; domain-owned reuse policies do not imply global deduplication. StoredObject has no user, Capture kind,
Practice identity, authorization or lifecycle state.

Manifest.capture describes the exact browser Capture admitted for Save. Take aggregate admission
requires its MIME and byte size to match the recording StoredObject. The StoredObject is created only after a
complete candidate read proves its hash equals the container-validated staging bytes. Storage
metadata supplies no authoritative digest. Missing adapter content type uses admitted canonical
Capture MIME after byte/container verification. Raw bytes are preserved without transcoding.

Playback/download and Take.recording_media consume recording StoredObject MIME/size. Saved OPFS materialization uses
that recording-media projection; reservation agreement uses Manifest.capture. Finalize responses also
require recording/Capture consistency. Object key/hash stay private.

StoredObjectRetirement snapshots physical facts as operation evidence, not current physical authority. The worker locks StoredObject and the operation, validates the claim and all semantic references, then flushes the FK-protected row deletion before physical IO. Shared objects remain for their other owners. Missing physical bytes are idempotent; missing physical authority fails closed. StorageUsage is an accounting ledger, never a playback locator authority. Manifest/Reservation lineage survives semantic Take deletion and physical retirement.

## Semantic deletion and physical retirement

Successful DELETE returns bodyless HTTP 204. The transaction removes the PerformanceTake row and
releases logical quota before the response. Detail, playback-url and media return 404,
and lists omit the Take. Manifest and Reservation retain their idempotency lineage.
StoredObjectRetirement owns asynchronous physical cleanup; its pending state and
operation identity are not Take API state. Physical bytes may remain until retirement
converges. My Performances removes the deleted resource from React Query caches,
invalidates list and storage-usage queries and closes confirmation without polling.

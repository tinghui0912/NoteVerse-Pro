# Performance Take Upload Reservations

UploadReservation is a persisted lifecycle aggregate. Its pure owner is
`backend/app/modules/performance_takes/upload_reservation/domain.py`.
HTTP DTOs carry intent and recording evidence. `PerformanceTakeUploadService`
authorizes the exact bound Bundle, calls the Practice planner, orchestrates storage IO,
and executes explicit transition effects. `PerformanceTakeService` owns the durable
Take library: reads, playback, download and deletion, using the shared immutable Manifest.

## Capture, archive and export

Capture is the raw browser MediaRecorder artifact, incrementally written to a temporary
OPFS file under explicit browser-local ownership. Practice admits an archiveable
browser-supported container and validates the recorder's actual MIME before producing
READY capture. VIDEO supports WebM and MP4; AUDIO supports WebM, MP4, Ogg, WAV and
x-WAV. Codec parameters may remain on the capture MIME; archive requests normalize
the container MIME without introducing codec policy.

Archive is an explicit Save of those exact capture bytes as a PerformanceTake.
Signed upload, staging verification and the final object preserve the raw bytes and
container; there is no transcoding or recomposition. WebM requires its EBML header;
MP4 audio/video requires the ISO BMFF `ftyp` box signature at byte offset four.
Media kind and storage Content-Type must agree with the admitted container.

Save retains a temporary media lease before scheduling reserve/PUT/finalize and releases
it in finally, so leaving Review cannot remove an in-flight upload source.

Original media download returns raw Capture/Take media with the corresponding file
extension. VideoExport is a separate browser-local composition/download operation
with its own encoder policy. Its composed score/video output is not the archive
format and is not stored by PerformanceTake. The 100 MiB Take limit and upload
reservation lifecycle remain independent of format selection.

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

New durable save admission authorizes and verifies a live exact bound Bundle under Score,
Revision, selected access fact, Binding and Bundle locks. The lock order and delete/admit ordering
belong to [Practice Bundle](practice-bundle.md#save-and-browser-admission).

`PerformanceTakeManifest` owns one immutable admitted saved-performance snapshot: public Take
UUID, user identity, detached Bundle/Score/Revision/artifact provenance strings, title at admission,
media kind/MIME/byte size, resolved scope, score timebase, tempo plan and RecordingTimebase.
`manifest.py` exposes the frozen `TakeManifest` value; `manifest_persistence.py` is its single
hydration and canonical JSON codec. Invalid persisted snapshots fail closed.

Reservation and Take reference the exact same Manifest row. Reservation owns idempotency,
quota hold, staging and finalize/cleanup lifecycle. Take owns final media locator/backend,
live navigation pointer and library/deletion lifecycle. Manifest has no storage locator, upload
state, navigation pointer or Bundle/Revision FK. Only revision bindings retain PracticeBundle.

Reserve commits Manifest, Reservation and quota hold atomically. Concurrent equal client requests
retain one of each. Both Reservation and Take responses expose the same nested `manifest`
projection; their public `take_id` comes from Manifest.take_uuid. The composite Reservation
Manifest/owner FK enforces agreement with its idempotency user. Take.manifest_id is unique.

Finalization holds an immutable TakeManifest value across slow storage IO and creates a Take
with its manifest_id and physical/library facts. Take creation, reservation completion and quota
commit share one transaction. Finalize performs no Bundle read, authorization or replanning.
It resolves an optional current Score navigation link by the Manifest score UUID; a missing or
deleting Score produces a null pointer. Read-time Score access controls navigation.

Take deletion snapshots a self-contained outbox payload, removes final media and the Take row,
and releases quota. Manifest and Reservation remain as idempotency lineage. Cancellation and
expiry preserve the same Manifest without introducing a separate Manifest cleanup lifecycle.

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

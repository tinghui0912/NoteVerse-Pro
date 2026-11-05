# Performance Take Upload Reservations

UploadReservation is a persisted lifecycle aggregate. Its pure owner is
`backend/app/modules/performance_takes/upload_reservation/domain.py`.
HTTP DTOs carry intent and recording evidence. `PerformanceTakeUploadService`
authorizes the exact Source, calls the Practice planner, orchestrates storage IO,
and executes explicit transition effects. `PerformanceTakeService` owns the durable
Take library: reads, playback, download and deletion from its own durable snapshots.

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

New durable save admission authorizes and verifies a live exact Source under Score,
Revision, authorization-fact and Source locks. The lock order and delete/admit ordering
belong to [Practice Source](practice-source.md#durable-save-admission). The reservation
snapshots source_id, source_score_uuid, source_revision_uuid, source_artifact_id,
score_title_snapshot and server-resolved scope/tempo. Provenance is immutable metadata,
not Source ownership. A committed reservation finalizes independently of Source lifetime.

Take creation, reservation completion and quota commit share one database transaction.
Cancellation/expiry release quota in one transaction. Finalize copies provenance, title,
resolved scope/tempo and recording timebase without Source reads or replanning. Its live
navigation FK follows ON DELETE SET NULL; the read projection decides whether navigation
is currently authorized. PracticeSource has only its ScoreRevision lifecycle owner.

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

The reservation and Take persist `ticks_per_quarter BIGINT NOT NULL`. Their
`score_timebase: { ticks_per_quarter }` API field is independent of
`recording_timebase`, which maps performance milliseconds to media milliseconds.
Scope and tempo positions share this one score coordinate system.

Admission reads the exact Source artifact's `ticksPerQuarter` while resolving the
scope and tempo plan. Idempotent replay returns the persisted timebase. Finalize
copies it from the reservation snapshot, without Source access or replanning.
Take reads and lists retain the complete coordinate snapshot after Source GC.

Both tables constrain positive JSON-safe `ticks_per_quarter`, nonnegative
JSON-safe `scope_start_tick`, positive JSON-safe `scope_terminal_tick`, and
`scope_terminal_tick >= scope_start_tick`. Stored API snapshots validate their
score timebase, integer scope coordinates and ordered integer tempo positions.

Browser save agreement compares the server's grid with the admitted artifact
before uploading media. A mismatch follows reservation cancellation policy.
Saved score-based export also requires matching artifact identity, score timebase
and scope; coordinates are never rescaled to another artifact grid.

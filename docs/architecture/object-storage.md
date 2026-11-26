# Media storage

## Responsibilities and dependencies

`app/storage/` is the provider boundary. It owns synchronous object operations,
SigV4 capabilities, multipart requests and provider exception translation. It imports
no ORM, HTTP framework or business services. ETag, provider transport checksums and
user metadata are distinct observations; an ETag is not a full-object SHA-256.

`app/modules/media_storage/` owns physical facts, write intents, upload sessions,
admitted reads, delivery and retirement. Business domains own authorization, object
key construction, semantic references, resource retention and media readiness.
`storage_governance` independently owns logical accounting, quota and inventory.

## StoredObject

`stored_objects` contains a unique immutable `object_key`, `byte_size`, `content_type`,
nullable full-object `sha256`, `provider_etag`, paired `transport_checksum_algorithm`
and `transport_checksum`, and creation identity/time. It has no user ownership,
filename, permission, quota or global content-deduplication responsibility.

Server-generated and small verified inputs carry a complete SHA-256 at adoption.
Large direct uploads initially carry provider observations. Take media processing
streams the complete recording asynchronously and fills the missing digest after
validating the container. Composite checksums are explicitly labelled; they do not
establish a full-object SHA-256. Known immutable facts must agree at reuse.

## Server-generated writes

`ObjectWriteCoordinator` owns an independent `SessionFactory`. `write_bytes`,
`write_batch` and `copy_object` return immutable `ObjectWriteReceipt` values.

1. A short transaction reserves exact intent facts and generation, records WRITING,
   commits and closes its Session.
2. Provider writes and bounded copy verification execute without an open coordinator
   Session, checked-out connection, transaction or row lock.
3. A fresh short transaction validates the generation token and records WRITTEN.
4. `adopt_written_object` participates in the business transaction: StoredObject,
   semantic resource, Usage allocation and Hold consumption commit atomically.

A batch reserves all intents together and records its results together. Successfully
written but unadopted objects and definitively rejected/unissued writes remain
cleanup-owned. An uncertain mutation retains WRITE_UNKNOWN; neither a new generation
nor cleanup can erase its responsibility. Expired WRITING becomes WRITE_UNKNOWN.
A zero inventory observation alone cannot settle an unknown external mutation.
Provider settlement for such outcomes remains an operational prerequisite.

## Upload sessions

`upload_sessions` records exact user, purpose, immutable physical keys, generation,
mode, declared byte size/content type, part plan, provider handle, operation token,
unknown-result flag, observed integrity facts, expiry and cleanup acknowledgment.
User deletion uses RESTRICT. UploadCreationRequest, Upload and Take Reservation use
explicit unique session foreign keys. Purpose is a route discriminator, not a
polymorphic ownership relation. Domain admission creates sessions; clients cannot
bind an arbitrary session to another resource.

| Mode | Transfer and adoption | Cleanup ownership |
| --- | --- | --- |
| SINGLE_PUT, at most 20 MiB | Precisely signed length/type to staging; full bounded validation; intent-owned copy to an immutable final key | Session GC deletes staging; StoredObject retirement owns the adopted final object |
| MULTIPART, over 20 MiB | Exact signed part lengths; provider parts verification; server completion and metadata verification; in-place adoption | Before consumption Session GC aborts MPU and deletes input; after CONSUMED only StoredObject retirement owns the final key |

The configured defaults are 16 MiB parts, 15-minute capabilities, 24-hour sessions,
three suggested client transfers, five active sessions and 4 GiB unconsumed declared
bytes per user. Score Import is limited to 20 MiB, Take audio to 500 MiB and video to
2 GiB. Capacity admission is a separate User quota decision.

`CREATING → UPLOADING → COMPLETING → COMPLETED → CONSUMED` is the success path.
CANCELLED, EXPIRED and FAILED retain cleanup evidence. Create intent is committed
before provider initiation. Exact-key MPU discovery can recover a returned-but-not-
persisted handle; absent or ambiguous discovery remains unsettled. An uncertain
completion recovers from exact object metadata. Operation tokens reject stale result
publication. Blind provider mutation retries are disabled.

Periodic upload maintenance uses bounded scans. It preserves uncertain create/complete
responsibility, waits for issued capability expiry, aborts exact multipart handles,
deletes temporary input and verifies absence before acknowledging cleanup. A
CONSUMED multipart object is never deleted by session maintenance. Unknown provider
IO and previously started signed requests require deployment-specific settlement
assurance: capability expiry alone does not prove every in-flight request has ended.
No cleanup acknowledgment is a claim about backups or retained object versions.

## Semantic references and retirement

`SEMANTIC_REFERENCES` explicitly declares all nine semantic foreign-key relations:
Upload, ImportArtifact, Revision Source, Render Asset, Playback Asset, Take Recording,
Bundle MusicXML, Bundle Artifact and Avatar. RESTRICT foreign keys are the final
physical-row deletion barrier. Logical accounting preserves resource multiplicity
when physical objects are shared across owners.

Business deletion removes its semantic reference, releases Usage and calls
`retire_after_release` in the same transaction. `retire_if_unreferenced` locks the
StoredObject, checks every semantic reference and commits an irreversible deletion
fence. `retain_for_reference` uses the same serialization and rejects fenced objects.
A reference-bearing fenced object is an integrity violation.

StoredObjectRetirement preserves exact object facts and delivery evidence independently
of the User or business row. The worker checks references and snapshot, commits its
attempt fence, performs idempotent provider deletion, then records completion. Lost
commit acknowledgments converge through persisted delivery identity and idempotent
delete. Failures retain bounded retry facts and are visible through unified Ops.
Exhausted failures require repair and authorized operator rearm; fences remain intact.

## Reads and delivery

Database semantic references admit immutable read facts. Normal authorization/list
queries do not HEAD the provider. Missing admitted bytes raise StoredObjectIntegrityError;
provider availability failures remain distinct. Worker materialization uses admitted
reads rather than private provider-to-disk methods.

`MediaDeliveryService` signs short-lived playback/download capabilities after domain
authorization. Score playback, Guest Preview playback and Take playback-url return
JSON signed access. Large audio/video bytes and Range requests go directly to object
storage/CDN. Capability responses use private/no-store HTTP policy; immutable physical
objects can use provider/CDN caching. Controlled backend streams serve authorized small
resources; they do not determine business ownership.

## Account erasure and verification

TAKES releases business recordings and Holds. TRANSFERS cancels and settles upload
sessions. FINALIZE removes command/manifest/session history after cleanup ACK and
checks semantic inventory, Usage and Quota before deleting User. Official retirement
continues independently and preserves objects still referenced by other users.

PostgreSQL tests exercise independent transactions, consumption/cancellation races,
quota admission, coordinator I/O separation, uncertain commits, retirement fences and
shared references. The single initial Alembic migration creates the full schema and
finite plan seeds. Fresh upgrade/downgrade/upgrade and metadata parity validate it.

See [the media storage ADR](../adr/0009-media-storage-refoundation.md),
[Take reservations](performance-take-reservations.md),
[business lifecycles](business-resource-lifecycle.md) and
[resource governance](storage-resource-governance.md).

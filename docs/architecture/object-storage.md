# Durable ObjectStorage and StoredObject

NoteVerse uses one private `ObjectStorage` namespace per deployment. The capability-only port in `app/storage/base.py` executes generic writes, stat, reads/ranges, copy, deletion, direct-upload and signed-download operations. `ObjectWriteResult` reports an operation's object key and byte size; `ObjectMetadata` reports provider observations. Neither creates persistent physical authority.

`StoredObject` in `app/db/models/stored_object.py` persists exactly `id`, `object_key`, `byte_size`, `sha256`, `content_type` and `created_at`. Its key is unique within the deployment namespace. Byte size is nonnegative. SHA-256 is a full lowercase digest and is not unique. Filename, user, product identity, authorization, generator and lifecycle belong to semantic owners.

`modules/storage_objects/facts.py` validates the immutable `StoredObjectFacts` value. `persistence.py` is the physical-fact hydration/creation boundary. Application-verified complete bytes establish size and SHA; provider checksums and ETags do not establish durable SHA authority.

## Async application IO

`ObjectStorage` is synchronous infrastructure for workers, maintenance and sync
persistence code. The storage composition root also exposes `async_object_storage`,
an `AsyncObjectStorage` over the same configured namespace. Async application
services use that adapter for put, exists, read, size/metadata, copy, delete, presign
and materialization. Provider calls run through `asyncio.to_thread`; streaming
preparation and iterator advancement also cross this boundary. The adapter owns
scheduling only, with no database or domain policy.

Sync and async server writers share generation preparation, exact admission and
WRITTEN finalization primitives. The async writer runs only DB primitives inside
`AsyncSession.run_sync`. Physical put runs through the async adapter while the
same intent transaction retains its row lock. Cancellation waits for in-flight
provider IO to settle before rolling back and releasing that lock. PREPARED stays
durable on failed or uncertain writes; cleanup owns unadopted bytes.

Score-import image admission is described in
[upload media admission](upload-media-admission.md). Avatar normalization and
PerformanceTake recording admission remain independent domain policies. Async IO
does not grant request services permission to delete adopted objects: semantic
release still records accounting and retirement; durable cleanup/retirement owns
physical deletion.

## Semantic references

Upload, ImportArtifact, ScoreRevisionSource, ScoreRenderAsset and ScorePlaybackAsset reference `stored_object`. PerformanceTake references `recording_object` alongside its independent TakeManifest. PracticeBundle references `prepared_musicxml_object` and `artifact_object`. User references its current `avatar_object`. Their foreign keys restrict physical-row removal while any semantic reference remains.

Features own object keys, namespaces, filenames, MIME policy, deduplication and delivery authorization. Upload deduplication uses existing Upload references and the Files-owned deterministic key namespace. A pending-retirement object at that exact key is reacquired under the retirement fence; a matching SHA in another domain grants no reuse. StoredObject implies no global deduplication. Account creates an immutable processed-JPEG key and derives a stable application avatar URL from the current reference. The avatar endpoint issues a fresh signed download capability.

TakeManifest.capture remains admitted browser provenance. Take aggregate admission verifies its MIME and byte size agree with the recording StoredObject. Finalize streams complete staging and copied candidate bytes, verifies both full hashes, then commits StoredObject, Take, reservation completion and quota atomically.

## Durable server creation

```text
ObjectWriteIntent
    → verified write + semantic adoption
StoredObject
    → final semantic release
StoredObjectRetirement
```

ObjectWriteIntent owns server-created bytes before semantic adoption. It persists immutable key/size/SHA/content-type evidence, a write generation and a finite adoption lease, independently of user/quota/feature facts. One exact key coordinates through one intent. Conflicting immutable facts fail before IO; the same key can acquire a fresh generation after cleanup or committed-object retirement.

The server commits PREPARED before physical mutation. A separate transaction locks the intent, validates its generation, performs put while retaining the row lock, checks returned key/size, marks WRITTEN and commits. An interrupted put retains PREPARED evidence. Ordinary writes derive SHA and size from the exact server-owned bytes; provider metadata is not hash authority. Bundle representations also retain exact read-back verification.

Adoption locks the WRITTEN intent, checks generation/facts/lease, and creates or retains the matching StoredObject. The semantic owner, quota effects and ADOPTED transition commit together. On rollback the write remains unadopted and cleanup-owned. An existing exact StoredObject needs no physical rewrite. Its intent records existing ADOPTED authority without speculative retention, and semantic attachment retains it under the retirement fence. If that authority retires before attachment, the receipt cannot create a new StoredObject; a fresh generation must write first. A matching SHA at another domain key grants no reuse.

Prewrite transactions precede semantic mutation and require a clean semantic session. Domain application code reestablishes its parent admission after prewrite commits. Domain parent locks (Score/Revision, Bundle, User or ImportJob) precede intent locks during semantic adoption. The shared physical lock order is ObjectWriteIntent → StoredObject → StoredObjectRetirement. Retirement itself never needs a write-intent lock. Multiple representation writes finish before their one semantic replacement transaction begins.

Expired PREPARED/WRITTEN generations become CLEANUP_PENDING. Cleanup dispatch/claim/retry/lease recovery delegates to DurableDeliveryLifecycle using CLEANUP_DISPATCHED, CLEANUP_PROCESSING, CLEANUP_FAILED and CLEANED. The worker commits its claim, then locks the intent and checks generation plus attempt token. A matching StoredObject means ADOPTED with no delete. Conflicting facts fail closed. Without a StoredObject it deletes under the intent lock and commits CLEANED. A storage failure rolls back and records CLEANUP_FAILED in a fresh transaction. Missing keys and uncertain completion retries are idempotent. Stale writers/adopters cannot revive cleaned or reprepared generations.

Account Avatar, Files, Review confirmation/source replacement/thumbnail, Revision create/restore, worker Score creation, Render pages, Playback audio and Import artifact recording consume this protocol. Review confirmation prewrites canonical MusicXML and its optional thumbnail before constructing semantic rows. Import handoff carries intent UUID/generation and filename/page metadata rather than a second physical-facts dictionary. PracticeBundle CREATING has null representation FKs; READY acquires both written representations and a binding in its semantic transaction.

ObjectStorage is not part of a database transaction. Safety comes from durable operation state, row locks across physical IO, immutable keys, idempotent operations and retry. There is no distributed atomic commit.

## Semantic release and durable retirement

StoredObject may be shared across domains by exact physical identity. The real semantic foreign keys are the ownership authority; `modules/storage_objects/references.py` enumerates every such reference. Physical deletion never follows a local-domain-only reference count.

```text

Semantic reference release

    → repo-wide reference authority

    → last reference: StoredObjectRetirement

    → DurableDeliveryLifecycle

    → FK-validated StoredObject row deletion

    → ObjectStorage delete

```

A domain removes and flushes its reference, releases its logical accounting and queues eligible retirement in the same transaction. Upload, Avatar, Import, Review artifacts, Render/Playback, derivative retention, Score cleanup, Take deletion and Bundle GC use this boundary. Take Manifest and Reservation lineage remain. Accounting belongs to the semantic allocation and does not wait for physical retirement.

`retire_if_unreferenced` locks StoredObject and checks all semantic references before creating or rearming one operation. `retain_for_reference` locks the same row and its operation, cancels pending retirement and admits a new reference. A worker that wins the destructive lock completes before acquisition can continue; acquisition then follows normal object creation if the row is gone.

The worker commits its claim separately. Its destructive transaction locks StoredObject then the retirement operation, verifies attempt count and token, compares snapshot facts, and checks all semantic references. A referenced object produces CANCELLED. Otherwise ORM deletion is flushed before storage IO, so every RESTRICT foreign key is validated before bytes can be deleted. The database commits row removal and operation completion after physical IO succeeds; an uncertain database completion retries the idempotent deletion. Storage failure rolls back row removal and records FAILED in a fresh transaction. An absent physical key is idempotent; an unexpectedly absent StoredObject fails closed without deleting the snapshot key.

Retirement states are PENDING, DISPATCHED, PROCESSING, FAILED, COMPLETED and CANCELLED. Shared delivery policy owns retry, lease expiry, dispatch and reset. A fresh attempt token fences cancelled/rearmed work as well as lease takeover. Immediate dispatch is best effort; periodic maintenance is the durable recovery path.

Temporary upload staging, finalizing and orphan keys are reservation lifecycle locators, not StoredObjects. Unadopted server writes remain owned by ObjectWriteIntent until ADOPTED or CLEANED. Retirement snapshots and StorageUsage reservation/event keys are operation/accounting evidence, not current physical authority. Neither snapshot retains semantic ownership.

## Infrastructure and verification

`app/storage/s3_compatible.py` implements the configured S3-compatible protocol. Application modules depend on the port and composition root. No database row chooses a provider. Delivery explicitly uses signed capabilities or authorized application streaming/redirect endpoints; raw public object URLs are not part of the port.

Development uses the same application protocol as production. `docker-compose.backend-dev.yml` supplies the development object-store service. Backend filesystem durable storage and backend upload fallback do not exist. Worker materialization writes disposable files under `WORK_ROOT`. Browser OPFS and LocalMediaAsset are independent transient browser resources.

Unit/application tests use a test-only object-map adapter. `NOTEVERSE_TEST_OBJECT_STORAGE_*` selects a dedicated network integration namespace for direct upload, metadata, full/range reads, copy, signed download and deletion. Network integration is reported separately from SDK-boundary and unit tests.

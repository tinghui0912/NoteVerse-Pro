# Durable ObjectStorage and StoredObject

NoteVerse uses one private `ObjectStorage` namespace per deployment. The capability-only port in `app/storage/base.py` executes generic writes, stat, reads/ranges, copy, deletion, direct-upload and signed-download operations. `ObjectWriteResult` reports an operation's object key and byte size; `ObjectMetadata` reports provider observations. Neither creates persistent physical authority.

`StoredObject` in `app/db/models/stored_object.py` persists exactly `id`, `object_key`, `byte_size`, `sha256`, `content_type` and `created_at`. Its key is unique within the deployment namespace. Byte size is nonnegative. SHA-256 is a full lowercase digest and is not unique. Filename, user, product identity, authorization, generator and lifecycle belong to semantic owners.

`modules/storage_objects/facts.py` validates the immutable `StoredObjectFacts` value. `persistence.py` is the physical-fact hydration/creation boundary. Application-verified complete bytes establish size and SHA; provider checksums and ETags do not establish durable SHA authority.

## Semantic references

Upload, ImportArtifact, ScoreRevisionSource, ScoreRenderAsset and ScorePlaybackAsset reference `stored_object`. PerformanceTake references `recording_object` alongside its independent TakeManifest. PracticeBundle references `prepared_musicxml_object` and `artifact_object`. User references its current `avatar_object`. Their foreign keys restrict physical-row removal while any semantic reference remains.

Features own object keys, namespaces, filenames, MIME policy, deduplication and delivery authorization. Upload deduplication uses existing Upload references and the Files-owned deterministic key namespace. A pending-retirement object at that exact key is reacquired under the retirement fence; a matching SHA in another domain grants no reuse. StoredObject implies no global deduplication. Account creates an immutable processed-JPEG key and derives a stable application avatar URL from the current reference. The avatar endpoint issues a fresh signed download capability.

TakeManifest.capture remains admitted browser provenance. Take aggregate admission verifies its MIME and byte size agree with the recording StoredObject. Finalize streams complete staging and copied candidate bytes, verifies both full hashes, then commits StoredObject, Take, reservation completion and quota atomically.

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

The worker commits its claim separately. Its destructive transaction locks StoredObject then the retirement operation, verifies attempt count and token, compares snapshot facts, and checks all semantic references. A referenced object produces CANCELLED. Otherwise ORM deletion is flushed before storage IO, so every RESTRICT foreign key is validated before bytes can be deleted. Physical deletion and operation completion commit together. Storage failure rolls back row removal and records FAILED in a fresh transaction. An absent physical key is idempotent; an unexpectedly absent StoredObject fails closed without deleting the snapshot key.

Retirement states are PENDING, DISPATCHED, PROCESSING, FAILED, COMPLETED and CANCELLED. Shared delivery policy owns retry, lease expiry, dispatch and reset. A fresh attempt token fences cancelled/rearmed work as well as lease takeover. Immediate dispatch is best effort; periodic maintenance is the durable recovery path.

Temporary upload staging, finalizing and orphan keys are reservation lifecycle locators, not StoredObjects. Failed pre-admission writes use separate write compensation. Retirement snapshots and StorageUsage reservation/event keys are operation/accounting evidence, not current physical authority. Neither snapshot retains semantic ownership.

## Infrastructure and verification

`app/storage/s3_compatible.py` implements the configured S3-compatible protocol. Application modules depend on the port and composition root. No database row chooses a provider. Delivery explicitly uses signed capabilities or authorized application streaming/redirect endpoints; raw public object URLs are not part of the port.

Development uses the same application protocol as production. `docker-compose.backend-dev.yml` supplies the development object-store service. Backend filesystem durable storage and backend upload fallback do not exist. Worker materialization writes disposable files under `WORK_ROOT`. Browser OPFS and LocalMediaAsset are independent transient browser resources.

Unit/application tests use a test-only object-map adapter. `NOTEVERSE_TEST_OBJECT_STORAGE_*` selects a dedicated network integration namespace for direct upload, metadata, full/range reads, copy, signed download and deletion. Network integration is reported separately from SDK-boundary and unit tests.

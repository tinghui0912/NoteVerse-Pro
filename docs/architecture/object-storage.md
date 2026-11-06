# Durable ObjectStorage and StoredObject

NoteVerse uses one private `ObjectStorage` namespace per deployment. The capability-only port in `app/storage/base.py` executes generic writes, stat, reads/ranges, copy, deletion, direct-upload and signed-download operations. `ObjectWriteResult` reports an operation's object key and byte size; `ObjectMetadata` reports provider observations. Neither creates persistent physical authority.

`StoredObject` in `app/db/models/stored_object.py` persists exactly `id`, `object_key`, `byte_size`, `sha256`, `content_type` and `created_at`. Its key is unique within the deployment namespace. Byte size is nonnegative. SHA-256 is a full lowercase digest and is not unique. Filename, user, product identity, authorization, generator and lifecycle belong to semantic owners.

`modules/storage_objects/facts.py` validates the immutable `StoredObjectFacts` value. `persistence.py` is the physical-fact hydration/creation boundary. Application-verified complete bytes establish size and SHA; provider checksums and ETags do not establish durable SHA authority.

## Semantic references

Upload, ImportArtifact, ScoreRevisionSource, ScoreRenderAsset and ScorePlaybackAsset reference `stored_object`. PerformanceTake references `recording_object` alongside its independent TakeManifest. PracticeBundle references `prepared_musicxml_object` and `artifact_object`. User references its current `avatar_object`. Their foreign keys restrict physical-row removal while any semantic reference remains.

Features own object keys, namespaces, filenames, MIME policy, deduplication and delivery authorization. Upload deduplication selects only objects already referenced by Uploads; a matching SHA in another domain grants no reuse. StoredObject implies no global deduplication. Account creates an immutable processed-JPEG key and derives a stable application avatar URL from the current reference. The avatar endpoint issues a fresh signed download capability.

TakeManifest.capture remains admitted browser provenance. Take aggregate admission verifies its MIME and byte size agree with the recording StoredObject. Finalize streams complete staging and copied candidate bytes, verifies both full hashes, then commits StoredObject, Take, reservation completion and quota atomically.

## Locators and deletion

Temporary upload staging, finalizing and orphan keys are reservation lifecycle locators, not StoredObjects. Delete-outbox keys are immutable operation snapshots. StorageUsage reservation/event keys are accounting/audit snapshots. These snapshots do not establish current physical facts.

Take and Bundle deletion retain their domain outboxes, payloads and retry policies. Workers check the domain lease/ownership, remove semantic and physical rows under foreign-key protection, delete snapshot objects, and atomically complete domain cleanup. Take Manifest and Reservation lineage remain.

Files deletion, Avatar replacement/clear, Import cleanup, Score cleanup and derivative replacement/retention use their domain cleanup flows. Their synchronous or best-effort object deletion is not a shared durable retirement protocol. A failed post-commit storage delete can leave unreferenced bytes. Domain code never deliberately deletes bytes while retaining a live semantic reference to their StoredObject.

## Infrastructure and verification

`app/storage/s3_compatible.py` implements the configured S3-compatible protocol. Application modules depend on the port and composition root. No database row chooses a provider. Delivery explicitly uses signed capabilities or authorized application streaming/redirect endpoints; raw public object URLs are not part of the port.

Development uses the same application protocol as production. `docker-compose.backend-dev.yml` supplies the development object-store service. Backend filesystem durable storage and backend upload fallback do not exist. Worker materialization writes disposable files under `WORK_ROOT`. Browser OPFS and LocalMediaAsset are independent transient browser resources.

Unit/application tests use a test-only object-map adapter. `NOTEVERSE_TEST_OBJECT_STORAGE_*` selects a dedicated network integration namespace for direct upload, metadata, full/range reads, copy, signed download and deletion. Network integration is reported separately from SDK-boundary and unit tests.

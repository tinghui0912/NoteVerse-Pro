# Durable ObjectStorage

NoteVerse durable binary data uses one configured `ObjectStorage` namespace per deployment. The port is capability-only. Application services and workers depend on `app/storage/base.py`, its neutral capability DTOs, and the deployment composition root. Concrete provider selection belongs to infrastructure configuration.

Feature modules own object identity, object keys, feature namespaces, MIME, deduplication and authorization/delivery policy. Files owns its content-hash upload key policy; Account owns avatar keys, JPEG processing and stable application URLs. `StoredObject` reports only the object key and byte size of a write.

The durable namespace is private. Raw public object URLs are not part of the port. Delivery explicitly uses signed download capabilities or authorized application streaming/redirect endpoints.

`app/storage/s3_compatible.py` implements the S3-compatible wire protocol. Direct upload is a required capability: a short-lived URL, HTTP method and request headers. Download capabilities are signed by the configured adapter. No database row selects a provider. Object keys are unique within the deployment namespace.

Development uses the same object-storage application protocol as production. `docker-compose.backend-dev.yml` supplies a private object-store service and initializes the development namespace. Its signing endpoint is browser-reachable; its internal endpoint addresses the same namespace from containers. Deployment credentials and endpoints are infrastructure configuration. Backend filesystem durable storage and backend upload fallback do not exist.

`MediaBlob` owns the immutable object key, verified full SHA-256, exact byte size and canonical content type. Finalize streams the complete staging and copied candidate objects, compares their hashes, and atomically commits Blob, Take, reservation completion and quota. Provider checksums and ETags do not establish durable byte identity.

Deletion snapshots contain the physical key and accounting facts. Workers use the deployment ObjectStorage and atomically retire Take, Blob and quota with outbox completion. Manifest and reservation lineage remain. Bundle, score sources, generated assets, avatars and processing inputs use the same capability boundary. Profile images use a stable application URL that issues a fresh object download capability.

Worker materialization writes disposable files under `WORK_ROOT`. Browser OPFS and `LocalMediaAsset` are transient browser resources, independent of server durable storage.

Unit/application tests use a test-only object-map adapter. Shared capability checks also exercise the concrete SDK boundary. `NOTEVERSE_TEST_OBJECT_STORAGE_*` selects an explicitly dedicated network integration namespace for direct upload, metadata, streaming/range reads, copy, signed download and deletion. Network integration is reported separately from unit tests.

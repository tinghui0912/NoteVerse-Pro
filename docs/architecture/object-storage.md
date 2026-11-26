# Durable ObjectStorage and StoredObject

NoteVerse uses one private `ObjectStorage` namespace per deployment. The capability-only port in `app/storage/base.py` executes generic writes, stat, reads/ranges, copy, deletion, direct-upload and signed-download operations. `ObjectWriteResult` reports an operation's object key and byte size; `ObjectMetadata` reports provider observations. Neither creates persistent physical authority.

`StoredObject` in `app/db/models/stored_object.py` persists exactly `id`, `object_key`, `byte_size`, `sha256`, `content_type` and `created_at`. Its key is unique within the deployment namespace. Byte size is nonnegative. SHA-256 is a full lowercase digest and is not unique. Filename, user, product identity, authorization, generator and lifecycle belong to semantic owners.

`modules/storage_objects/facts.py` validates the immutable `StoredObjectFacts` value. `persistence.py` is the physical-fact hydration/creation boundary. Application-verified complete bytes establish size and SHA; provider checksums and ETags do not establish durable SHA authority.

## Domain object-key authority

Storage infrastructure owns durable physical facts and the write/adoption/retirement
protocol. Feature domains own semantic object-key construction. ObjectStorage,
ObjectWriteIntent, StoredObject, accounting and retirement consume opaque exact keys;
they neither infer semantic ownership from prefixes nor import feature key builders.

| Semantic object | Owning domain | Canonical builder |
| --- | --- | --- |
| Canonical revision MusicXML | Revisions | `canonical_revision_source_object_key` |
| Temporary Review MusicXML | Import Jobs | `review_musicxml_object_key` |
| Rendered page | Score Assets | `rendered_page_object_key` |
| Revision playback audio | Playback | `playback_audio_object_key` |
| Uploaded blob | Uploads | `blob_object_key` |
| Profile avatar | Account | `avatar_object_key` |
| Bundle MusicXML | Practice Bundle | `practice_bundle_musicxml_object_key` |
| Bundle artifact JSON | Practice Bundle | `practice_bundle_artifact_object_key` |
| Staging recording candidate | Performance Takes | `performance_take_staging_object_key` |
| Finalization-generation recording | Performance Takes | `performance_take_recording_object_key` |

These are internal namespace identities, not Customer API contracts. Revision create,
restore, confirmation and Writer identity verification consume the same revision builder.
Import pipeline recording and Review updates identify the current MusicXML by job and
content SHA-256, with a stable `score.musicxml` delivery filename and canonical MusicXML
MIME. Worker temporary filenames do not determine product identity. Identical bytes
reacquire the exact immutable key through the existing ObjectWriteIntent/retirement
fences. Staging and final recordings have distinct locators; the finalization token
identifies the final physical generation, and recording-media admission owns extensions.
Model assets consume configured/manifest locators independently of runtime producers.

## Application IO and HTTP transport

`ObjectStorage` is synchronous infrastructure. Backend application services,
repositories, API use cases and workers use the canonical synchronous SQLAlchemy
`Session` from `app.db.session`. FastAPI executes ordinary database-backed path
operations in worker threads. Authorization, metadata and signed-URL preparation
run in that request execution path.

HTTP byte streaming uses `AsyncObjectReader` over the same namespace. Provider
iterator construction and advancement cross its `asyncio.to_thread` boundary;
the adapter owns scheduling only, with no database or domain policy.

Server-created durable objects use `write_object()` with synchronous ObjectStorage.
Generation preparation and exact admission precede physical put; the intent row
lock protects the physical mutation until WRITTEN finalization. PREPARED is durable
before IO and WRITTEN is durable before semantic adoption. Failed or uncertain
writes remain cleanup-owned. Adoption, semantic references and accounting commit
in the caller-owned semantic transaction.

Score-import image admission is described in
[upload media admission](upload-media-admission.md). Avatar normalization and
PerformanceTake recording admission remain independent domain policies. IO scheduling
does not grant request services permission to delete adopted objects: semantic
release still records accounting and retirement; durable cleanup/retirement owns
physical deletion.

## Admitted reads

A committed semantic reference to `StoredObject` admits the object's existence and
immutable facts. `modules/storage_objects/reads.py` carries those persisted facts in
immutable read targets and deliveries. Normal list, readiness, authorization and
delivery paths use database facts without provider HEAD probes. Revision sources
and render assets expose their admitted facts. Derived-asset status follows asset rows
and durable delivery state; Guest Preview pages and audio follow current-revision
asset rows.

Actual reads use the admitted-read boundary. A physical not-found is a
`StoredObjectIntegrityError`, projected as `500/internal_error` before response start.
Provider unavailability uses `503/storage_backend_unavailable`. Internal diagnostics
include object identity, locator hash, operation and classification; customer errors expose
none of those details. Reads do not delete references, rearm work or repair objects.
Workers retain their owning retry and fencing protocols.

HTTP streams derive Content-Length and range headers from persisted byte size.
GET and iteration run without a preliminary HEAD. An error after response start is
logged and terminates the stream. Signed downloads authorize an admitted locator
without observing provider existence.

`exists` remains a physical observation for staging admission and deletion/cleanup.
`object_metadata` verifies direct-upload candidates; it does not determine business
readiness. The storage port has no standalone size-observation operation.

## Semantic references

Upload, ImportArtifact, ScoreRevisionSource, ScoreRenderAsset and ScorePlaybackAsset reference `stored_object`. PerformanceTake references `recording_object` alongside its independent TakeManifest. PracticeBundle references `prepared_musicxml_object` and `artifact_object`. User references its current `avatar_object`. Their foreign keys restrict physical-row removal while any semantic reference remains.

Features own object keys, namespaces, filenames, MIME policy, deduplication and delivery authorization. Upload deduplication uses existing Upload references and the Upload-owned deterministic key namespace. A pending-retirement object at that exact key is reacquired under the retirement fence; a matching SHA in another domain grants no reuse. StoredObject implies no global deduplication. Account creates an immutable processed-JPEG key and derives a stable application avatar URL from the current reference. The avatar endpoint issues a fresh signed download capability.

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

Prewrite transactions precede semantic mutation and require a clean semantic session. Domain application code reestablishes its parent admission after prewrite commits. Domain parent locks (Score/Revision, Bundle, User or ImportJob) precede intent locks during semantic adoption. User admission and Quota/Usage serialization precede Objects locks. The shared physical lock order is ObjectWriteIntent → StoredObject → StoredObjectRetirement. Retirement itself never needs a write-intent lock. Multiple representation writes finish before their one semantic replacement transaction begins.

StorageUsage mutates and flushes accounting state inside the caller-owned transaction;
its service and repository do not commit. Upload creation commits its StorageQuotaHold
before physical IO, releases quota row locks, then uses the ObjectWriteIntent protocol's
explicit PREPARED/WRITTEN transactions. Its final transaction commits StoredObject adoption,
the Upload, durable request completion, hold consumption and logical allocation together. A fresh-session completion lookup resolves unknown COMMIT without duplicate allocation. A failed admission rolls back semantic
writes and commits release of the active hold in a clean transaction. Revision
source preparation follows the same durable hold boundary; RevisionWriter participates
in the caller's revision transaction. PerformanceTake application services own reservation,
finalization, recovery and deletion commits, with accounting in each semantic transaction.

Expired PREPARED/WRITTEN generations become CLEANUP_PENDING. Cleanup dispatch/claim/retry/lease recovery delegates to DurableDeliveryLifecycle using CLEANUP_DISPATCHED, CLEANUP_PROCESSING, CLEANUP_FAILED and CLEANED. The worker commits its claim, then locks the intent and checks generation plus attempt token. A matching StoredObject means ADOPTED with no delete. Conflicting facts fail closed. Without a StoredObject it deletes under the intent lock and commits CLEANED. A storage failure rolls back and records CLEANUP_FAILED in a fresh transaction. Missing keys and uncertain completion retries are idempotent. Stale writers/adopters cannot revive cleaned or reprepared generations.

Account Avatar, Uploads, Review confirmation/source replacement, Revision create/restore, Render pages, Playback audio and Import artifact recording consume this protocol. Review confirmation prewrites canonical MusicXML before constructing semantic rows. Import handoff carries intent UUID/generation and filename/page metadata rather than a second physical-facts dictionary. PracticeBundle CREATING has null representation FKs; READY acquires both written representations and a binding in its semantic transaction.

ObjectStorage is not part of a database transaction. Safety comes from durable operation state, row locks across physical IO, immutable keys, idempotent operations and retry. There is no distributed atomic commit.

## Entitlement and accounting

[Storage Quota](storage-quota.md) owns current plan defaults, user entitlement, capacity
admission and durable holds. [Storage Usage](storage-usage.md) owns committed logical
allocation/release and rebuildable used-byte accounting. Reserved capacity is read from
active Quota holds, not persisted in Usage projections. Physical retirement consumes
neither authority and does not determine user/category allocation multiplicity.

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

`retire_if_unreferenced` locks StoredObject and checks all semantic references before creating or rearming one operation. `retain_for_reference` locks the same row and its operation, cancels pending retirement and admits a new reference. A worker that wins the destructive lock completes before acquisition can continue; if the row is gone acquisition requires a new write generation. If a durable deletion fence remains on an existing row, acquisition fails closed until retirement finishes.

The worker commits its claim separately. It locks StoredObject then retirement, verifies
attempt count/token and snapshot facts, and checks all semantic references. Before any
physical deletion it persists `deletion_fenced_at` in a short transaction. A referenced
object can produce CANCELLED only before that fence. An object whose deletion is fenced
cannot be reacquired, including after storage failure or an uncertain completion commit.

The destructive transaction reacquires StoredObject then retirement, rechecks the current
attempt, immutable facts and references, and flushes ORM deletion before storage IO.
Every RESTRICT FK remains the final validation barrier before bytes can be deleted.
Row removal and operation completion commit after physical deletion. On failure the row
may remain, but the durable deletion fence remains authoritative; recovery retries the
same idempotent deletion rather than restoring reference authority. An absent physical
key is idempotent. An unexpectedly absent StoredObject fails closed without deleting the
snapshot key. Completed operation snapshots survive physical-row deletion through SET NULL.

Once retirement completes, reacquisition follows a fresh ObjectWriteIntent generation.
Unfinished fenced operations must finish before schema downgrade can remove their fence.
Schema installation does not create runtime operation state.

### Initialization and runtime integrity

An empty database is initialized by `alembic upgrade head` through the complete
checked-in migration chain. Initialization installs schema and finite quota policies, without users,
semantic resources or retirement operations. Development databases are disposable
and are recreated through the complete migration chain. The deletion-fence migration
adds its column and constraint without inferring runtime outcomes from historical rows.

Retirement is admitted after semantic release and verifies every registered reference.
The worker commits its irreversible fence only after that reference check succeeds,
then rechecks references under row locks before destructive IO. A fenced object with
an existing semantic reference is an integrity violation. Acquisition fails closed and
the worker records failure without deleting the object or removing its references;
there is no waiting lifecycle for this condition.

Runtime recovery retains the same durable operation, immutable snapshot and fence.
Storage failures and unknown completion commits retry idempotent physical deletion;
missing keys do not manufacture reusable authority. Exhausted retries remain failed
and fenced for operational investigation. Investigation verifies StoredObject facts,
all registered references, provider metadata and the complete byte size/SHA-256 before
any corrective action. It never clears a deletion fence or bypasses RESTRICT FKs.
ObjectWriteIntent separately retains cleanup ownership for unadopted write generations.

Retirement states are PENDING, DISPATCHED, PROCESSING, FAILED, COMPLETED and CANCELLED. Shared delivery policy owns retry, lease expiry, dispatch and reset. A fresh attempt token fences cancelled/rearmed work as well as lease takeover. Immediate dispatch is best effort; periodic maintenance is the durable recovery path.

Temporary upload staging, finalizing and orphan keys are reservation lifecycle locators, not StoredObjects. Unadopted server writes remain owned by ObjectWriteIntent until ADOPTED or CLEANED. Retirement snapshots, StorageQuotaHold identities and StorageUsageEvent keys are operation/accounting evidence, not current physical authority. Neither snapshot retains semantic ownership.

## Infrastructure and verification

`app/storage/s3_compatible.py` implements the configured S3-compatible protocol. Application modules depend on the port and composition root. No database row chooses a provider. Delivery explicitly uses signed capabilities or authorized application streaming/redirect endpoints; raw public object URLs are not part of the port.

Development uses the same application protocol as production. `docker-compose.backend-dev.yml` supplies the development object-store service. Backend filesystem durable storage and backend upload fallback do not exist. Worker materialization writes disposable files under `WORK_ROOT`. Browser OPFS and LocalMediaAsset are independent transient browser resources.

Unit/application tests use a test-only object-map adapter. `NOTEVERSE_TEST_OBJECT_STORAGE_*` selects a dedicated network integration namespace for direct upload, metadata, full/range reads, copy, signed download and deletion. Network integration is reported separately from SDK-boundary and unit tests.


`ObjectWriteIntentStatus` and `StoredObjectRetirementStatus` each own their complete
lifecycle vocabulary in their respective `app/db/models` modules. ORM status
fields are enums; non-native SQLAlchemy Enum projects each VARCHAR(24) admission
CHECK. Write/adoption, cleanup and retirement predicates and transitions consume
their domain enum members. ObjectWriteIntent keeps physical-write states alongside
its cleanup delivery states; retirement retains its distinct CANCELLED meaning.


Physical retirement references answer whether an admitted object remains referenced.
They do not determine accounting user, category or multiplicity. The separate
[Storage Usage semantic inventory](storage-usage.md#semantic-inventory) owns
those facts and reads StoredObject.byte_size without consulting the provider.

## Physical operation inventory

Paths below are relative to `backend/`. A = formal durable creation, B = exact existing
object reacquisition, C = direct-upload admission, D = temporary processing,
E = Take staging/finalization candidate, F = semantic release, G = formal retirement,
H = cleanup of unadopted or temporary bytes. Read-only delivery does not grant creation
or deletion authority. These owners include injected `ObjectStorage` calls, not only the
shared `object_storage` instance.

| Call site | Class | Physical/semantic authority |
| --- | --- | --- |
| `app/modules/storage_objects/persistence.py`: `object_to_row`, `object_from_bytes`, `object_from_row` | A | Immutable fact mapping; the byte factory is used by fixtures, not product admission |
| `app/modules/storage_objects/writes.py`: `prepare_object_write`, `prepare_write`, `perform_write`, `inspect_write`, `finalize_write`, `write_object` | A/B | Sole ordinary server put; committed PREPARED and WRITTEN generation phases |
| Same file: `adopt_written_object`, `retain_existing_object`, `receipt_for_intent` | A/B | Exact intent/generation/fact verification and retirement-fenced reference admission |
| `app/modules/uploads/service.py`: `create_upload` / `delete_upload` | A/B | Stable Upload command/capacity generation, canonical key write/adopt, UPLOAD allocation; no cross-domain SHA deduplication |
| `app/modules/revisions/service.py`: `_append`; `writer.py`: `write`, `_unused` | A/B | Canonical source prewrite, parent re-admission, source/head/consequences/adoption/accounting; unused receipt releases capacity and remains intent cleanup-owned |
| `scripts/seed_integration_user.py`: `seed_user` | A | Explicit fixture key existence check, same source write and RevisionWriter admission |
| `app/modules/import_jobs/pipeline/artifact_recorder.py`: `_build_file_item`; `execution_recorder.py`: `replace_artifacts` | A/B/D/F | Job-owned review MusicXML prewrite and generation handoff; canonical artifact adoption and TEMP_IMPORT accounting |
| `app/modules/import_jobs/review/service.py`: `confirm`, `update` | A/B/F | Canonical revision source and replacement Review artifact writes; confirmation releases temporary Import ownership |
| `app/modules/score_assets/score_revision_rendering.py`: `_render_records`, `render_for_worker` | A/F | Render writes before Score/delivery re-admission; asset adoption, replacement release and retirement |
| `app/modules/playback/service.py`: `render`, `_render_worker_asset` | A/F | Audio prewrite, parent/delivery re-admission, replacement adoption/accounting, then old-object retirement |
| `app/modules/account/avatar_service.py`: `replace_user_avatar`, `clear_user_avatar` | A/F | Normalize to JPEG, immutable per-upload key, User serialization, current reference replacement and previous-object retirement; no user quota allocation |
| `app/modules/account/router.py`: `read_avatar` | Read | Current User avatar reference admits a signed download; filename/key alone grants no authority |
| `app/modules/practice/bundle/writer.py`: `_prewrite_representations`, `_adopt_ready_bundle`, `ensure_binding` | A/B | Both representation writes precede READY/binding admission; CREATING has null representation FKs; exact read-back verification |
| `app/modules/performance_takes/upload_reservation/reservation_service.py`: `reserve_upload`, `_replay_reservation`; browser `src/lib/practice/performance-take/save-command.ts` | C/E | Reservation-owned short-lived staging PUT capability and browser upload; no StoredObject authority yet |
| `app/modules/performance_takes/final_media.py`: `verify` | E | Staging existence, metadata, full-stream hashes, unique lease-key copy and candidate verification |
| `app/modules/performance_takes/writer.py`: `adopt` | A/E | Documented independent protocol: verified unique candidate becomes StoredObject + Take + business completion + consumed hold + allocation atomically; no ordinary server put bypass |
| `app/modules/performance_takes/finalization.py`; `upload_reservation/recovery.py` | E | Lease, candidate evidence and known/unknown-COMMIT recovery; no independent physical deletion |
| `app/modules/uploads/service.py`: `delete_upload` | F | Upload removal and exact accounting release with repo-wide retirement admission |
| `app/modules/import_jobs/deletion_service.py`: `_release`; `maintenance_service.py`: `cleanup_orphan_uploads` | F | Eligible job/artifact/orphan Upload release, accounting and retirement in the owning transaction; savepoint-isolated orphan units |
| `app/modules/import_jobs/repository.py`: `delete_artifacts_by_kind` | F | Removes artifact references and returns released object identities; execution owns accounting/retirement after replacement adoption |
| `app/modules/revisions/derived_asset_retention_service.py`: `cleanup_for_score` | F | Score-scoped asset release, logical accounting and retirement in one worker-owned transaction |
| `app/modules/scores/deletion_executor.py`: `execute` | F | Score graph/source/assets/inputs release; retained Upload reclassification stays distinct from physical retirement |
| `app/modules/performance_takes/service.py`: `delete_take` | F | Recording reference/accounting release and retirement; Manifest/reservation lineage remains |
| `app/modules/practice/bundle/retention.py`: `_retire`, `retire_unowned`, `discard_creation`, `recover_stale_creating`, `collect_unowned_ready` | F/H | Binding/Bundle lifecycle selects semantic cleanup; no local physical reference-count substitute |
| `app/modules/storage_objects/retirement.py`: `retain_for_reference`, `retire_if_unreferenced`, `retire_after_release` | B/F/G | StoredObject → retirement locks; all semantic FKs checked; durable deletion fence cannot be cancelled |
| `app/worker/execution/stored_object_retirement.py`: `_execute` | G | Sole formal-object physical deletion; committed deletion fence, attempt/snapshot/reference/FK validation, idempotent storage delete and retained history |
| `app/worker/execution/object_write_cleanup.py`: `execute_object_write_cleanup_task` | H | Intent-generation cleanup only; existing matching StoredObject prevents physical deletion |
| `app/modules/performance_takes/upload_reservation/cleanup.py`: `cleanup_expired_reservations` | E/H | Reservation-owned staging/candidate grace, lease and reference evidence; never formal recording retirement |
| `app/modules/import_jobs/pipeline/*`, `app/processing/*`, `app/modules/rendering/*` | D/H | Disposable worker-local materialization/render intermediates under WORK_ROOT; filesystem cleanup is not durable ObjectStorage deletion |
| `app/storage/s3_compatible.py`; `app/storage/async_reader.py` | Adapter | Configured provider put/copy/delete/metadata/capability primitives; async scheduling carries no product ownership |
| `scripts/verify_practice_acoustic_model_asset.py`: `verify_asset` | Deployment distribution | Manifest-identified model artifact, outside customer semantic resources: private-bucket validation, explicit conditional publish, metadata/full-byte verification; no StoredObject row or product quota |

All nine semantic FKs are explicitly registered in `storage_objects/references.py`:
Upload, Take recording, ImportArtifact, Revision source, render asset, playback asset,
two Bundle representations and current User avatar. Each uses RESTRICT. Retirement's
SET NULL FK retains operation evidence and is deliberately excluded from semantic
ownership. Model-FK inventory tests require explicit review of every added reference.

Production fact assignments and SQL mutations are confined to physical creation; no
production path updates admitted key/size/SHA/type facts. Test fixtures construct physical
rows directly to represent persisted states; migrations define/backfill schema and durable
protocol evidence. Neither is an additional runtime admission path. The operational model
publisher remains separate from customer-object admission and uses its current metadata
port. No Storage Objects code imports business key builders, Usage or Quota.

Replacement transactions acquire all applicable write intents before retirement locks.
Import replacement defers retirement until all new artifact references/accounting are
admitted. Playback replacement follows the same order. This preserves the shared parent →
Intent → StoredObject → retirement direction without moving business lifecycle policy.

## Account erasure and operations

Account resource erasure releases its domain references/accounting and admits retirement
in the same transaction. It does not wait for physical deletion. Shared objects remain
while any registered semantic reference survives. Account completion does not imply
provider version or backup destruction; see the [account ownership and retained-data
contract](business-resource-lifecycle.md#account-erasure-ownership-contract).

Retirement failure facts use the common durable taxonomy and a safe bounded detail.
The stage distinguishes reference validation, fence persistence, physical deletion and
completion commit. Integrity failures stop automatic retry. The unified Ops projection
exposes retirement UUIDs, never object keys or signed capabilities. Operator retry requires
a reason and an audit event; Domain validation rejects active, completed or cancelled work
and preserves every irreversible fence. No new reference is admitted after fencing.

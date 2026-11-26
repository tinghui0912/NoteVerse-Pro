# Storage usage accounting

Storage Usage owns logical committed allocations, not physical provider costs or capacity
admission. [Resource governance](storage-resource-governance.md) defines the independent
Objects / Usage / Quota authorities. [Storage Quota](storage-quota.md) owns entitlement,
capacity admission, durable holds and the composed customer storage-usage response.

## Persisted accounting facts

| Record | Authority |
| --- | --- |
| `StorageUsageAccount` | Quota-counted aggregate committed used bytes for one User |
| `StorageUsageCounter` | Committed used bytes for one User/category |
| `StorageUsageEvent` | Immutable allocation/release/correction audit evidence |

Account and counters persist no reserved capacity or limits. The classification authority
is `storage_governance.usage.contracts.counts_toward_quota`: SOURCE, UPLOAD and INPUT_ASSET count;
DERIVED_RENDER, DERIVED_AUDIO and TEMP_IMPORT do not. Events keep
`counts_toward_quota_snapshot` for historical interpretation. Events do not establish
current resource ownership and are not replayed to reconstruct inventory.

`StorageUsageService.record_allocation()` updates the category and counted aggregate,
then appends the matching event. `record_release()` requires the entire requested
allocation before any mutation; underflow raises `StorageUsageInvariantError`. Both
participate in the caller's transaction and never commit. A counted business allocation
requires Quota admission for positive net occupancy growth; same-user reclassification
preserves already-admitted occupancy. Non-counted resources
require no capacity hold. Semantic references, allocation and any hold consumption commit
or roll back together.

`StorageUsageReader` exposes committed aggregate bytes, optional aggregate locking, and
immutable category snapshots. Quota consumes this contract without accessing business
models. Usage does not import Quota. User creation composes independent entitlement and
empty usage-account provisioning in `app/composition/storage_resources.py`.

## Semantic inventory

Each business domain owns its SQL-aggregating provider. The approved Inventory registry
validates category coverage, supports multiple contributions per category, and returns an
immutable user snapshot. Callers inject `StorageInventoryReader` into reconciliation;
Usage does not import business ORM, providers, services or the Inventory composition root.
Online account/counters remain the fast read/admission projection.

| Category | Semantic allocations | User authority | Byte source |
| --- | --- | --- | --- |
| SOURCE | Each ScoreRevisionSource | Revision → Score.owner_user_id | Source → StoredObject.byte_size |
| DERIVED_RENDER | Each ScoreRenderAsset | Revision → Score.owner_user_id | Asset → StoredObject.byte_size |
| DERIVED_AUDIO | Each ScorePlaybackAsset | Revision → Score.owner_user_id | Asset → StoredObject.byte_size |
| TEMP_IMPORT | Each ImportArtifact | ImportJob.user_id | Artifact → StoredObject.byte_size |
| INPUT_ASSET | Each ScoreInputAsset | Score.owner_user_id | Upload → StoredObject.byte_size |
| UPLOAD | Each Upload without any ScoreInputAsset reference | Upload.uploader_user_id | Upload → StoredObject.byte_size |
| UPLOAD | Each final PerformanceTake recording | PerformanceTakeManifest.user_id | recording_object.byte_size |

PracticeBundle representations and User avatars are intentionally unaccounted.
Physical deduplication does not deduplicate accounting: two InputAsset rows sharing
an Upload count twice. First promotion releases the one UPLOAD allocation and adds
one INPUT_ASSET allocation. Subsequent promotions add only INPUT_ASSET. Removing
the last InputAsset restores one UPLOAD allocation when the Upload survives via
an ImportJob reference. `scores/input_asset_lifecycle.py` owns both directions under
sorted Upload locks; neither net-zero conversion needs a new hold, including over quota.
An orphan Upload deleted with the final input has no
intermediate UPLOAD allocation.

Soft deletion keeps semantic allocations until the deletion transaction removes
those rows. Staging recording objects do not contribute used bytes; active
reservation holds and final recording ownership express reserved and used facts.
Object-store provider state is not consulted by reconciliation. Physical reference
checks and object-key namespaces do not determine accounting ownership.

## Reconciliation and transactions

`inspect_user()` compares semantic used bytes with account/category projections without
flushing pending caller writes. `reconcile_user()` locks the existing aggregate before
inventory reads and counter mutation. The caller owns commit/rollback. Missing accounting
provisioning fails closed; reconciliation neither requires nor provisions entitlement.
It never queries or repairs capacity holds.

Each category used correction emits `reason="reconciliation"`, an exact delta and current
classification snapshot without an object locator. Existing events remain unchanged.
Missing counters can be created, and repeated repair emits no further corrections.

```sh
python scripts/reconcile_storage_usage.py inspect 123
python scripts/reconcile_storage_usage.py repair 123
```

Output contains user/category actual/expected used totals and drift, without filenames,
keys or credentials. Repair commits one user's explicit maintenance transaction.

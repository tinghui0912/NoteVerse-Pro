# Storage entitlement and usage

Storage entitlement and accounting have separate persisted authorities:

| Record | Current fact |
| --- | --- |
| `StoragePlanPolicy` | A plan's default limit, identified by `plan_code` |
| `UserStorageEntitlement` | One user's current plan and optional limit override, identified by `user_id` |
| `StorageUsageAccount` | Online projection of quota-counted aggregate used and reserved bytes |
| `StorageUsageCounter` | Online projection of used and reserved bytes for one user/category |
| `StorageUsageReservation` | Active `RESERVED` rows are the durable capacity-hold authority |
| `StorageUsageEvent` | Immutable accounting/audit evidence |

Plan defaults and non-null user overrides are nonnegative. Entitlements reference
an existing plan; entitlement and account identities reference their User with
delete cascade. The baseline seeds `FREE` with `104857600` bytes (100 MiB).

## Effective entitlement

```text
effective quota = current UserStorageEntitlement.limit_override_bytes
                  ?? current StoragePlanPolicy.default_limit_bytes

available bytes = max(effective quota - account.used_bytes
                      - account.reserved_bytes, 0)
```

The effective limit is derived on every usage read and reservation acquisition.
It is never snapshotted into the usage account. A plan-default change immediately
affects existing users without an override. An override, including zero, takes
precedence; clearing it immediately restores the current plan default.

Lowering a limit below existing used/reserved bytes is valid. Reads show zero
available bytes, existing allocations and holds remain intact, and new
quota-counting reservations fail with `storage_quota_exceeded`. Error diagnostics
use the effective limit resolved for that admission.

## Provisioning and reads

`storage_usage.entitlements.provision_default_storage_state()` admits a default
entitlement and empty usage account without committing. Email verification flushes
the new User identity, provisions storage, consumes the pending registration and
commits them together. The integration seed explicitly provisions its new User in
the same transaction. A provisioning failure cannot partially commit user storage
or consume the pending registration.

`GET /me/storage-usage` only reads entitlement, policy, account and category
counters. It does not provision, repair or update timestamps. Missing entitlement,
policy or account fails closed with `quota_check_unavailable` (503).

## Reservation and accounting transactions

Reservation acquisition locks the user's entitlement, resolves the plan with an
ordinary read, then locks the usage account and category counter. A shared plan
row is never locked for update, so different users do not serialize on `FREE`.
Refreshing locked records preserves per-user quota serialization across concurrent
sessions. The check uses account aggregate totals, not a category-counter SUM.

Quota admission occurs only on reserve. Commit converts the admitted reserved
bytes to used bytes without rechecking the limit; release removes the hold.
Allocation composes reserve and commit. Semantic release decrements used bytes
and appends an accounting event. All participate in the caller's transaction.

`SOURCE`, `UPLOAD` and `INPUT_ASSET` count toward quota. `DERIVED_RENDER`,
`DERIVED_AUDIO` and `TEMP_IMPORT` remain category accounting without consuming
quota. Reservation and event `counts_toward_quota_snapshot` values are durable accounting
facts. Account totals equal the aggregate of quota-counted category counters.
Feature callers supply semantic allocations/releases, never plan or override data.

Physical bytes and semantic object ownership follow the independent
[object-storage protocol](object-storage.md).


## Reconciliation source

`StorageUsageEvent` is audit evidence, not current-state reconstruction authority.
StoredObject facts provide byte size; semantic owner rows provide user, category
and allocation multiplicity. Online account/counters remain the fast GET/admission
projection, and maintenance can rebuild them independently of event completeness.

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
an ImportJob reference; an orphan Upload deleted with the final input has no
intermediate UPLOAD allocation.

Soft deletion keeps semantic allocations until the deletion transaction removes
those rows. Staging recording objects do not contribute used bytes; active
reservation holds and final recording ownership express reserved and used facts.
Object-store provider state is not consulted by reconciliation. Physical reference
checks and object-key namespaces do not determine accounting ownership.

## Maintenance and exact accounting

`storage_usage.reconciliation.StorageUsageReconciliation.inspect_user()` reads
expected/actual category totals and account aggregates without writing or committing.
`reconcile_user()` locks the existing StorageUsageAccount before reading committed
inventory or changing counters. It reads reservations without locking them and
locks/creates category counters after the account, preserving accounting lock
order. The caller owns commit/rollback. Missing account, entitlement or plan fails
closed; reconciliation does not provision users or alter entitlements.

Counter used bytes come from semantic inventory; account used bytes sum categories
under live `counts_toward_quota(category)` policy. Counter reserved bytes sum all
`RESERVED` reservations for the category. Account reserved bytes sum only active
reservations whose `counts_toward_quota_snapshot` is true. COMMITTED and RELEASED
reservations are not holds. Public breakdown `counts_toward_quota` remains live
policy, distinct from durable reservation/event snapshots.

Every nonzero category used correction appends a `reason="reconciliation"` event
with `delta_bytes = expected - actual`, the current policy snapshot and no object
locator. Reserved corrections emit no fake used event. Existing events are never
changed. Missing counters can be created, and repeated repair makes no further
corrections. No reconciliation tables, scheduler or public API are required.

Ordinary release requires the full requested allocation in the counter and, for
quota-counting categories, the account. An underflow raises
`StorageUsageInvariantError` before any projection/event mutation. Successful
release N subtracts exactly N and records exactly -N. Semantic ownership and
accounting continue to commit atomically in normal domain transactions.

Run the maintenance command in the supported backend environment:

```sh
python scripts/reconcile_storage_usage.py inspect 123
python scripts/reconcile_storage_usage.py repair 123
```

Output contains user/category actual/expected totals and drift, with no storage
keys, filenames or credentials. Repair commits one user's maintenance transaction;
inspection performs no writes. A newly introduced category must declare its
semantic inventory ownership explicitly.

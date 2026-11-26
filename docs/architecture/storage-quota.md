# Storage quota and durable capacity holds

Storage Quota owns User storage entitlement, capacity admission and durable capacity
holds. It consumes the [Usage reader contract](storage-usage.md), not business ORM or
services. Usage and Inventory do not import Quota. Application composition wires the
independent authorities; business commands compose Quota and Usage explicitly.

## Entitlement

`storage_quota.py` owns `StoragePlanPolicy`, `UserStorageEntitlement` and
`StorageQuotaHold`. User is the only quota subject. The policy table is the sole
capacity configuration: FREE = 104857600 bytes, PLUS = 5368709120 bytes and
PRO = 21474836480 bytes at initialization. Every plan has a nonnegative finite
integer capacity; there are no per-user arbitrary capacity overrides.

An entitlement selects one supported plan. `StorageQuotaEntitlements.change_plan()`
is the trusted application boundary for entitlement changes, not a customer
self-upgrade or payment capability. It serializes on the user's entitlement.
Policy edits apply to existing users on the next resolution, without copying limits
into Usage. Missing policy, entitlement or usage account fails closed.

Upgrade/downgrade affects new admission immediately after commit. Downgrade never
deletes resources or revokes valid existing holds. Occupancy above the new limit
rejects positive growth while preserving reads, downloads and net-reducing deletion.

## Admission and holds

```text
active held capacity = SUM(bytes_held WHERE status=HELD AND expires_at > now)
Admission succeeds iff committed used + active held + requested <= limit
```

Holds have positive bytes, stable UUID and `(user_id, command_key)` uniqueness. Only
SOURCE, UPLOAD and INPUT_ASSET may acquire holds. Repeating an identical command returns
its existing hold; conflicting facts fail. Terminal command identities never reactivate.
Performance recordings use UPLOAD. Derived assets and temporary Import artifacts use
direct logical accounting with no holds.

HELD transitions to CONSUMED, RELEASED or EXPIRED. Guarded updates and per-user locks
serialize transitions; timestamps and CHECKs preserve terminal facts. An expired HELD
record is excluded from capacity immediately and cannot be consumed before expiry cleanup.
Repeated consumption is a no-op; cleanup release does not rewrite a consumed/expired hold.
Lowering finite quota below occupancy preserves existing allocations and unexpired holds;
it prevents additional admission, without revoking existing admitted capacity.

The lock order within capacity operations is:

```text
UserStorageEntitlement -> StorageUsageAccount -> StorageQuotaHold -> category counter
```

Policy lookup never locks the shared plan row. Distinct users do not serialize on FREE.
Business parent serialization precedes these capacity locks when both participate: a
Revision writer locks Score first, and Take adoption locks its optional linked Score
before user capacity and the business reservation. Business reservation discovery does
not replace capacity admission.

Consumption and the corresponding semantic resource/allocation belong to the same
caller-owned transaction. Quota does not commit, roll back, write physical objects or
delete them. Upload and Revision server writes persist a 15-minute hold before their
existing ObjectWriteIntent phases. Their final adoption consumes the hold and records
used bytes atomically; failure releases the hold and retains physical cleanup ownership.
The Score input lifecycle owns same-user UPLOAD/INPUT_ASSET reclassification in one
transaction. First promotion/last-reference return preserves admitted occupancy and
needs no new hold. Additional semantic inputs require fresh positive admission.

Take upload reservations have their own business state machine, leases, staging and
candidate cleanup. `quota_hold_id` is a unique RESTRICT FK to durable capacity lineage;
it does not replace that state machine. Initial hold expiry matches business admission
expiry. Completion consumes the hold and records UPLOAD allocation. Cancellation/expiry
release capacity. Unknown-COMMIT recovery verifies persisted business and consumed-hold
lineage; it does not consume or account again.

`StorageQuotaExpiry.expire_due()` selects a bounded deterministic batch and locks users
then holds with SKIP LOCKED. Worker execution owns one batch transaction, scheduled every
minute. Expiry touches only holds, never business reservation states or object storage.

## Customer projection

`GET /me/storage-usage` is composed outside Usage, through the Quota router and
application composition. Used bytes come from Usage; reserved bytes and per-category
reserved bytes come from active holds. Finite available bytes are clamped at zero.
Both limit and available bytes are finite integers. Zero quota displays no capacity;
over-limit occupancy displays bounded 100% utilization. The composed HTTP read holds a
short user capacity fence across used/held/category queries, so it cannot straddle a
consumption/allocation commit. It does not lock shared plan policy, provision or commit.

## Schema execution and recovery

The migration chain validates persisted capacity lineage before changing authorities.
`0004_finite_storage_plans` rejects unlimited policies, unsupported plan identities and
individual overrides before altering schema. It preserves FREE's configured limit,
entitlement selection, used projections, holds and audit evidence, then seeds PLUS/PRO.
Downgrade rejects non-FREE entitlements rather than discarding their plan selection.
Fresh upgrade/downgrade/re-upgrade and populated-data rejection are PostgreSQL tests.

Hold expiry and business cleanup remain distinct. Account erasure releases leftover
HELD capacity only after resource cleanup and retains Take reservation lineage until
its staging/candidate cleanup acknowledges completion. See
[business lifecycle integration](business-resource-lifecycle.md).


## Transfer admission

UploadSession admission applies independent temporary transport budgets in media_storage.
Business admission still requires a durable Hold for Score Import and Take recordings.
Transport completion does not consume a Hold; business finalization commits consumption,
Usage allocation and the resource together. Cancelling an unconsumed domain request
releases its Hold and leaves physical cleanup with its Session. Multipart limits and
per-user session counts do not create another entitlement authority.

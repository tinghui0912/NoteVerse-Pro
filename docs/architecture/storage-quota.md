# Storage quota and durable capacity holds

Storage Quota owns User storage entitlement, capacity admission and durable capacity
holds. It consumes the [Usage reader contract](storage-usage.md), not business ORM or
services. Usage and Inventory do not import Quota. Application composition wires the
independent authorities; business commands compose Quota and Usage explicitly.

## Entitlement

`storage_quota.py` owns `StoragePlanPolicy`, `UserStorageEntitlement` and
`StorageQuotaHold`. HARD_LIMIT requires a nonnegative finite limit; UNLIMITED requires
NULL. The default FREE policy is HARD_LIMIT with 104857600 bytes. It is storage policy,
not billing, payment, subscription or a commercial feature entitlement.

An entitlement with NULL mode/limit override inherits its plan. HARD_LIMIT override
requires a finite `limit_override_bytes`, including zero. UNLIMITED override has a NULL
limit. Database CHECKs enforce these shapes. Limits are resolved from current policy on
reads and admission, never copied into usage projections. Missing policy, entitlement or
usage account fails closed with `quota_check_unavailable`.

## Admission and holds

```text
active held capacity = SUM(bytes_held WHERE status=HELD AND expires_at > now)
HARD_LIMIT admits iff committed used + active held + requested <= limit
UNLIMITED admits without a finite-capacity rejection
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
it prevents additional admission, without revoking previously admitted capacity.

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
Input promotion/return admission and accounting reclassification share one transaction.

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
Unlimited returns NULL `limit_bytes` and `available_bytes`. The UI displays unlimited
capacity without fabricating a utilization percentage. The composed HTTP read holds a
short user capacity fence across used/held/category queries, so it cannot straddle a
consumption/allocation commit. It does not lock shared plan policy, provision or commit.

## Schema execution

Alembic revision `0002_storage_quota` validates persisted Take reservation owner/category/
size/status lineage before backfilling holds and the FK. Expired admitted reservations
never become consumable HELD rows. Ambiguous lineage or unbound active capacity records
stop the upgrade; operators must resolve or drain active protocols rather than invent
expiry/ownership facts. Accounting events and the FREE limit remain intact.

Finite downgrade preserves business lineage and audit events. Unlimited entitlements
cannot be represented by the finite schema and cause an explicit downgrade rejection.
Fresh upgrade, downgrade and re-upgrade are checked against ORM metadata.

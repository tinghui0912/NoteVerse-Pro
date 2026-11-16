# Storage entitlement and usage

Storage entitlement and accounting have separate persisted authorities:

| Record | Current fact |
| --- | --- |
| `StoragePlanPolicy` | A plan's default limit, identified by `plan_code` |
| `UserStorageEntitlement` | One user's current plan and optional limit override, identified by `user_id` |
| `StorageUsageAccount` | The user's quota-counted aggregate used and reserved bytes |
| `StorageUsageCounter` | Used and reserved bytes for one user/category |
| `StorageUsageReservation` | An admitted durable capacity hold |
| `StorageUsageEvent` | Accounting history |

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
quota. Reservation and event `counts_toward_quota` values are durable accounting
facts. Account totals equal the aggregate of quota-counted category counters.
Feature callers supply semantic allocations/releases, never plan or override data.

Physical bytes and semantic object ownership follow the independent
[object-storage protocol](object-storage.md).

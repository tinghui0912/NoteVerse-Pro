# Storage schema execution and recovery

## Initialization and constraints

Alembic is the schema authority. Initialize an empty project database with
`alembic upgrade head`; `alembic check` and the PostgreSQL schema suite compare
the resulting columns, checks, FKs, indexes and enums with application metadata.
The same suite exercises downgrade and re-upgrade. Runtime does not use create_all.

Finite plan migration validates policy/entitlement shapes before schema changes.
Unsupported capacity or individual overrides require an explicit entitlement decision;
the migration never invents a finite mapping. FREE retains its existing policy limit.
PLUS and PRO are seeded in the policy table. Non-FREE selection blocks a downgrade
that cannot preserve its meaning.

Account resource commands persist User tombstones, durable erasure operations and
Upload command generations. Import submission fingerprints preserve original ordered
input identity and canonical options independently of later artifact cleanup. A keyed
submission without original input lineage fails upgrade before schema changes.
Downgrade cannot discard persisted deletion/Upload command evidence or restore FKs to
already-erased actor identities.

## Transaction and recovery owners

| Operation | Commit owner | Persisted recovery authority |
| --- | --- | --- |
| Pure DB customer mutation | HTTP command dependency | Atomic command transaction |
| Upload/Revision/Avatar write | Explicit external-IO coordinator phases | Hold/business command identity and ObjectWriteIntent generation |
| Take finalization | Take protocol phase coordinator | Manifest, reservation lease, quota_hold_id and candidate lineage |
| Semantic graph deletion | Worker execution | Score/Account deletion attempt lease and durable operation |
| Maintenance | Worker execution batch or semantic lock unit | Domain retention and delivery facts |
| Physical retirement | Retirement execution | Irreversible fence, snapshot and retry lineage |

Unknown COMMIT is resolved by fresh persisted facts, never by assuming failure from a
lost acknowledgement. Upload completion admits exactly one semantic Upload/allocation
per request identity. A failed generation retains its hold/write cleanup owner; retry
uses a new capacity generation only after the previous one is terminal. Deleted
completed Upload identities do not recreate resources on replay.

Account cleanup commits bounded domain units. A failure rolls back its current unit;
prior successful units survive. Take staging and candidates retain their signed-capability
and unknown-outcome grace; account identity removal waits for cleanup acknowledgement.
Failed/exhausted operations remain visible and require repair of the actual invariant,
followed by an explicit retry decision. No accounting clamp or object-store scan repairs
semantic ownership.

## Physical and logical repair

[Usage reconciliation](storage-usage.md) compares domain-owned SQL inventory with online
projections under the User usage lock. Repair never provisions missing entitlement or
changes holds. [Objects recovery](object-storage.md) owns write cleanup, physical integrity
checks and retirement retries. A fenced object with a live semantic reference is an
integrity violation and fails closed. Logical repair cannot authorize physical deletion.

The PostgreSQL suites verify populated-data migration refusal, schema parity, atomic
resource/accounting rollback, concurrent request replay, hold transition races,
reference/retirement locks and unknown-COMMIT outcomes. Dedicated object-store integration
requires its own isolated infrastructure; in-memory storage does not replace PostgreSQL
transaction or locking tests.


Final Account erasure acquires capacity/Usage locks with SKIP LOCKED after its
exclusive User fence. A busy accounting transaction yields a durable retry checkpoint;
missing entitlement/Usage still fails closed. It never waits on an audit writer that
needs the User FK parent, avoiding a parent/account lock cycle. Take cleanup holds a
non-active User KEY SHARE only during DB phases and releases it before temporary IO.

Account/retirement failure schema upgrades preserve operation UUIDs, phases, attempts,
leases and deletion fences. Existing untyped failures become non-automatic review-required
facts with a safe diagnostic, rather than inferred retries. Downgrade refuses to discard
structured failure evidence until operators resolve those operations. No task rows are dropped.

Downgrade also refuses when Ops audit records use the account-erasure or retirement
operation kinds: the prior operator contract cannot represent those records. Schema
rollback never deletes the audit trail to bypass that guard. Schema changes require
quiesced application/worker writers under the deployment migration procedure.

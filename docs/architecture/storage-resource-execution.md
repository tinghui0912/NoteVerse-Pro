# Storage schema execution and recovery

## Initialization and constraints

Alembic is the schema authority. Initialize an empty project database with
`alembic upgrade head`; `alembic check` and the PostgreSQL schema suite compare
the resulting columns, checks, FKs, indexes and enums with application metadata.
The same suite exercises downgrade and re-upgrade. Runtime does not use create_all.

`0001_initial_schema.py` creates the entire current schema, constraints, native
enums and finite FREE/PLUS/PRO policy rows. It installs no User or business history.
Downgrade drops this development schema; it is a destructive teardown, not a live
data retention operation. Initialization and schema parity use dedicated empty databases.

## Transaction and recovery owners

| Operation | Commit owner | Persisted recovery authority |
| --- | --- | --- |
| Pure DB customer mutation | HTTP command dependency | Atomic command transaction |
| Upload/Revision/Avatar write | Explicit external-IO coordinator phases | Hold/business command identity and ObjectWriteIntent generation |
| Take finalization | Take protocol phase coordinator | Manifest, reservation lease, quota_hold_id and UploadSession identity |
| Semantic graph deletion | Worker execution | Score/Account deletion attempt lease and durable operation |
| Maintenance | Worker execution batch or semantic lock unit | Domain retention and delivery facts |
| Physical retirement | Retirement execution | Irreversible fence, snapshot and retry lineage |

Unknown COMMIT is resolved by fresh persisted facts, never by assuming failure from a
lost acknowledgement. Upload completion admits exactly one semantic Upload/allocation
per request identity. A failed generation retains its hold/write cleanup owner; retry
uses a new capacity generation only after the existing one is terminal. Deleted
completed Upload identities do not recreate resources on replay.

Account cleanup commits bounded domain units. A failure rolls back its current unit;
prior successful units survive. UploadSession retains signed-capability and unknown-outcome responsibility; account identity removal waits for cleanup acknowledgement.
Failed/exhausted operations remain visible and require repair of the actual invariant,
followed by an explicit retry decision. No accounting clamp or object-store scan repairs
semantic ownership.

## Physical and logical repair

[Usage reconciliation](storage-usage.md) compares domain-owned SQL inventory with online
projections under the User usage lock. Repair never provisions missing entitlement or
changes holds. [Objects recovery](object-storage.md) owns write cleanup, physical integrity
checks and retirement retries. A fenced object with a live semantic reference is an
integrity violation and fails closed. Logical repair cannot authorize physical deletion.

The PostgreSQL suites verify fresh schema parity, atomic
resource/accounting rollback, concurrent request replay, hold transition races,
reference/retirement locks and unknown-COMMIT outcomes. Dedicated object-store integration
requires its own isolated infrastructure; in-memory storage does not replace PostgreSQL
transaction or locking tests.


Final Account erasure acquires capacity/Usage locks with SKIP LOCKED after its
exclusive User fence. A busy accounting transaction yields a durable retry checkpoint;
missing entitlement/Usage still fails closed. It never waits on an audit writer that
needs the User FK parent, avoiding a parent/account lock cycle. Take cleanup holds a
non-active User KEY SHARE only during DB phases and releases it before temporary IO.

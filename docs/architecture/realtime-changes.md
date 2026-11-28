# Realtime change delivery

`RealtimeChange` is short-retention cache-change delivery. It is not business history,
an audit log, an integration event or a source of truth. Authoritative application
state and its change rows commit together. `publish_change` and `publish_score_change`
add/flush rows and issue transactional PostgreSQL NOTIFY without commit, rollback or
exception swallowing. The channel `realtime_changes` carries recipient routing only;
database rows supply bounded replay.

Kinds and required identities are explicit:

| Kind | Identity |
| --- | --- |
| `notifications.changed` | Optional notification ID; absent for collection changes |
| `score.revisions.changed` | Score and revision IDs |
| `score.derived_assets.changed` | Score and revision IDs |
| `score.metadata.changed` | Score and revision IDs |
| `import_jobs.changed` | ImportJob ID |

Database checks enforce each identity combination. There is no generic payload or
public worker status. Notification admission and actual read/read-all transitions
emit notification changes. Revision, Import, metadata and accepted Render/Playback
outcomes emit their corresponding data-domain changes in the same semantic transaction.

## Stream and cursors

The API lifespan owns one `RealtimeWakeupHub` and one asynchronous psycopg LISTEN
connection per API process. The hub routes recipient-only wake hints to every local
subscriber for that recipient through coalescing signals. It reconnects after listener
failures and closes its task and connection on shutdown. Worker and scheduler runtimes
do not start a hub. Each `GET /api/v1/realtime/events` subscribes locally; it does not
open a PostgreSQL listener. Periodic database catch-up continues without notifications,
so listener outages affect latency rather than delivery correctness. Authentication
releases its Session before streaming. Each replay page opens
its own short synchronous Session off the event loop and returns detached typed data.
Each authenticated recipient owns one logical change stream. Sequence is monotonically
increasing within that authenticated recipient stream. `RealtimeChange.id` is an internal
row identity; only the recipient-local sequence enters SSE. Delivery uses `event: change`,
`id: <sequence>` and camelCase JSON:

```json
{"schemaVersion":1,"sequence":42,"changeId":"change-uuid","kind":"score.metadata.changed","scoreId":"score-uuid","revisionId":"revision-uuid","createdAt":"2026-11-15T00:00:00Z"}
```

A connection subscribes to local wakeups before its initial database baseline/replay.
A fresh connection has no Last-Event-ID header. It reads the current recipient high
watermark, adopts that baseline and emits no retained history. An explicit
Last-Event-ID of zero is a replay request and is valid only while the replay floor is zero.
A recipient without stream activity has high/floor zero and needs no state row for SSE.
A valid reconnect reads only current-recipient changes after the cursor, in ascending
sequence order and bounded pages. After initial replay or resynchronization, every
established stream emits an id-bearing checkpoint and then continues live catch-up:

```text
id: 0
event: checkpoint
data: {"schemaVersion":1,"sequence":0}
```

The checkpoint records synchronization through that recipient-local sequence, including
zero for an empty stream. It is a control event and causes no cache invalidation. A
fresh stream disconnected before its first change reconnects using the checkpoint ID.
Live catch-up observes and clears a wake signal before reading the database, preserving
a signal arriving during replay for the next read. Signals carry no change bodies;
durable replay is the delivery authority.

`RealtimeStreamState` is keyed by recipient User ID and stores that recipient's
`high_watermark_sequence`, `replay_floor_sequence` and update timestamp. The floor is
the greatest deleted sequence whose preceding history is no longer guaranteed replayable.
High/floor remain durable when retention empties the recipient's change rows. State enforces
`0 <= floor <= high`. There is no global stream lock, watermark or public sequence domain.

Publication atomically ensures the recipient state with INSERT ON CONFLICT DO NOTHING,
locks only that row for update, assigns `high + 1`, updates high and inserts the change.
The state update, change and pg_notify share the owning transaction: rollback also undoes
sequence allocation. Only same-recipient publication serializes through commit; different
recipients progress independently. Score fan-out acquires recipient locks in ascending,
unique recipient order, including when notification and Score changes revisit the same row.

Replay validation and a bounded page fetch hold a shared lock only on that recipient's
state. Replay never creates a state row and never derives high from retained change rows.
Retention selects at most 100 recipients with expired changes in deterministic order.
Each recipient gets a separate short transaction: lock its state for update, advance its
floor to the greatest expired sequence being deleted, delete its expired rows and commit.
No expired rows means no floor advance. A later recipient failure does not undo an earlier
recipient's completed cleanup. One recipient's floor never makes another recipient stale.
Locks never span an SSE connection. If retention passes a cursor between pages, the next
page requests resync instead of silently omitting a gap. Another recipient's replay or
retention lock does not prevent publication to an independent stream.

## Resynchronization

A cursor below the floor produces `retention_gap`; one above the recipient high watermark produces
`cursor_out_of_range`. Malformed, negative or oversized cursors produce `invalid_cursor`.
The server emits one control message and moves its cursor to the current recipient high watermark:

```text
id: 42
event: resync-required
data: {"schemaVersion":1,"sequence":42,"reason":"retention_gap"}
```

The same connection continues live delivery. Native EventSource owns Last-Event-ID across
reconnects; no second browser cursor is persisted. Customer Web validates `checkpoint`, `change`
and `resync-required` through generated decoders. Known changes invalidate their data-domain queries. Resync controls
and malformed/unknown changes trigger broad query invalidation so active queries converge.
Import changes invalidate the Import collection, matching Import detail and matching Review
projection; notification changes separately invalidate
notification list/count. Pending-invite invalidation belongs to local accept/decline
mutations; notification changes do not represent collaboration changes. Score changes invalidate the relevant
Score, revision/assets and library queries.

## Machine contract

SSE admission authenticates the Consumer opaque session cookie. Each replay or
catchup batch revalidates the session and active User in PostgreSQL; revocation
ends delivery. Database sessions close before stream waits. See
[Consumer Sessions](consumer-sessions.md).

`contracts/realtime/events.schema.json` owns the Draft 2020-12 exact JSON payloads
for checkpoints, resync controls and the five change kinds. The offline generator
`scripts/generate_realtime_contract.py` projects typed Python payloads into
`backend/app/modules/realtime/generated/transport.py`, the shared change-kind
vocabulary into `backend/app/shared/realtime.py`, and TypeScript types and strict decoders into
`apps/customer-web/src/lib/realtime/generated/events.ts`. These projections are checked
for freshness by backend and Customer Web quality gates. SSE formatters accept these
typed payloads and use the payload sequence as the event ID. RealtimeProvider owns only
transport and lifecycle. Customer cache-effects own semantic convergence; local mutation
success and realtime delivery use the same semantic effects when they represent the
same product fact. Valid checkpoints have no cache effect.

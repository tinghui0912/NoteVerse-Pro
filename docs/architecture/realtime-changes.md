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

`GET /api/v1/realtime/events` uses asynchronous psycopg LISTEN, heartbeat and connection
cleanup. Authentication releases its Session before streaming. Each replay page opens
its own short synchronous Session off the event loop and returns detached typed data.
SSE delivery uses `event: change`, `id: <sequence>` and camelCase JSON:

```json
{"schemaVersion":1,"sequence":42,"changeId":"change-uuid","kind":"score.metadata.changed","scoreId":"score-uuid","revisionId":"revision-uuid","createdAt":"2026-11-15T00:00:00Z"}
```

A fresh connection has no Last-Event-ID header. It installs LISTEN before reading the
current high watermark, adopts that baseline and emits no retained history. An explicit
Last-Event-ID of zero is a replay request and is valid only while the replay floor is zero.
A valid reconnect reads only current-recipient changes after the cursor, in ascending
sequence order and bounded pages, then continues live catch-up.

`RealtimeStreamState` holds one durable replay floor: the greatest deleted sequence
whose preceding history is no longer guaranteed replayable. The high watermark is
`max(replay_floor_sequence, max(realtime_changes.sequence))`, including when no rows remain.
Change admission takes the stream-state update lock through the caller's commit, keeping
sequence admission ordered with visibility. Replay validation and each page fetch share
a read lock. Retention takes the update lock, advances the floor to the greatest expired
sequence it deletes, deletes rows and commits once. No expired rows means no floor advance.
Locks never span an SSE connection. If retention passes a cursor between pages, the next
page requests resync instead of silently omitting a gap.

## Resynchronization

A cursor below the floor produces `retention_gap`; one above the high watermark produces
`cursor_out_of_range`. Malformed, negative or oversized cursors produce `invalid_cursor`.
The server emits one control message and moves its cursor to the current high watermark:

```text
id: 42
event: resync-required
data: {"schemaVersion":1,"sequence":42,"reason":"retention_gap"}
```

The same connection continues live delivery. Native EventSource owns Last-Event-ID across
reconnects; no second browser cursor is persisted. Customer Web listens only to `change`
and `resync-required`. Known changes invalidate their data-domain queries. Resync controls
and malformed/unknown changes trigger broad query invalidation so active queries converge.
Import changes invalidate Import lists; notification changes separately invalidate
notification list/count and pending-invite queries. Score changes invalidate the relevant
Score, revision/assets and library queries.

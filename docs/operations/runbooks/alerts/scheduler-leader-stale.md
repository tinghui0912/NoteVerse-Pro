# NoteVerseSchedulerLeaderStale

This alert means no active Beat leader has recently refreshed its dedicated
leader heartbeat. It is distinct from a stale scheduler scan: the leader may
be unavailable before any individual outbox scanner reports stale work.

## First Checks

1. Inspect both `backend-beat` Pods and confirm one is active while the other
   is standby when high availability is enabled.
2. Inspect `scheduler.leader_acquired`, `scheduler.leader_standby`, and
   `scheduler.leader_connection_lost` events.
3. Verify `SCHEDULER_LOCK_DATABASE_URL` targets direct PostgreSQL or a
   PgBouncer **session-pooling** endpoint. Transaction pooling cannot hold a
   session advisory lock.
4. Query PostgreSQL `pg_locks` to confirm that at most one session holds the
   `beat_leader` advisory lock.
5. Check PostgreSQL availability and network connectivity from the Beat Pod.

## Resolution

- Restore PostgreSQL connectivity before restarting Beat.
- If the active child exited, inspect its log before restarting the Deployment.
- During a controlled rollout, keep the lock-aware image at one replica first;
  only then enable the two-replica high-availability overlay.
- Do not treat a standby observation as a failure. One active leader and one
  standby are the intended steady state.

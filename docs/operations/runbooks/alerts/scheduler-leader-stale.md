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
4. Query PostgreSQL `pg_locks` with `pg_stat_activity` to confirm that at most
   one `application_name = 'noteverse-beat-leader'` session holds an advisory
   lock:

   ```sql
   select activity.pid, activity.application_name, activity.state, lock.granted
   from pg_locks as lock
   join pg_stat_activity as activity using (pid)
   where lock.locktype = 'advisory'
     and activity.application_name = 'noteverse-beat-leader';
   ```
5. Check PostgreSQL availability and network connectivity from the Beat Pod.

## Resolution

- Restore PostgreSQL connectivity before restarting Beat.
- If the active child exited, inspect its log before restarting the Deployment.
- During a controlled rollout, keep the lock-aware image at one replica first;
  only then enable the two-replica high-availability overlay.
- Do not treat a standby observation as a failure. One active leader and one
  standby are the intended steady state.

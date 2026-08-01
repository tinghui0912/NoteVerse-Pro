# Scheduler Observability Plan

NoteVerse currently uses Celery Beat as a single scheduler process. Beat does
not own business state. PostgreSQL import jobs and outbox tables are the source
of truth for dispatch state, retry state, timeout recovery, and terminal
outcomes.

This plan keeps that architecture and improves production visibility before
adding scheduler high availability.

## Priority Order

### P0: Scheduler Metrics

Status: implemented.

Add database-backed scheduler heartbeat metrics so Prometheus can observe Beat
through the existing API `/metrics` endpoint.

Required metrics:

- `noteverse_scheduler_last_success_timestamp_seconds`
- `noteverse_scheduler_last_failure_timestamp_seconds`
- `noteverse_scheduler_last_scan_duration_seconds`
- `noteverse_scheduler_scan_duration_seconds_sum`
- `noteverse_scheduler_scan_duration_seconds_count`
- `noteverse_scheduler_last_due_records`
- `noteverse_scheduler_last_dispatched_records`
- `noteverse_scheduler_successes_total`
- `noteverse_scheduler_failures_total`
- `noteverse_scheduler_due_records_total`
- `noteverse_scheduler_dispatched_records_total`
- `noteverse_scheduler_lag_seconds`

The metrics must use low-cardinality labels only:

```text
job
kind
```

Do not use pod name, task id, job id, outbox id, score id, revision id, user id,
email, object key, or request id as Prometheus labels.

### P1: Dashboard And Alerts

Status: implemented.

Extend `NoteVerse Application Overview` with scheduler health panels:

- last successful scheduler scan by job;
- scheduler lag by async operation kind;
- last scan duration;
- last due and dispatched counts;
- scheduler failures.

Add PrometheusRule alerts:

- scheduler job has no recent successful scan;
- scheduler lag exceeds the async operation SLO;
- scheduler failures increase continuously.

### P2: Loki And Tempo Platform Dashboards

Status: implemented as the first platform dashboard. Alert rules for the
observability stack itself are intentionally deferred until the dashboard has
been validated with staging traffic and each alert has an actionable runbook.

Add separate platform dashboards after application scheduler health is visible.

Loki panels:

- ingestion rate;
- ingestion errors;
- dropped logs;
- query latency;
- object storage errors;
- PVC usage for local single-binary state.

Tempo panels:

- received spans;
- stored spans;
- failed or dropped spans;
- OpenTelemetry Collector exporter failures;
- query latency;
- object storage errors.

These dashboards are for platform operators. Application troubleshooting should
continue to start from application metrics and then pivot into Loki/Tempo
Explore by time range and stable correlation IDs.

### P3: Beat Process Health

Status: implemented for the current single-replica stage.

Keep `backend-beat` as a single replica while the product is still early:

```text
replicas = 1
strategy = Recreate
```

Validate Kubernetes restart behavior and alert on scheduler heartbeats. Do not
scale Beat replicas without a leader or lock mechanism.

`backend-beat` uses a startup runtime check and a lightweight liveness probe for
its transient beat state directory. Redis, database, and business progress are
observed through scheduler heartbeat and lag metrics instead of liveness probes,
so transient dependency incidents do not cause blind restart loops.

### P4: Database Scheduler Lock

Status: implemented in code for the single-replica stage. Staging
multi-replica validation is still pending.

When the scheduler needs high availability, prefer PostgreSQL advisory lock or
a database-backed scheduler lease before Kubernetes Lease leader election.

Target shape:

```text
backend-beat replicas = 2
        |
        |
PostgreSQL scheduler lock
        |
        |
only one active scheduler dispatches work
```

This fits the current architecture because PostgreSQL is already the durable
task state source.

Implementation shape:

- scheduler locks are scoped by scheduler job, not by the whole Beat process;
- lock keys are stable `sha256`-derived 64-bit integers;
- the lock uses PostgreSQL session-scoped `pg_try_advisory_lock`;
- the lock is held on an independent database connection for the full scheduler
  scan callback;
- the callback may keep using normal short-lived database sessions;
- the lock is always released in `finally`;
- when another scheduler already holds the job lock, the scan is skipped and
  recorded as scheduler lock telemetry.

Implemented lock metrics:

- `noteverse_scheduler_lock_acquired_total`
- `noteverse_scheduler_lock_skipped_total`
- `noteverse_scheduler_last_lock_skipped_timestamp_seconds`

Do not treat lock skips as failures once Beat has more than one replica. In a
two-replica scheduler deployment, one replica acquiring the lock and the other
replica skipping the same job is expected behavior. The user-impacting alert is
still stale scans or high scheduler lag, not lock skips by themselves.

Rollout sequence:

1. Deploy the lock-capable code with `backend-beat replicas=1`.
2. Verify scheduler success, failure, lag, and lock metrics in staging.
3. Change staging `backend-beat` to `replicas=2`.
4. Verify duplicate Beat pods produce lock skips but do not duplicate outbox
   dispatch.
5. Only then consider production `backend-beat replicas=2`.

### P5: Kubernetes Lease Leader Election

Status: deferred.

Keep Kubernetes Lease as a later platform option for multi-scheduler,
multi-cluster, or operator-like workloads. It is not necessary for the current
NoteVerse stage.

## Current Implementation Notes

- Beat periodically sends maintenance tasks.
- Maintenance tasks scan PostgreSQL state and dispatch Celery tasks.
- Worker tasks claim rows again before doing work.
- Import dispatch uses `FOR UPDATE SKIP LOCKED`.
- Mail outbox uses `FOR UPDATE SKIP LOCKED`.
- Render and playback outbox worker claim paths lock individual records before
  processing.
- Business reliability comes from database state machines, retry counts,
  dispatch/processing timeouts, and idempotent claim behavior.
- Scheduler high availability uses PostgreSQL advisory locks before any future
  Kubernetes Lease leader-election model.

## Non-Goals

- Do not make Beat state depend on a PersistentVolume.
- Do not use Loki or Tempo as audit storage.
- Do not expose high-cardinality IDs as metrics labels.
- Do not add production multi-replica Beat until the database scheduler lock is
  validated with staging traffic.

# Scheduler Observability Plan

NoteVerse currently uses Celery Beat as a single scheduler process. Beat does
not own business state. PostgreSQL import jobs and outbox tables are the source
of truth for dispatch state, retry state, timeout recovery, and terminal
outcomes.

This plan keeps that architecture and improves production visibility before
adding scheduler high availability.

## Priority Order

## Validation Snapshot

As of 2026-08-02, the scheduler implementation has been validated against the
recreated minikube staging cluster:

- P0 metrics are exported from the API and read the durable PostgreSQL state;
- P3 Beat restart behavior and the singleton baseline were verified;
- P4 was exercised with two Beat replicas, a leader Pod deletion, and a
  successful standby takeover while PostgreSQL retained exactly one granted
  leader advisory lock.

The recreated cluster currently contains the application and its foundational
platform services, but not the observability Helm releases. P1 dashboards and
PrometheusRule alerts and the P2 platform dashboards are implemented in this
repository, but must be redeployed and validated with staging traffic before
they can be considered operationally active in this cluster.

### P0: Scheduler Metrics

Status: implemented and API-export validation complete. Prometheus scrape and
alert validation are pending observability-stack replay in the recreated
minikube cluster.

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

Status: implemented in repository. Deployment and staging-traffic validation
are pending observability-stack replay in the recreated minikube cluster.

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

Status: implemented as the first platform dashboard, but not currently
deployed in the recreated minikube cluster. Alert rules for the observability
stack itself are intentionally deferred until the dashboard has been validated
with staging traffic and each alert has an actionable runbook.

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

Status: implemented and staging-validated for the current single-replica
stage.

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

Status: implemented and staging-validated. The lock-aware API and Beat images
were deployed on 2026-08-02; a temporary two-replica rollout demonstrated one
active leader, one standby, a single granted PostgreSQL advisory lock, no new
scan-lock skip or dispatch duplication, and successful standby takeover after
the leader Pod was deleted. Staging has been restored to the singleton
baseline.

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

- every Beat replica runs through a lightweight leader supervisor before it
  starts the Celery Beat child process;
- the leader supervisor acquires a stable `sha256`-derived 64-bit PostgreSQL
  advisory lock scoped to `beat_leader` and holds its database session for the
  child Beat process' full lifetime;
- a standby replica does not start a Celery Beat child process; it records a
  lock skip, waits, and attempts to become leader again;
- loss of the leader database session terminates the local Beat child before it
  can publish further periodic tasks; PostgreSQL then releases the lock and a
  standby can take over;
- task-level advisory locks remain scoped by scheduler job and guard the scan
  callback as a second, independent fence against duplicate broker delivery;
- callbacks continue to use normal short-lived database sessions; neither lock
  is business state, and both are released automatically with their connection.

Implemented lock metrics:

- `noteverse_scheduler_lock_acquired_total`
- `noteverse_scheduler_lock_skipped_total`
- `noteverse_scheduler_last_lock_skipped_timestamp_seconds`

Leader-specific metrics are kept separate from scheduler scan metrics:

- `noteverse_scheduler_leader_last_heartbeat_timestamp_seconds`
- `noteverse_scheduler_leader_active`
- `noteverse_scheduler_leader_acquisitions_total`
- `noteverse_scheduler_leader_standby_total`
- `noteverse_scheduler_leader_child_exits_total`

Do not treat lock skips as failures once Beat has more than one replica. In a
two-replica scheduler deployment, one replica acquiring `beat_leader` and the
other replica staying standby is expected behavior. The user-impacting alert is
still stale scans or high scheduler lag, not lock skips by themselves.

Rollout sequence:

1. Deploy the lock-capable code with `backend-beat replicas=1`.
2. Verify scheduler success, failure, lag, and lock metrics in staging.
3. Change staging `backend-beat` to `replicas=2`.
4. Verify one Beat reports the leader acquisition while the other reports a
   standby skip, then confirm only the active Beat publishes the periodic
   schedule and outbox dispatch is not duplicated.
5. Only then consider production `backend-beat replicas=2` by applying the
   `deploy/application/overlays/production-ha` overlay. It owns the two-replica
   RollingUpdate and the Beat PDB; the baseline production overlay remains a
   maintainable singleton.

Production requirements before enabling two Beat replicas:

- `SCHEDULER_LOCK_DATABASE_URL` is a required Secret value and targets direct
  PostgreSQL or a dedicated PgBouncer session-pooling endpoint; transaction
  pooling is prohibited for this connection;
- lock connections use a bounded connect timeout and TCP keepalives;
- lock connections identify themselves through `application_name`, enforce a
  bounded SQL statement timeout, and use `tcp_user_timeout` on Linux so a dead
  TCP peer cannot leave a supervisor waiting indefinitely;
- add a Beat PodDisruptionBudget plus topology spreading or anti-affinity;
- use a RollingUpdate only after the lock-aware singleton release is proven.

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
- Do not claim exactly-once scheduling. PostgreSQL advisory locks reduce active
  scheduler overlap, while scan locks, atomic outbox claims, and idempotent
  worker state machines remain the final delivery safety boundary.

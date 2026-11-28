# Scheduler Operations

Beat uses a PostgreSQL advisory-lock leader boundary. Database-backed scans and
claims coordinate durable asynchronous work; competing claimers use row locks
and bounded state transitions. Celery delivery, worker execution and periodic
scans are separate operations. None supplies an exactly-once guarantee.

`backend/app/modules/scheduler_lock` owns lock acquisition and connection
lifetime. `scheduler_observability` records heartbeat/run statistics. The
Control Plane internal `/metrics` presents database-backed operational metrics;
its scrape must not be substituted with a customer or browser-local Practice
runtime.

Inspect leader freshness, scheduler lag, scan completion, due/dispatch counts,
run duration and failures together. A running Beat Pod alone does not prove
fresh scheduling. A quiet queue does not prove scans ran. Metric definitions,
thresholds and lookback windows are owned by exporter code and checked-in
PrometheusRules, not by copied screenshots.

Use targeted runbooks for [leader staleness](../runbooks/alerts/scheduler-leader-stale.md),
[lag](../runbooks/alerts/scheduler-lag-high.md),
[scan staleness](../runbooks/alerts/scheduler-scan-stale.md) and
[failures](../runbooks/alerts/scheduler-failures-increasing.md).
Correlate task/outbox IDs through JSON logs; keep those IDs out of labels.
Lock release, worker retry and scan recovery must preserve idempotent domain
semantics before an operator retries work.

# Worker architecture

The Worker package is split by runtime responsibility. Keep these boundaries
small and explicit so Celery task names stay stable while business execution can
evolve independently.

## Package ownership

| Path                               | Owns                                                                                                                                                                                                                        | Should not own                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `tasks.py`                         | Celery task registration, stable task names, task decorator options, and one-line delegation to execution handlers.                                                                                                         | Database work, business workflows, retry/failure transitions, model/render/playback execution, or scheduler scan callbacks. |
| `execution/`                       | The actual task execution workflows after Celery has invoked a task. This includes claim/run/complete/fail handling, attempt tracing, task-specific status logging, periodic dispatch recovery, and periodic cleanup scans. | Publishing a new Celery task for later delivery.                                                                            |
| `../modules/revisions/dispatch.py` | Shared API/Beat revision render and audio producers.                                                                                                                                                                        | Task execution.                                                                                                             |
| `dispatch/`                        | Durable dispatch from database-backed pending work into Celery, including producer tracing and release-on-dispatch-failure handling.                                                                                        | Running the target task's business workflow.                                                                                |
| `task_runtime.py`                  | Shared task runtime helpers: task context binding, operation log binding, attempt tracing, scheduler lock coordination, and scheduler observability.                                                                        | Task-specific business logic or dispatch routing.                                                                           |
| `../task_queue/schedule.py`        | The mapping from recurring maintenance jobs to Celery task names and intervals.                                                                                                                                             | Runtime option policy or scan callback implementation.                                                                      |
| `../task_queue/options.py`         | Celery process behavior policy such as serializers, acknowledgement semantics, deadlines, worker lifecycle limits, broker/backend timeouts, and Beat schedule wiring.                                                       | Business task registration or environment-file ownership.                                                                   |
| `../task_queue/config.py`          | Celery application assembly, optional task-module import, Beat state-file path, and Celery framework signal registration.                                                                                                   | Task execution logic or task route examples for removed tasks.                                                              |

Revision transactions commit canonical snapshots and outboxes before immediate best-effort
dispatch through the shared revision producer. Beat relays missed deliveries and recovers
expired dispatch/processing leases; it is not the normal-path scheduling delay.

## Fenced durable attempts

Dispatch admission and broker rejection do not consume an attempt. Worker claim
creates an immutable `DeliveryAttemptLease` with a one-based attempt number and a
fresh opaque token. DurableDeliveryLifecycle owns token installation, matching and
clearing for Import, Render, Playback, Mail, Score deletion, StoredObject retirement
and ObjectWrite cleanup. Domain services retain admission, payloads, locking,
diagnostics and terminal meaning; task entrypoints and execution remain domain-owned.

Outcome commands refresh and lock the delivery row, then require PROCESSING plus
the exact lease count and token. Recovery clears the old token before a new claim.
Every accepted terminal/reset clears it as well. ObjectWrite cleanup uses
CLEANUP_PROCESSING and keeps its physical `write_token` independent. Render/Playback
publish ready/failed realtime state only after an accepted current-attempt outcome.
Workers log attempt numbers and tracing context, never fencing tokens.

Derivative generation releases claim locks before expensive computation and physical
prewrite. Final Render/Playback admission locks Score then the refreshed outbox;
review thumbnails lock ImportJob then RenderOutbox. The exact lease and domain
target/source identity are checked before adopting bytes or changing assets,
accounting and retirements. Successful adoption and outbox completion commit once in
the worker transaction; ready realtime is added after accepted completion. Generation
services do not commit between adoption and completion. StaleDeliveryAttempt returns
`stale` with no semantic/outbox/realtime mutation. Unadopted ObjectWriteIntents own
abandoned physical writes and durable cleanup, without direct best-effort deletion.

Fencing protects durable state ownership rather than exactly-once external execution.
Mail provider calls can be delivered more than once after uncertain network outcomes
or worker loss; stale sent/failure results cannot overwrite a new attempt or its
provider message ID. Each domain keeps its own maintenance scan and worker rather
than sharing a universal job table or runner.

Import finalization commits Job state and a typed DomainEvent atomically, then attempts
the Import notification and realtime database projectors immediately. Each projector
commits its database representations with its own locked checkpoint. Notification rows
and their `notification.created` wake-ups belong to one projection transaction.
`run_domain_projection_maintenance` delegates to `execution/domain_projections.py` and
catches up registered projectors every five seconds through `run_scheduler_scan`.
Projection handlers perform database-only work; external delivery retains domain-owned
outboxes and DurableDeliveryLifecycle. See
[Domain Events and Database Projections](../../../docs/architecture/domain-events-and-projections.md).

## Directional dependency rules

- `tasks.py` may import from `execution/`, but `execution/` must not import from
  `tasks.py`.
- `dispatch/` sends Celery tasks by their stable task names. It must not import
  execution handlers directly.
- Shared producer-span, Celery `send_task`, success/failure logging, and
  release-on-failure behavior belongs in `../task_queue/producer.py`; dispatch modules
  should keep only flow-specific claim/mark details.
- `execution/maintenance_dispatch.py` may import dispatch functions inside scan
  callbacks to avoid creating import-time cycles with Celery app assembly.
- Shared cross-task mechanics belong in `task_runtime.py`; if a helper needs a
  domain service, it probably belongs in a task-specific execution module.
- New task names must be added to `tasks.py` and, if recurring, to
  `../task_queue/schedule.py`. Existing task names are compatibility contracts with
  queued messages and Beat schedules, so rename them only with an explicit
  migration plan.

## Adding a new Worker flow

1. Add the execution workflow under `execution/`.
2. Add the Celery task registration in `tasks.py` and delegate to the execution
   function.
3. If the task is dispatched from durable database state, add the producer under
   `dispatch/`.
4. If the task is periodic, add the schedule entry in `../task_queue/schedule.py` and the
   scan callback in `execution/maintenance_dispatch.py` when the job recovers
   and publishes durable pending work, or in `execution/maintenance_cleanup.py`
   when the job deletes, expires, or enforces retention policy.
5. Add focused tests around the owning module instead of testing internals
   through `tasks.py`.

## Durable object retirement

`stored_object_retirement_task` executes a durable physical retirement attempt. Maintenance scans semantic Bundle GC/stale creation and the shared retirement queue. Bundle/Take and other domains release semantic references and accounting in their own transactions. The worker validates all StoredObject references and flushes FK-protected row deletion before ObjectStorage IO; operation attempts use DurableDeliveryLifecycle retry/lease rules plus a fresh fencing token.

See [Object storage](../../../docs/architecture/object-storage.md).

## Score deletion

`Score.deleted_at` owns product visibility. API admission atomically hides the Score
and creates its unique `ScoreDeletionOperation`. It immediately attempts best-effort
publication through `dispatch/score_deletion.py`; broker failure releases the durable
operation for relay. `score_deletion_task` delegates to `execution/score_deletion.py`,
which claims an attempt and executes the domain graph cleanup under an operation lock
and attempt token. Score hard deletion, usage releases, retirement enqueue and operation
completion share one database transaction. The completed operation retains the resource
UUID after its nullable Score FK is cleared. `run_score_deletion_maintenance` recovers
missed publication, due retries and expired leases through DurableDeliveryLifecycle.

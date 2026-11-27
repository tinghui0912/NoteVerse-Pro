# Worker architecture

The Worker package is split by runtime responsibility. Keep these boundaries
small and explicit so Celery task names stay stable while business execution can
evolve independently.

Worker composition owns a synchronous SQLAlchemy engine and SessionFactory in
`app.runtime.worker.context`. Platform factories construct these resources from
explicit process configuration. Each workflow explicitly commits its
claim, semantic outcome or recovery phase; Session creation only opens and closes
resources. ObjectWrite retains explicit PREPARED and WRITTEN durability phases.
Workers and database-backed HTTP use cases use synchronous ObjectStorage. HTTP
streaming schedules provider iteration through AsyncObjectReader over the same
namespace. Adopted object deletion remains retirement-owned.

## Package ownership

| Path                               | Owns                                                                                                                                                                                                                        | Should not own                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `tasks.py`                         | Celery task registration, stable task names, task decorator options, and one-line delegation to execution handlers.                                                                                                         | Database work, business workflows, retry/failure transitions, model/render/playback execution, or scheduler scan callbacks. |
| `execution/`                       | The actual task execution workflows after Celery has invoked a task. This includes claim/run/complete/fail handling, attempt tracing, task-specific status logging, periodic dispatch recovery, and periodic cleanup scans. | Publishing a new Celery task for later delivery.                                                                            |
| `../composition/dispatch/`                        | Durable dispatch from database-backed pending work into Celery, including producer tracing and release-on-dispatch-failure handling.                                                                                        | Running the target task's business workflow.                                                                                |
| `task_runtime.py`                  | Shared task runtime helpers: task context binding, operation log binding, attempt tracing, scheduler lock coordination, and scheduler observability.                                                                        | Task-specific business logic or dispatch routing.                                                                           |
| `../task_queue/schedule.py`        | The mapping from recurring maintenance jobs to Celery task names and intervals.                                                                                                                                             | Runtime option policy or scan callback implementation.                                                                      |
| `../task_queue/options.py`         | Celery process behavior policy such as serializers, acknowledgement semantics, deadlines, worker lifecycle limits, broker/backend timeouts, and Beat schedule wiring.                                                       | Business task registration or environment-file ownership.                                                                   |
| `../runtime/worker/main.py`, `../runtime/beat/main.py` | Separate Celery composition roots, task registration, schedule paths and framework signals. | Business task execution. |

Revision transactions commit canonical snapshots and outboxes before immediate best-effort
dispatch through the shared revision producer. Beat relays missed deliveries and recovers
expired dispatch/processing leases; it is not the normal-path scheduling delay.

RevisionWriter is the sole revision/source/head write boundary and a transaction
participant. It admits PENDING metadata, render/playback/metadata work and non-initial
notification/realtime consequences atomically with source accounting. Writer resolves
the current owner/member audience in that transaction. Initial revisions have no
version-saved presentation. Retention is Beat reconciliation.

`revision_metadata_task` delegates to domain-specific metadata execution. Claim uses
DeliveryAttemptLease; read/extraction runs outside locks. Final admission locks Score
then metadata outbox and atomically writes metadata, completes delivery and creates
score.metadata.changed. Unsupported extraction is a completed FAILED metadata result;
infrastructure failure uses durable retry. `run_revision_metadata_maintenance` scans
every five seconds and relays through the shared producer. Post-commit fast paths are
latency hints backed by durable evidence, never request-path business sagas.

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
prewrite. Final revision-render/Playback admission locks Score then the refreshed outbox.
The exact lease and domain
target/source identity are checked before adopting bytes or changing assets,
accounting and retirements. Successful adoption and outbox completion commit once in
the worker transaction; ready realtime is added after accepted completion. Generation
services do not commit between adoption and completion. StaleDeliveryAttempt returns
`stale` with no semantic/outbox/realtime mutation. Unadopted ObjectWriteIntents own
abandoned physical writes and durable cleanup, without direct best-effort deletion.

Metadata completion and Render/Playback accepted ready/failed outcomes use strict
transactional `publish_score_change`. It resolves current recipients, persists
and flushes all realtime rows and issues transactional pg_notify without handling
exceptions or owning commit/rollback. Partial fan-out/NOTIFY failure rolls back the
whole authoritative transaction. Failed metadata/ready publication can then enter
fenced retry in a new transaction. If failed derivative publication also fails,
its FAILED transition rolls back and the worker raises; lease recovery remains
authoritative. Notification admission also uses strict transactional publication.

Fencing protects durable state ownership rather than exactly-once external execution.
Mail provider calls can be delivered more than once after uncertain network outcomes
or worker loss; stale sent/failure results cannot overwrite a new attempt or its
provider message ID. Each domain keeps its own maintenance scan and worker rather
than sharing a universal job table or runner.

Import finalization commits Job state, diagnostics, ready-for-review/failed notifications,
notifications.changed and import_jobs.changed realtime in one
transaction. Publication failure
rolls back the accepted domain outcome. Current-attempt locks and terminal-state checks
prevent repeated terminal calls from duplicating realtime rows. Delivery exhaustion
admits failure consequences only when unfinished work actually transitions to FAILED.
External work retains domain-owned outboxes and DurableDeliveryLifecycle.

## Directional dependency rules

- `tasks.py` may import from `execution/`, but `execution/` must not import from
  `tasks.py`.
- `app.composition.dispatch` sends Celery tasks by their stable task names. It must not import
  execution handlers directly.
- Shared producer-span, Celery `send_task`, success/failure logging, and
  release-on-failure behavior belongs in `../task_queue/producer.py`; dispatch modules
  should keep only flow-specific claim/mark details.
- `execution/maintenance_dispatch.py` receives configured dispatch services from
  the Worker process context.
- Shared cross-task mechanics belong in `task_runtime.py`; if a helper needs a
  domain service, it probably belongs in a task-specific execution module.
- New task names must be added to `tasks.py` and, if recurring, to
  `../task_queue/schedule.py`. Task names identify
  queued messages and Beat schedules.

## Adding a new Worker flow

1. Add the execution workflow under `execution/`.
2. Add the Celery task registration in `tasks.py` and delegate to the execution
   function.
3. If the task is dispatched from durable database state, add the producer under
   `app.composition.dispatch`.
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

## Import execution ownership

Import pipeline composition, artifacts, deadlines and progress live under
`app.modules.import_jobs.pipeline`; OMR/MusicXML/text engines remain shared processing
capabilities. Workers use the neutral `app.task_queue.protocols.CeleryTaskLike`.
Import Review retains temporary MusicXML and original uploads until confirmation.
Import Review APIs are ImportJob sub-resources. Confirmation commits Score/RevisionWriter
admission, input promotion, temporary release and retained completed-notification navigation
enrichment in one transaction. A notification removed by retention does not block
confirmation and is not recreated. Browser realtime retains its completed/failed signals.

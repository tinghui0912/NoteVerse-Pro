# Worker architecture

The Worker package is split by runtime responsibility. Keep these boundaries
small and explicit so Celery task names stay stable while business execution can
evolve independently.

## Package ownership

| Path | Owns | Should not own |
| --- | --- | --- |
| `tasks.py` | Celery task registration, stable task names, task decorator options, and one-line delegation to execution handlers. | Database work, business workflows, retry/failure transitions, model/render/playback execution, or scheduler scan callbacks. |
| `execution/` | The actual task execution workflows after Celery has invoked a task. This includes claim/run/complete/fail handling, attempt tracing, task-specific status logging, periodic dispatch recovery, and periodic cleanup scans. | Publishing a new Celery task for later delivery. |
| `dispatch/` | Durable dispatch from database-backed pending work into Celery, including producer tracing and release-on-dispatch-failure handling. | Running the target task's business workflow. |
| `task_runtime.py` | Shared task runtime helpers: task context binding, operation log binding, attempt tracing, scheduler lock coordination, and scheduler observability. | Task-specific business logic or dispatch routing. |
| `beat_schedule.py` | The mapping from recurring maintenance jobs to Celery task names and intervals. | Runtime option policy or scan callback implementation. |
| `celery_runtime_options.py` | Celery process behavior policy such as serializers, acknowledgement semantics, deadlines, worker lifecycle limits, broker/backend timeouts, and Beat schedule wiring. | Business task registration or environment-file ownership. |
| `celery_config.py` | Celery application assembly, optional task-module import, Beat state-file path, and Celery framework signal registration. | Task execution logic or task route examples for removed tasks. |

## Directional dependency rules

- `tasks.py` may import from `execution/`, but `execution/` must not import from
  `tasks.py`.
- `dispatch/` sends Celery tasks by their stable task names. It must not import
  execution handlers directly.
- Shared producer-span, Celery `send_task`, success/failure logging, and
  release-on-failure behavior belongs in `dispatch/runtime.py`; dispatch modules
  should keep only flow-specific claim/mark details.
- `execution/maintenance_dispatch.py` may import dispatch functions inside scan
  callbacks to avoid creating import-time cycles with Celery app assembly.
- Shared cross-task mechanics belong in `task_runtime.py`; if a helper needs a
  domain service, it probably belongs in a task-specific execution module.
- New task names must be added to `tasks.py` and, if recurring, to
  `beat_schedule.py`. Existing task names are compatibility contracts with
  queued messages and Beat schedules, so rename them only with an explicit
  migration plan.

## Adding a new Worker flow

1. Add the execution workflow under `execution/`.
2. Add the Celery task registration in `tasks.py` and delegate to the execution
   function.
3. If the task is dispatched from durable database state, add the producer under
   `dispatch/`.
4. If the task is periodic, add the schedule entry in `beat_schedule.py` and the
   scan callback in `execution/maintenance_dispatch.py` when the job recovers
   and publishes durable pending work, or in `execution/maintenance_cleanup.py`
   when the job deletes, expires, or enforces retention policy.
5. Add focused tests around the owning module instead of testing internals
   through `tasks.py`.

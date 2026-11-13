"""Attempt-fenced, transactional Score graph deletion."""

from app.db.sync_session import get_worker_db
from app.modules.scores.deletion_delivery import score_deletion_delivery, StaleScoreDeletionAttempt
from app.modules.scores.deletion_executor import ScoreDeletionExecutor
from app.worker.task_runtime import (
    bind_task_context,
    clear_task_context,
    start_attempt_trace,
    operation_logger,
)


def execute_score_deletion_task(task, operation_uuid: str) -> dict[str, object]:
    bind_task_context(task)
    try:
        with get_worker_db() as db:
            lease = score_deletion_delivery.claim(db, operation_uuid)
        if lease is None:
            return {"status": "ignored", "operation_uuid": operation_uuid}
        try:
            with start_attempt_trace(
                name="noteverse.score_deletion.execute",
                operation_kind="score_deletion",
                operation_id=operation_uuid,
                attempt=lease.attempt,
                traceparent=lease.traceparent,
                tracestate=lease.tracestate,
            ):
                with get_worker_db() as db:
                    result = ScoreDeletionExecutor().execute(db, lease)
            return {
                "status": "completed",
                "operation_uuid": operation_uuid,
                "scores_deleted": result.scores_deleted,
                "object_retirements_queued": result.object_retirements_queued,
            }
        except StaleScoreDeletionAttempt:
            return {"status": "ignored", "operation_uuid": operation_uuid}
        except Exception as error:
            operation_logger(
                "score_deletion.failed",
                operation_id=operation_uuid,
                resource_id=lease.score_uuid,
                attempt=lease.attempt,
            ).opt(exception=True).error("score_deletion.failed")
            with get_worker_db() as db:
                score_deletion_delivery.fail(db, lease, str(error))
            return {"status": "failed", "operation_uuid": operation_uuid}
    finally:
        clear_task_context()

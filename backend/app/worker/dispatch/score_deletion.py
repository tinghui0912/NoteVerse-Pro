"""Best-effort publication of a durably admitted Score deletion."""

from uuid import uuid4
from app.core.logger import logger
from app.db.session import SessionLocal
from app.modules.scores.deletion_delivery import score_deletion_delivery, lock_operation
from app.task_queue.producer import send_durable_task
from app.task_queue.tracing import DurableTraceContext


def dispatch_score_deletion(operation_uuid: str) -> bool:
    with SessionLocal() as db:
        if not score_deletion_delivery.mark_dispatched(db, operation_uuid):
            db.commit()
            return False
        db.flush()
        operation = lock_operation(db, operation_uuid)
        assert operation is not None
        context = DurableTraceContext(operation.traceparent, operation.tracestate)
        score_uuid = operation.score_uuid
        db.commit()
    return send_durable_task(
        task_name="app.worker.tasks.score_deletion_task",
        task_kwargs={"operation_uuid": operation_uuid},
        task_id=uuid4().hex,
        operation_kind="score_deletion",
        operation_id=operation_uuid,
        span_name="noteverse.score_deletion.dispatch",
        success_event="score_deletion.dispatched",
        failure_event="score_deletion.dispatch_failed",
        log_context={"resource_id": score_uuid},
        trace_context=context,
        release_dispatch=lambda error: _release(operation_uuid, error),
    )


def _release(operation_uuid: str, error: str) -> None:
    with SessionLocal() as db:
        score_deletion_delivery.release_dispatch(db, operation_uuid, error)
        db.commit()


def dispatch_score_deletion_best_effort(operation_uuid: str) -> None:
    try:
        dispatch_score_deletion(operation_uuid)
    except Exception:
        logger.bind(operation_id=operation_uuid).opt(exception=True).warning(
            "score_deletion.immediate_dispatch_failed"
        )

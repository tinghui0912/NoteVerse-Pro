from collections.abc import Iterable
from uuid import uuid4
from app.core.logger import logger
from app.db.session import SessionLocal
from app.modules.storage_objects.writes import write_cleanup_delivery
from app.task_queue.producer import send_durable_task
from app.task_queue.tracing import DurableTraceContext


def dispatch_object_write_cleanup(intent_uuid: str) -> bool:
    with SessionLocal() as db:
        if not write_cleanup_delivery.dispatch(db, intent_uuid):
            db.commit()
            return False
        db.commit()
    return send_durable_task(
        task_name="app.worker.tasks.object_write_cleanup_task",
        task_kwargs={"intent_uuid": intent_uuid},
        task_id=uuid4().hex,
        operation_kind="object_write_cleanup",
        operation_id=intent_uuid,
        span_name="noteverse.object_write_cleanup.dispatch",
        success_event="object_write_cleanup.dispatched",
        failure_event="object_write_cleanup.dispatch_failed",
        log_context={"resource_id": intent_uuid},
        trace_context=DurableTraceContext(traceparent=None, tracestate=None),
        release_dispatch=lambda error: _release(intent_uuid, error),
    )


def _release(uuid: str, error: str) -> None:
    with SessionLocal() as db:
        write_cleanup_delivery.release(db, uuid, error)
        db.commit()


def dispatch_write_cleanups_best_effort(uuids: Iterable[str]) -> None:
    for uuid in set(uuids):
        try:
            dispatch_object_write_cleanup(uuid)
        except Exception:
            logger.bind(resource_id=uuid).opt(exception=True).warning(
                "object_write_cleanup.immediate_dispatch_failed"
            )

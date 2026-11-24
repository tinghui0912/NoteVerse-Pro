"""Post-commit Account erasure dispatch; periodic recovery remains authoritative."""

from uuid import uuid4
from app.db.session import SessionLocal
from app.core.logger import logger
from app.modules.account.deletion_delivery import account_deletion_delivery as delivery
from app.task_queue.producer import send_durable_task
from app.task_queue.tracing import DurableTraceContext


def _release(uuid: str, error: str) -> None:
    with SessionLocal.begin() as db:
        delivery.release_dispatch(db, uuid, error)


def dispatch_account_deletion(uuid: str) -> bool:
    with SessionLocal.begin() as db:
        if not delivery.dispatch(db, uuid):
            return False
    return send_durable_task(
        task_name="app.worker.tasks.account_deletion_task",
        task_kwargs={"operation_uuid": uuid},
        task_id=uuid4().hex,
        operation_kind="account_deletion",
        operation_id=uuid,
        span_name="noteverse.account_deletion.dispatch",
        success_event="account_deletion.dispatched",
        failure_event="account_deletion.dispatch_failed",
        log_context={},
        trace_context=DurableTraceContext(None, None),
        release_dispatch=lambda error: _release(uuid, error),
    )


def dispatch_account_deletion_best_effort(uuid: str) -> None:
    try:
        dispatch_account_deletion(uuid)
    except Exception:
        logger.bind(operation_id=uuid).opt(exception=True).warning(
            "account_deletion.immediate_dispatch_failed"
        )

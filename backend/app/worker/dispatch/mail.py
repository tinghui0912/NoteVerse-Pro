from __future__ import annotations

from app.core.logger import logger
from app.db.worker_session import get_worker_db
from app.modules.mail.outbox_service import mail_outbox_service
from app.worker.celery_config import celery_app


def dispatch_mail_outbox(outbox_uuid: str) -> bool:
    with get_worker_db() as db:
        if not mail_outbox_service.mark_dispatched(db, outbox_uuid):
            return False
    try:
        celery_app.send_task(
            "app.worker.tasks.send_mail_outbox_task",
            kwargs={"outbox_uuid": outbox_uuid},
            task_id=f"mail-{outbox_uuid}",
        )
        logger.bind(
            event="mail.dispatched",
            operation_kind="mail",
            outbox_id=outbox_uuid,
            task_id=f"mail-{outbox_uuid}",
        ).info("mail.dispatched")
        return True
    except Exception as exc:
        with get_worker_db() as db:
            mail_outbox_service.release_dispatch(db, outbox_uuid, str(exc))
        logger.bind(
            event="mail.dispatch_failed",
            operation_kind="mail",
            outbox_id=outbox_uuid,
            task_id=f"mail-{outbox_uuid}",
            exception_type=type(exc).__name__,
        ).opt(exception=True).warning("mail.dispatch_failed")
        return False

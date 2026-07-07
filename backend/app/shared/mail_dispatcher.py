from __future__ import annotations

from app.core.logger import logger
from app.db.worker_session import get_worker_db
from app.modules.mail.outbox_service import mail_outbox_service


def dispatch_mail_outbox(outbox_uuid: str) -> bool:
    with get_worker_db() as db:
        if not mail_outbox_service.mark_dispatched(db, outbox_uuid):
            return False
    try:
        from app.worker.tasks import send_mail_outbox_task

        send_mail_outbox_task.apply_async(
            kwargs={"outbox_uuid": outbox_uuid},
            task_id=f"mail-{outbox_uuid}",
        )
        return True
    except Exception as exc:
        with get_worker_db() as db:
            mail_outbox_service.release_dispatch(db, outbox_uuid, str(exc))
        logger.warning("Failed to dispatch mail outbox {}: {}", outbox_uuid, exc)
        return False

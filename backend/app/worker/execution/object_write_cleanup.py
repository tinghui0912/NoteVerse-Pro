"""Durably clean unadopted bytes while holding the write-generation fence."""

from app.core.logger import logger
from app.db.sync_session import get_worker_db
from app.modules.storage_objects.writes import (
    lock_intent,
    intent_facts,
    _matching_object,
    cleanup_lifecycle,
    write_cleanup_delivery,
)
from app.storage import object_storage
from app.utils.timezone import utc_now_naive
from app.worker.task_runtime import bind_task_context, clear_task_context


def execute_object_write_cleanup_task(task, intent_uuid: str) -> dict[str, str]:
    bind_task_context(task)
    try:
        with get_worker_db() as db:
            attempt = write_cleanup_delivery.claim(db, intent_uuid)
        if attempt is None:
            return {"status": "ignored", "intent_uuid": intent_uuid}
        try:
            with get_worker_db() as db:
                row = lock_intent(db, intent_uuid)
                if not write_cleanup_delivery.matches(row, attempt):
                    return {"status": "ignored", "intent_uuid": intent_uuid}
                existing = _matching_object(db, intent_facts(row))
                if existing is not None:
                    cleanup_lifecycle().finish_attempt(
                        row, lease=attempt, status="ADOPTED", error=None, now=utc_now_naive()
                    )
                    return {"status": "adopted", "intent_uuid": intent_uuid}
                object_storage.delete(row.object_key)
                cleanup_lifecycle().complete_attempt(row, lease=attempt, now=utc_now_naive())
            return {"status": "cleaned", "intent_uuid": intent_uuid}
        except Exception as error:
            with get_worker_db() as db:
                write_cleanup_delivery.fail(db, attempt, str(error))
            logger.bind(resource_id=intent_uuid).opt(exception=True).error(
                "object_write_cleanup.failed"
            )
            return {"status": "failed", "intent_uuid": intent_uuid}
    finally:
        clear_task_context()

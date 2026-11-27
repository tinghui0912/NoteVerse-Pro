"""Durably clean unadopted bytes while holding the write-generation fence."""

from app.modules.media_storage.write_cleanup import clean_write_attempt


from app.core.logger import logger
from app.db.session import SessionLocal
from app.modules.media_storage.write_cleanup import write_cleanup_delivery
from app.storage import object_storage
from app.worker.task_runtime import bind_task_context, clear_task_context


def execute_object_write_cleanup_task(task, intent_uuid: str) -> dict[str, str]:
    bind_task_context(task)
    try:
        with SessionLocal() as db:
            attempt = write_cleanup_delivery.claim(db, intent_uuid)
            db.commit()
        if attempt is None:
            return {"status": "ignored", "intent_uuid": intent_uuid}
        try:
            with SessionLocal() as db:
                status = clean_write_attempt(db, object_storage, attempt)
                db.commit()
            return {"status": status, "intent_uuid": intent_uuid}
        except Exception as error:
            with SessionLocal() as db:
                write_cleanup_delivery.fail(db, attempt, str(error))
                db.commit()
            logger.bind(resource_id=intent_uuid).opt(exception=True).error(
                "object_write_cleanup.failed"
            )
            return {"status": "failed", "intent_uuid": intent_uuid}
    finally:
        clear_task_context()

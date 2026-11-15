"""Attempt-fenced physical deletion, independent of semantic domains and accounting."""

from app.core.logger import logger
from app.shared.time import utc_now
from app.db.session import SessionLocal
from app.modules.storage_objects.persistence import object_from_row
from app.modules.storage_objects.references import stored_object_has_semantic_references
from app.modules.storage_objects.retirement import (
    _object,
    delivery_lifecycle,
    retirement_delivery,
    snapshot,
)
from app.storage import object_storage
from app.worker.task_runtime import bind_task_context, clear_task_context


def execute_stored_object_retirement_task(task, retirement_uuid: str) -> dict[str, str]:
    bind_task_context(task)
    try:
        return _execute(retirement_uuid)
    finally:
        clear_task_context()


def _execute(retirement_uuid: str) -> dict[str, str]:
    with SessionLocal() as db:
        attempt = retirement_delivery.claim(db, retirement_uuid)
        db.commit()
    if attempt is None:
        return {"status": "ignored", "retirement_uuid": retirement_uuid}
    try:
        with SessionLocal() as db:
            # A common Store -> operation lock order prevents retention/destruction deadlocks.
            row = (
                _object(db, attempt.stored_object_id)
                if attempt.stored_object_id is not None
                else None
            )
            operation = retirement_delivery.get(db, retirement_uuid, lock=True)
            lifecycle = delivery_lifecycle()
            if operation is None or not lifecycle.attempt_matches(operation, attempt):
                db.commit()
                return {"status": "ignored", "retirement_uuid": retirement_uuid}
            if operation.status != "PROCESSING":
                db.commit()
                return {"status": "ignored", "retirement_uuid": retirement_uuid}
            if row is None or operation.stored_object_id != row.id:
                raise ValueError("Processing retirement has no matching StoredObject")
            if snapshot(operation) != object_from_row(row):
                raise ValueError("Retirement snapshot disagrees with StoredObject")
            if stored_object_has_semantic_references(db, row.id):
                lifecycle.finish_attempt(
                    operation, lease=attempt, status="CANCELLED", error=None, now=utc_now()
                )
                db.commit()
                return {"status": "cancelled", "retirement_uuid": retirement_uuid}
            db.delete(row)
            db.flush()  # RESTRICT is the final barrier before any physical IO.
            object_storage.delete(operation.object_key)
            if not lifecycle.complete_attempt(operation, lease=attempt, now=utc_now()):
                raise ValueError("Retirement completion attempt mismatch")
            db.commit()
        return {"status": "completed", "retirement_uuid": retirement_uuid}
    except Exception as error:
        logger.bind(resource_id=retirement_uuid, attempt=attempt.attempt).opt(exception=True).error(
            "stored_object_retirement.failed"
        )
        with SessionLocal() as db:
            retirement_delivery.fail(db, attempt, str(error))
            db.commit()
        return {"status": "failed", "retirement_uuid": retirement_uuid}

"""Attempt-fenced physical deletion, independent of semantic domains and accounting."""

from app.core.logger import logger
from app.utils.timezone import utc_now_naive
from app.db.sync_session import get_worker_db
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
    with get_worker_db() as db:
        attempt = retirement_delivery.claim(db, retirement_uuid)
    if attempt is None:
        return {"status": "ignored", "retirement_uuid": retirement_uuid}
    try:
        with get_worker_db() as db:
            # A common Store -> operation lock order prevents retention/destruction deadlocks.
            row = (
                _object(db, attempt.stored_object_id)
                if attempt.stored_object_id is not None
                else None
            )
            operation = retirement_delivery.get(db, retirement_uuid, lock=True)
            lifecycle = delivery_lifecycle()
            if (
                operation is None
                or operation.attempt_token != attempt.token
                or not lifecycle.attempt_matches(operation, attempt.attempt)
            ):
                return {"status": "ignored", "retirement_uuid": retirement_uuid}
            if operation.status != "PROCESSING":
                return {"status": "ignored", "retirement_uuid": retirement_uuid}
            if row is None or operation.stored_object_id != row.id:
                raise ValueError("Processing retirement has no matching StoredObject")
            if snapshot(operation) != object_from_row(row):
                raise ValueError("Retirement snapshot disagrees with StoredObject")
            if stored_object_has_semantic_references(db, row.id):
                lifecycle.finish(operation, status="CANCELLED", error=None, now=utc_now_naive())
                return {"status": "cancelled", "retirement_uuid": retirement_uuid}
            db.delete(row)
            db.flush()  # RESTRICT is the final barrier before any physical IO.
            object_storage.delete(operation.object_key)
            if not lifecycle.complete_attempt(
                operation, expected_attempt=attempt.attempt, now=utc_now_naive()
            ):
                raise ValueError("Retirement completion attempt mismatch")
        return {"status": "completed", "retirement_uuid": retirement_uuid}
    except Exception as error:
        logger.bind(resource_id=retirement_uuid, attempt=attempt.attempt).opt(exception=True).error(
            "stored_object_retirement.failed"
        )
        with get_worker_db() as db:
            retirement_delivery.fail(
                db, retirement_uuid, str(error), attempt=attempt.attempt, token=attempt.token
            )
        return {"status": "failed", "retirement_uuid": retirement_uuid}

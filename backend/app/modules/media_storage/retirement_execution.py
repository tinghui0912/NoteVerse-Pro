"""Attempt-fenced physical deletion, independent of semantic domains and accounting."""

from app.modules.media_storage.domain import StoredObjectRetirementStatus

from app.core.logger import logger
from app.shared.time import utc_now
from app.modules.media_storage.write_coordinator import SessionFactory
from app.modules.media_storage.persistence import object_from_row
from app.modules.media_storage.references import stored_object_has_semantic_references
from app.modules.media_storage.retirement import (
    _object,
    delivery_lifecycle,
    retirement_delivery,
    snapshot,
)
from app.storage import ObjectStorage


def execute_retirement(
    retirement_uuid: str, sessions: SessionFactory, storage: ObjectStorage
) -> dict[str, str]:
    with sessions() as db:
        attempt = retirement_delivery.claim(db, retirement_uuid)
        db.commit()
    if attempt is None:
        return {"status": "ignored", "retirement_uuid": retirement_uuid}
    stage = "reference_check"
    try:
        with sessions() as db:
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
            if operation.status != StoredObjectRetirementStatus.PROCESSING:
                db.commit()
                return {"status": "ignored", "retirement_uuid": retirement_uuid}
            if row is None or operation.stored_object_id != row.id:
                raise ValueError("Processing retirement has no matching StoredObject")
            if not snapshot(operation).agrees_with(object_from_row(row)):
                raise ValueError("Retirement snapshot disagrees with StoredObject")
            if stored_object_has_semantic_references(db, row.id):
                if operation.deletion_fenced_at is not None:
                    raise ValueError(
                        "A fenced physical deletion acquired an unexpected semantic reference"
                    )
                lifecycle.finish_attempt(
                    operation,
                    lease=attempt,
                    status=StoredObjectRetirementStatus.CANCELLED,
                    error=None,
                    now=utc_now(),
                )
                db.commit()
                return {"status": "cancelled", "retirement_uuid": retirement_uuid}
            if operation.deletion_fenced_at is None:
                # Persist irreversibility before external IO. A rolled-back completion must
                # never make a possibly deleted physical object available for reference reuse.
                stage = "deletion_fence"
                operation.deletion_fenced_at = utc_now()
                db.commit()
                assert attempt.stored_object_id is not None
                row = _object(db, attempt.stored_object_id)
                operation = retirement_delivery.get(db, retirement_uuid, lock=True)
                if operation is None or not lifecycle.attempt_matches(operation, attempt):
                    return {"status": "ignored", "retirement_uuid": retirement_uuid}
                if row is None or operation.stored_object_id != row.id:
                    raise ValueError("Fenced retirement has no matching StoredObject")
                if not snapshot(operation).agrees_with(
                    object_from_row(row)
                ) or stored_object_has_semantic_references(db, row.id):
                    raise ValueError("Fenced retirement authority changed")
            db.delete(row)
            db.flush()  # RESTRICT is the final barrier before any physical IO.
            stage = "physical_delete"
            storage.delete(operation.object_key)
            stage = "completion"
            if not lifecycle.complete_attempt(operation, lease=attempt, now=utc_now()):
                raise ValueError("Retirement completion attempt mismatch")
            db.commit()
        return {"status": "completed", "retirement_uuid": retirement_uuid}
    except Exception as error:
        logger.bind(resource_id=retirement_uuid, attempt=attempt.attempt).opt(exception=True).error(
            "stored_object_retirement.failed"
        )
        with sessions() as db:
            retirement_delivery.fail(db, attempt, error, stage=stage)
            db.commit()
        return {"status": "failed", "retirement_uuid": retirement_uuid}

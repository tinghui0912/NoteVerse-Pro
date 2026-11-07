"""Explicit worker execution after a unit/application semantic transaction commits."""

from contextlib import contextmanager
from unittest.mock import patch
from sqlalchemy import select
from app.db.models import StoredObjectRetirement
from app.worker.execution import stored_object_retirement as worker
from app.utils.timezone import utc_now_naive


def drain_retirements(db, storage):
    uuids = list(
        db.scalars(
            select(StoredObjectRetirement.retirement_uuid).where(
                StoredObjectRetirement.status.in_(["PENDING", "FAILED"]),
                StoredObjectRetirement.next_attempt_at <= utc_now_naive(),
            )
        )
    )

    @contextmanager
    def transaction():
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise

    with (
        patch.object(worker, "get_worker_db", transaction),
        patch.object(worker, "object_storage", storage),
    ):
        return [worker.execute_stored_object_retirement_task(None, uuid) for uuid in uuids]

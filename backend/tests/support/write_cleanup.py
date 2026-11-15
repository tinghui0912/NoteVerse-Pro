"""Explicitly settle expired test writes through the real cleanup execution path."""

from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import patch
from sqlalchemy import select
from app.db.models import ObjectWriteIntent
from app.modules.storage_objects.writes import write_cleanup_delivery
from app.worker.execution import object_write_cleanup as worker
from app.utils.timezone import utc_now_naive


def drain_write_cleanup(db, storage):
    for row in db.scalars(
        select(ObjectWriteIntent).where(ObjectWriteIntent.status.in_(["PREPARED", "WRITTEN"]))
    ):
        row.write_expires_at = utc_now_naive() - timedelta(seconds=1)
    db.commit()
    due = write_cleanup_delivery.recover_and_list_due(db)
    db.commit()

    @contextmanager
    def transaction():
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise

    with (
        patch.object(worker, "SessionLocal", transaction),
        patch.object(worker, "object_storage", storage),
    ):
        return [worker.execute_object_write_cleanup_task(None, uuid) for uuid in due]

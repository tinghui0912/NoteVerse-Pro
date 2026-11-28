"""Explicitly settle expired test writes through the real cleanup execution path."""

from contextlib import contextmanager
from datetime import timedelta
from tests.support.worker_context import patch_worker
from sqlalchemy import select
from app.db.models import ObjectWriteIntent
from app.worker.execution import object_write_cleanup as worker
from app.shared.time import utc_now
from tests.support.runtime_resources import deliveries


def drain_write_cleanup(db, storage):
    for row in db.scalars(
        select(ObjectWriteIntent).where(ObjectWriteIntent.status.in_(["PREPARED", "WRITTEN"]))
    ):
        row.write_expires_at = utc_now() - timedelta(seconds=1)
    db.commit()
    due = deliveries().write_cleanup.recover_and_list_due(db)
    db.commit()

    @contextmanager
    def transaction():
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise

    with patch_worker(worker, sessions=transaction, storage=storage):
        return [worker.execute_object_write_cleanup_task(None, uuid) for uuid in due]

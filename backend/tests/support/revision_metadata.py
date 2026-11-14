"""Run the actual metadata worker for admitted revision work in application tests."""

from contextlib import contextmanager
from unittest.mock import patch
from sqlalchemy import select
from app.db.models import RevisionMetadataOutbox
from app.worker.execution import revision_metadata as worker


def drain_revision_metadata(db, storage):
    identities = list(
        db.scalars(
            select(RevisionMetadataOutbox.outbox_uuid).where(
                RevisionMetadataOutbox.status.in_(["PENDING", "DISPATCHED"])
            )
        )
    )
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
        patch.object(worker, "get_worker_db", transaction),
        patch.object(worker, "object_storage", storage),
    ):
        return [worker.execute_revision_metadata_task(None, uuid) for uuid in identities]

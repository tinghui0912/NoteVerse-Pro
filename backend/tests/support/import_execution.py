"""Create a current processing lease for focused worker-mutation fixtures."""

from uuid import uuid4
from sqlalchemy import select
from app.db.models import ImportDispatch, ImportDispatchStatus
from app.modules.import_jobs.dispatch_service import ImportExecutionLease
from app.shared.time import utc_now


def processing_lease(db, job):
    row = db.scalar(select(ImportDispatch).where(ImportDispatch.job_id == job.id))
    if row is None:
        row = ImportDispatch(
            job_id=job.id,
            status=ImportDispatchStatus.PROCESSING,
            attempt_count=1,
            attempt_token=str(uuid4()),
            started_at=utc_now(),
        )
        db.add(row)
        db.commit()
    assert row.status == ImportDispatchStatus.PROCESSING
    return ImportExecutionLease(
        dispatch_uuid=row.dispatch_uuid,
        job_uuid=job.job_uuid,
        attempt=row.attempt_count,
        token=row.attempt_token,
    )

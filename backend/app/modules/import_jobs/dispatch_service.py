"""Import delivery admission, execution fencing and domain recovery effects.

Every path locking both records locks ImportDispatch before ImportJob.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import cast
from uuid import uuid4
from sqlalchemy import select, delete
from sqlalchemy.orm import Session
from sqlmodel import col
from app.core.config import settings
from app.db.models import (
    ImportDispatch,
    ImportDispatchStatus,
    ImportJob,
    ImportJobUpload,
    ImportJobStep,
    StoredObject,
    Upload,
)
from app.db.models.import_job import ImportJobState
from app.modules.async_operations.durable_delivery import (
    DurableDeliveryLifecycle,
    DeliveryStatuses,
    DeliveryLifecyclePolicy,
    ClaimAdmission,
)
from app.modules.async_operations.diagnostics import (
    AsyncOperationKindValue,
    AsyncOperationStatusValue,
    apply_async_diagnostic,
    clear_async_diagnostic,
)
from app.modules.import_jobs.schemas import ImportJobProcessingOptions
from app.modules.domain_events.journal import append_fact
from app.modules.import_jobs.events import ImportJobFailed
from app.modules.import_jobs.public_errors import public_import_job_error
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive

TERMINAL_IMPORT_STATES = {
    ImportJobState.PENDING_REVIEW,
    ImportJobState.FAILURE,
    ImportJobState.CONFIRMED,
}


def import_delivery_exhausted(dispatch: ImportDispatch) -> bool:
    return (
        dispatch.status == ImportDispatchStatus.FAILED
        and dispatch.attempt_count >= settings.IMPORT_DISPATCH_MAX_ATTEMPTS
    )


@dataclass(frozen=True)
class ImportExecutionLease:
    dispatch_uuid: str
    job_uuid: str
    attempt: int
    token: str


class StaleImportDispatchAttempt(RuntimeError):
    """This worker no longer owns the Import execution attempt."""


def lock_dispatch(db: Session, dispatch_uuid: str) -> ImportDispatch | None:
    with db.no_autoflush:
        return db.scalar(
            select(ImportDispatch)
            .where(ImportDispatch.dispatch_uuid == dispatch_uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
        )


def lock_dispatch_job(db: Session, dispatch: ImportDispatch) -> ImportJob:
    with db.no_autoflush:
        job = db.scalar(
            select(ImportJob)
            .where(ImportJob.id == dispatch.job_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    if job is None:
        raise StaleImportDispatchAttempt("Import job is no longer available")
    return job


def require_current_attempt(db: Session, lease: ImportExecutionLease) -> ImportJob:
    dispatch = lock_dispatch(db, lease.dispatch_uuid)
    if (
        dispatch is None
        or dispatch.status != ImportDispatchStatus.PROCESSING
        or dispatch.attempt_count != lease.attempt
        or dispatch.attempt_token != lease.token
    ):
        raise StaleImportDispatchAttempt("Import execution lease is stale")
    job = lock_dispatch_job(db, dispatch)
    if job.job_uuid != lease.job_uuid:
        raise StaleImportDispatchAttempt("Import execution lease belongs to another job")
    return job


@dataclass(frozen=True)
class ImportDispatchPayload:
    lease: ImportExecutionLease
    job_uuid: str
    storage_keys: list[str]
    options: ImportJobProcessingOptions | None
    attempt: int
    max_attempts: int
    originating_request_id: str | None = None
    traceparent: str | None = None
    tracestate: str | None = None


class ImportDispatchService:
    @staticmethod
    def lifecycle() -> DurableDeliveryLifecycle[ImportDispatchStatus]:
        return DurableDeliveryLifecycle(
            statuses=DeliveryStatuses(
                pending=ImportDispatchStatus.PENDING,
                dispatched=ImportDispatchStatus.DISPATCHED,
                processing=ImportDispatchStatus.PROCESSING,
                failed=ImportDispatchStatus.FAILED,
                succeeded=ImportDispatchStatus.COMPLETED,
            ),
            policy=DeliveryLifecyclePolicy(
                max_attempts=settings.IMPORT_DISPATCH_MAX_ATTEMPTS,
                retry_base_seconds=settings.IMPORT_DISPATCH_INTERVAL_SECONDS,
                dispatch_timeout_seconds=settings.IMPORT_DISPATCH_TIMEOUT_SECONDS,
                processing_timeout_seconds=settings.IMPORT_PROCESSING_TIMEOUT_SECONDS,
            ),
        )

    def mark_dispatched(self, db: Session, dispatch_uuid: str) -> bool:
        row = lock_dispatch(db, dispatch_uuid)
        if (
            row is None
            or row.status == ImportDispatchStatus.COMPLETED
            or import_delivery_exhausted(row)
        ):
            return False
        job = lock_dispatch_job(db, row)
        if job.state in TERMINAL_IMPORT_STATES:
            self._reconcile_terminal_attempt(row, now=utc_now_naive())
            return False
        if job.state != ImportJobState.PENDING or not self.lifecycle().dispatch(
            row, now=utc_now_naive()
        ):
            return False
        clear_async_diagnostic(row)
        return True

    def claim(self, db: Session, dispatch_uuid: str) -> ImportDispatchPayload | None:
        row = lock_dispatch(db, dispatch_uuid)
        if (
            row is None
            or row.status == ImportDispatchStatus.COMPLETED
            or import_delivery_exhausted(row)
        ):
            return None
        lifecycle, now = self.lifecycle(), utc_now_naive()
        job = lock_dispatch_job(db, row)
        if job.state in TERMINAL_IMPORT_STATES:
            self._reconcile_terminal_attempt(row, now=now)
            return None
        admission = lifecycle.claim_admission(row, now=now)
        if admission is ClaimAdmission.INACTIVE or admission is ClaimAdmission.NOT_DUE:
            return None
        if admission is ClaimAdmission.EXHAUSTED:
            self._exhaust(db, row, job, "Import worker delivery attempts exhausted", now)
            return None
        if job.state != ImportJobState.PENDING:
            return None
        keys = db.scalars(
            select(StoredObject.object_key)
            .select_from(ImportJobUpload)
            .join(Upload, ImportJobUpload.upload_id == Upload.id)
            .join(StoredObject, Upload.stored_object_id == StoredObject.id)
            .where(ImportJobUpload.job_id == job.id)
            .order_by(col(ImportJobUpload.sort_order).asc(), col(ImportJobUpload.id).asc())
        ).all()
        if not keys:
            self._exhaust(db, row, job, "Import job has no persisted uploads", now)
            return None
        claimed = lifecycle.claim(row, now=now)
        assert claimed
        row.attempt_token = str(uuid4())
        clear_async_diagnostic(row)
        lease = ImportExecutionLease(
            row.dispatch_uuid, job.job_uuid, row.attempt_count, row.attempt_token
        )
        return ImportDispatchPayload(
            lease,
            job.job_uuid,
            list(keys),
            cast(ImportJobProcessingOptions, job.requested_options)
            if isinstance(job.requested_options, dict)
            else None,
            row.attempt_count,
            lifecycle.policy.max_attempts,
            row.originating_request_id,
            row.traceparent,
            row.tracestate,
        )

    def _reconcile_terminal_attempt(self, row: ImportDispatch, *, now: datetime) -> None:
        # Only an in-flight command can be reconciled with its durable domain outcome.
        if row.status in (ImportDispatchStatus.DISPATCHED, ImportDispatchStatus.PROCESSING):
            self.lifecycle().complete(row, now=now)
            row.attempt_token = None
            clear_async_diagnostic(row)

    def complete(self, db: Session, lease: ImportExecutionLease) -> None:
        job = require_current_attempt(db, lease)
        if job.state not in TERMINAL_IMPORT_STATES:
            raise ValueError("Import delivery requires a durable domain outcome")
        row = db.scalar(
            select(ImportDispatch).where(ImportDispatch.dispatch_uuid == lease.dispatch_uuid)
        )
        assert row is not None
        completed = self.lifecycle().complete_attempt(
            row, expected_attempt=lease.attempt, now=utc_now_naive()
        )
        assert completed
        row.attempt_token = None
        clear_async_diagnostic(row)

    def release_dispatch(self, db: Session, dispatch_uuid: str, error: str) -> None:
        row = lock_dispatch(db, dispatch_uuid)
        if row is not None and self.lifecycle().release_dispatch(
            row, error=error, now=utc_now_naive()
        ):
            self._diagnose(row, AsyncOperationStatusValue.QUEUED)

    def recover_and_list_due(self, db: Session) -> list[str]:
        lifecycle, now = self.lifecycle(), utc_now_naive()
        active = db.scalars(
            select(ImportDispatch)
            .where(
                col(ImportDispatch.status).in_(
                    [ImportDispatchStatus.DISPATCHED, ImportDispatchStatus.PROCESSING]
                )
            )
            .order_by(ImportDispatch.id)
            .with_for_update(skip_locked=True)
        ).all()
        for row in active:
            job = lock_dispatch_job(db, row)
            was_processing = row.status == ImportDispatchStatus.PROCESSING
            if not lifecycle.recover_lease(row, error="Import delivery lease expired", now=now):
                continue
            row.attempt_token = None
            if job.state in TERMINAL_IMPORT_STATES:
                lifecycle.complete(row, now=now)
                clear_async_diagnostic(row)
            elif row.attempt_count >= lifecycle.policy.max_attempts:
                self._exhaust(db, row, job, "Import worker delivery attempts exhausted", now)
            else:
                if was_processing:
                    self.reset_execution(db, job, now)
                self._diagnose(row, AsyncOperationStatusValue.RETRYING)
        # Admission is per delivery, not a batch mutation performed by this scan.
        due = db.scalars(
            select(ImportDispatch.dispatch_uuid)
            .join(ImportJob, ImportJob.id == ImportDispatch.job_id)
            .where(
                ImportJob.state == ImportJobState.PENDING,
                col(ImportDispatch.status).in_(
                    [ImportDispatchStatus.PENDING, ImportDispatchStatus.FAILED]
                ),
                ImportDispatch.next_attempt_at <= now,
                ImportDispatch.attempt_count < lifecycle.policy.max_attempts,
            )
            .order_by(ImportDispatch.created_at, ImportDispatch.id)
            .limit(settings.IMPORT_DISPATCH_BATCH_SIZE)
            .with_for_update(of=ImportDispatch, skip_locked=True)
        ).all()
        db.commit()
        return list(due)

    @staticmethod
    def reset_execution(db: Session, job: ImportJob, now: datetime) -> None:
        job.state = ImportJobState.PENDING
        job.progress = 0
        job.current_step = None
        job.started_at = job.last_heartbeat_at = job.finished_at = None
        job.code = job.error = job.error_type = None
        clear_async_diagnostic(job)
        job.updated_at = now
        db.execute(delete(ImportJobStep).where(ImportJobStep.job_id == job.id))

    def _exhaust(
        self, db: Session, row: ImportDispatch, job: ImportJob, error: str, now: datetime
    ) -> None:
        self.lifecycle().exhaust(row, error=error, now=now)
        row.attempt_token = None
        self._diagnose(row, AsyncOperationStatusValue.EXHAUSTED)
        if job.state not in TERMINAL_IMPORT_STATES:
            job.state = ImportJobState.FAILURE
            job.code = job.error = ErrorCode.FEATURE_TEMPORARILY_UNAVAILABLE
            job.error_type = "ImportDispatchFailure"
            job.finished_at = job.updated_at = now
            apply_async_diagnostic(
                job,
                kind=AsyncOperationKindValue.IMPORT,
                status=AsyncOperationStatusValue.FAILED,
                raw_status=job.state.value,
                last_error=job.error,
                attempts=row.attempt_count,
                max_attempts=None,
            )
            public_code, _ = public_import_job_error(job)
            append_fact(
                db,
                ImportJobFailed(
                    job_id=job.job_uuid,
                    recipient_user_id=job.user_id,
                    public_failure_code=public_code,
                ),
                occurred_at=now,
            )

    @staticmethod
    def _diagnose(row: ImportDispatch, status: AsyncOperationStatusValue) -> None:
        apply_async_diagnostic(
            row,
            kind=AsyncOperationKindValue.IMPORT,
            status=status,
            raw_status=row.status.value,
            last_error=row.last_error,
            attempts=row.attempt_count,
            max_attempts=settings.IMPORT_DISPATCH_MAX_ATTEMPTS,
        )


import_dispatch_service = ImportDispatchService()

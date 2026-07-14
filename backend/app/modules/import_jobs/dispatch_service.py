from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import ImportDispatchStatus, ImportJob, ImportJobUpload, StorageBlob, Upload
from app.db.models.import_job import ImportJobState
from app.modules.import_jobs.schemas import ImportJobProcessingOptions
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class ImportDispatchPayload:
    job_uuid: str
    storage_keys: list[str]
    options: ImportJobProcessingOptions | None


class ImportDispatchService:
    def claim(self, db: Session, job_uuid: str) -> ImportDispatchPayload | None:
        job = db.execute(
            select(ImportJob)
            .where(ImportJob.job_uuid == job_uuid)
            .with_for_update()
        ).scalar_one_or_none()
        if job is None or job.dispatch_status in {
            ImportDispatchStatus.PROCESSING,
            ImportDispatchStatus.COMPLETED,
        }:
            return None
        if job.state != ImportJobState.PENDING:
            return None
        if job.dispatch_attempt_count >= settings.IMPORT_DISPATCH_MAX_ATTEMPTS:
            return None
        if (
            job.dispatch_status == ImportDispatchStatus.FAILED
            and job.next_dispatch_at > utc_now_naive()
        ):
            return None

        storage_keys = db.execute(
            select(StorageBlob.storage_key)
            .join(ImportJobUpload, ImportJobUpload.upload_id == Upload.id)
            .join(StorageBlob, Upload.blob_id == StorageBlob.id)
            .where(ImportJobUpload.job_id == job.id)
            .order_by(ImportJobUpload.sort_order.asc(), ImportJobUpload.id.asc())
        ).scalars().all()
        if not storage_keys:
            self._terminal_failure(job, "Import job has no persisted uploads")
            return None

        now = utc_now_naive()
        job.dispatch_status = ImportDispatchStatus.PROCESSING
        job.dispatch_attempt_count += 1
        job.dispatch_started_at = now
        job.dispatch_error = None
        job.updated_at = now
        options = job.requested_options if isinstance(job.requested_options, dict) else None
        return ImportDispatchPayload(
            job_uuid=job.job_uuid,
            storage_keys=list(storage_keys),
            options=options,  # type: ignore[arg-type]
        )

    def complete(self, db: Session, job_uuid: str) -> None:
        job = self._get(db, job_uuid)
        if job is None:
            return
        now = utc_now_naive()
        job.dispatch_status = ImportDispatchStatus.COMPLETED
        job.dispatch_completed_at = now
        job.dispatch_error = None
        job.updated_at = now

    def release_dispatch(self, db: Session, job_uuid: str, error: str) -> None:
        job = self._get(db, job_uuid)
        if job is None or job.dispatch_status != ImportDispatchStatus.DISPATCHED:
            return
        job.dispatch_status = ImportDispatchStatus.PENDING
        job.dispatched_at = None
        job.publish_attempt_count += 1
        delay_seconds = min(300, 2 ** min(job.publish_attempt_count, 8))
        job.next_dispatch_at = utc_now_naive() + timedelta(seconds=delay_seconds)
        job.dispatch_error = error[:4000]
        job.updated_at = utc_now_naive()

    def recover_and_claim_due(self, db: Session) -> list[str]:
        now = utc_now_naive()
        dispatch_cutoff = now - timedelta(seconds=settings.IMPORT_DISPATCH_TIMEOUT_SECONDS)
        processing_cutoff = now - timedelta(seconds=settings.IMPORT_PROCESSING_TIMEOUT_SECONDS)
        active = db.execute(
            select(ImportJob).where(
                ImportJob.dispatch_status.in_([
                    ImportDispatchStatus.DISPATCHED,
                    ImportDispatchStatus.PROCESSING,
                ])
            )
        ).scalars().all()
        for job in active:
            stale_dispatch = (
                job.dispatch_status == ImportDispatchStatus.DISPATCHED
                and job.dispatched_at is not None
                and job.dispatched_at <= dispatch_cutoff
            )
            stale_processing = (
                job.dispatch_status == ImportDispatchStatus.PROCESSING
                and job.dispatch_started_at is not None
                and job.dispatch_started_at <= processing_cutoff
            )
            if not stale_dispatch and not stale_processing:
                continue
            if job.dispatch_attempt_count >= settings.IMPORT_DISPATCH_MAX_ATTEMPTS:
                self._terminal_failure(job, "Import worker delivery attempts exhausted")
                continue
            job.dispatch_status = ImportDispatchStatus.PENDING
            job.next_dispatch_at = now
            job.dispatched_at = None
            job.dispatch_started_at = None
            job.dispatch_error = "Import delivery lease expired"
            if stale_processing:
                self._reset_pipeline_state(job)
            job.updated_at = now

        due = db.execute(
            select(ImportJob)
            .where(
                ImportJob.state == ImportJobState.PENDING,
                ImportJob.dispatch_status.in_([
                    ImportDispatchStatus.PENDING,
                    ImportDispatchStatus.FAILED,
                ]),
                ImportJob.next_dispatch_at <= now,
                ImportJob.dispatch_attempt_count < settings.IMPORT_DISPATCH_MAX_ATTEMPTS,
            )
            .order_by(ImportJob.created_at)
            .limit(settings.IMPORT_DISPATCH_BATCH_SIZE)
            .with_for_update(skip_locked=True)
        ).scalars().all()
        for job in due:
            job.dispatch_status = ImportDispatchStatus.DISPATCHED
            job.dispatched_at = now
            job.dispatch_error = None
            job.updated_at = now
        db.commit()
        return [job.job_uuid for job in due]

    @staticmethod
    def _get(db: Session, job_uuid: str) -> ImportJob | None:
        return db.execute(
            select(ImportJob).where(ImportJob.job_uuid == job_uuid)
        ).scalar_one_or_none()

    @staticmethod
    def _is_dispatchable(job: ImportJob) -> bool:
        return (
            job.state == ImportJobState.PENDING
            and job.dispatch_status in {
                ImportDispatchStatus.PENDING,
                ImportDispatchStatus.FAILED,
            }
            and job.dispatch_attempt_count < settings.IMPORT_DISPATCH_MAX_ATTEMPTS
            and job.next_dispatch_at <= utc_now_naive()
        )

    @staticmethod
    def _reset_pipeline_state(job: ImportJob) -> None:
        job.state = ImportJobState.PENDING
        job.progress = 0
        job.current_step = None
        job.started_at = None
        job.last_heartbeat_at = None
        job.finished_at = None
        job.code = None
        job.error = None
        job.error_type = None

    @staticmethod
    def _terminal_failure(job: ImportJob, error: str) -> None:
        now = utc_now_naive()
        job.dispatch_status = ImportDispatchStatus.FAILED
        job.state = ImportJobState.FAILURE
        job.code = "external_service_error"
        job.error = error
        job.error_type = "ImportDispatchFailure"
        job.dispatch_error = error
        job.finished_at = now
        job.updated_at = now


import_dispatch_service = ImportDispatchService()

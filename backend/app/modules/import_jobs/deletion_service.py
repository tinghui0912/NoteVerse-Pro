from __future__ import annotations


from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    ImportArtifact,
    ImportDispatch,
    ImportJobState,
    ImportJob,
    ImportJobUpload,
    ScoreInputAsset,
    StoredObject,
    StorageUsageCategory,
    Upload,
)
from app.core.exceptions import (
    ResourceNotFoundException,
    UnauthorizedException,
    ValidationException,
)
from app.shared.error_codes import CustomerErrorCode
from app.db.model_utils import require_persisted_id
from app.modules.storage_usage.service import storage_usage_service
from app.modules.storage_objects.retirement import retire_after_release


CUSTOMER_DELETABLE_IMPORT_JOB_STATES = frozenset(
    {ImportJobState.READY_FOR_REVIEW, ImportJobState.FAILED}
)


class ImportJobDeletionService:
    """Delete import-job rows and their owned temporary storage artifacts."""

    def cleanup_for_account(self, db: Session, user_id: int) -> bool:
        from app.db.models import User

        if db.scalar(select(User.deleted_at).where(User.id == user_id)) is None:
            raise RuntimeError("Account cleanup requires a tombstoned User")
        job = db.scalar(
            select(ImportJob).where(ImportJob.user_id == user_id).order_by(ImportJob.id).limit(1)
        )
        if job is None:
            return False
        self._release(db, job, user_id, delete_job=True, account_erasure=True)
        return True

    def delete_job(self, db: Session, job: ImportJob, user_id: int) -> None:
        """Admit customer deletion of a stopped, unconfirmed job under its locks."""
        self._release(db, job, user_id, delete_job=True)

    def cleanup_binary_artifacts(self, db: Session, job: ImportJob, user_id: int) -> None:
        """Release temporary binaries while retaining the job and its provenance."""
        self._release(db, job, user_id, delete_job=False)

    def _release(self, db, job, user_id, *, delete_job, account_erasure=False):
        # Caller-owned confirmation writes must survive the locked refresh below.
        db.flush()
        job_id = require_persisted_id(job.id, entity="import job")
        # Match worker/recovery lock order before any destructive domain mutation.
        dispatch = (
            db.execute(
                select(ImportDispatch)
                .where(ImportDispatch.job_id == job_id)
                .with_for_update()
                .execution_options(populate_existing=True, autoflush=False)
            )
        ).scalar_one_or_none()
        if dispatch is None:
            raise RuntimeError("Import job requires a durable dispatch")
        job = (
            db.execute(
                select(ImportJob)
                .where(ImportJob.id == dispatch.job_id)
                .with_for_update()
                .execution_options(populate_existing=True, autoflush=False)
            )
        ).scalar_one_or_none()
        if job is None:
            raise ResourceNotFoundException(
                "job", str(job_id), code=CustomerErrorCode.JOB_NOT_FOUND
            )
        if job.user_id != user_id:
            raise UnauthorizedException(
                code=CustomerErrorCode.NO_ACCESS, details={"job_id": job.job_uuid}
            )
        if delete_job and not account_erasure:
            if job.state not in CUSTOMER_DELETABLE_IMPORT_JOB_STATES:
                raise ValidationException(
                    code=CustomerErrorCode.JOB_RUNNING
                    if job.state == ImportJobState.PROCESSING
                    else CustomerErrorCode.VALIDATION_ERROR,
                    field="state",
                )
        elif not account_erasure and job.state == ImportJobState.PROCESSING:
            raise ValidationException(code=CustomerErrorCode.JOB_RUNNING, field="state")
        storage_usage_service.committed_bytes(db, user_id, lock=True)
        uploads = self._orphan_uploads_after_job_delete(db, job_id)
        if any(upload.uploader_user_id != user_id for upload, _ in uploads):
            raise RuntimeError("Import Upload ownership disagrees with its Job")
        artifacts = list(
            (db.execute(select(ImportArtifact).where(ImportArtifact.job_id == job_id))).scalars()
        )
        ids = [item.stored_object_id for item in artifacts] + [
            upload.stored_object_id for upload, _ in uploads
        ]
        releases = [
            (
                StorageUsageCategory.TEMP_IMPORT,
                "import_artifact",
                item.artifact_uuid,
                item.stored_object.object_key,
                item.stored_object.byte_size,
            )
            for item in artifacts
        ]
        releases += [
            (
                StorageUsageCategory.UPLOAD,
                "upload",
                upload.upload_uuid,
                obj.object_key,
                obj.byte_size,
            )
            for upload, obj in uploads
        ]
        if delete_job:
            db.delete(job)
        else:
            db.execute(sa_delete(ImportArtifact).where(ImportArtifact.job_id == job_id))
            db.execute(sa_delete(ImportJobUpload).where(ImportJobUpload.job_id == job_id))
        db.flush()
        for upload, _ in uploads:
            db.delete(upload)
        for category, kind, identity, key, size in releases:
            storage_usage_service.record_release(
                db,
                user_id=user_id,
                category=category,
                bytes_count=size,
                reason="import_job_deleted",
                object_type=kind,
                object_id=identity,
                storage_key=key,
            )

        retire_after_release(db, *ids)

    def _orphan_uploads_after_job_delete(
        self, db: Session, job_id: int
    ) -> list[tuple[Upload, StoredObject]]:
        rows = list(
            db.execute(
                select(Upload, StoredObject)
                .join(ImportJobUpload, ImportJobUpload.upload_id == Upload.id)
                .join(StoredObject, Upload.stored_object_id == StoredObject.id)
                .where(ImportJobUpload.job_id == job_id)
                .order_by(Upload.id)
                .with_for_update(of=Upload)
            ).all()
        )
        ids = [upload.id for upload, _ in rows]
        other_jobs = set(
            db.scalars(
                select(ImportJobUpload.upload_id)
                .where(ImportJobUpload.upload_id.in_(ids), ImportJobUpload.job_id != job_id)
                .distinct()
            )
        )
        inputs = set(
            db.scalars(
                select(ScoreInputAsset.upload_id)
                .where(ScoreInputAsset.upload_id.in_(ids))
                .distinct()
            )
        )
        return [
            (upload, blob)
            for upload, blob in rows
            if upload.id not in other_jobs and upload.id not in inputs
        ]

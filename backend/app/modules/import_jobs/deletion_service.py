from __future__ import annotations


from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

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
from app.shared.constants import ErrorCode
from app.db.model_utils import require_persisted_id
from app.modules.storage_usage.service import storage_usage_service
from app.modules.storage_objects.retirement import retire_after_release


CUSTOMER_DELETABLE_IMPORT_JOB_STATES = frozenset(
    {ImportJobState.PENDING_REVIEW, ImportJobState.FAILURE}
)


class ImportJobDeletionService:
    """Delete import-job rows and their owned temporary storage artifacts."""

    async def delete_job(self, db: AsyncSession, job: ImportJob, user_id: int) -> None:
        """Admit customer deletion of a stopped, unconfirmed job under its locks."""
        await self._release(db, job, user_id, delete_job=True)

    async def cleanup_binary_artifacts(
        self, db: AsyncSession, job: ImportJob, user_id: int
    ) -> None:
        """Release temporary binaries while retaining the job and its provenance."""
        await self._release(db, job, user_id, delete_job=False)

    async def _release(self, db, job, user_id, *, delete_job):
        # Caller-owned confirmation writes must survive the locked refresh below.
        await db.flush()
        job_id = require_persisted_id(job.id, entity="import job")
        # Match worker/recovery lock order before any destructive domain mutation.
        dispatch = (
            await db.execute(
                select(ImportDispatch)
                .where(ImportDispatch.job_id == job_id)
                .with_for_update()
                .execution_options(populate_existing=True, autoflush=False)
            )
        ).scalar_one_or_none()
        if dispatch is None:
            raise RuntimeError("Import job requires a durable dispatch")
        job = (
            await db.execute(
                select(ImportJob)
                .where(ImportJob.id == dispatch.job_id)
                .with_for_update()
                .execution_options(populate_existing=True, autoflush=False)
            )
        ).scalar_one_or_none()
        if job is None:
            raise ResourceNotFoundException("job", str(job_id), code=ErrorCode.JOB_NOT_FOUND)
        if job.user_id != user_id:
            raise UnauthorizedException(code=ErrorCode.NO_ACCESS, details={"job_id": job.job_uuid})
        if delete_job:
            if job.state not in CUSTOMER_DELETABLE_IMPORT_JOB_STATES:
                raise ValidationException(
                    code=ErrorCode.JOB_RUNNING
                    if job.state == ImportJobState.RUNNING
                    else ErrorCode.VALIDATION_ERROR,
                    field="state",
                )
        elif job.state == ImportJobState.RUNNING:
            raise ValidationException(code=ErrorCode.JOB_RUNNING, field="state")
        uploads = await self._orphan_uploads_after_job_delete(db, job_id)
        artifacts = list(
            (
                await db.execute(select(ImportArtifact).where(ImportArtifact.job_id == job_id))
            ).scalars()
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
            await db.delete(job)
        else:
            await db.execute(sa_delete(ImportArtifact).where(ImportArtifact.job_id == job_id))
            await db.execute(sa_delete(ImportJobUpload).where(ImportJobUpload.job_id == job_id))
        await db.flush()
        for upload, _ in uploads:
            await db.delete(upload)
        await retire_after_release(db, *ids)
        for category, kind, identity, key, size in releases:
            await storage_usage_service.record_release(
                db,
                user_id=user_id,
                category=category,
                bytes_count=size,
                reason="import_job_deleted",
                object_type=kind,
                object_id=identity,
                storage_key=key,
                auto_commit=False,
            )

    async def _orphan_uploads_after_job_delete(
        self,
        db: AsyncSession,
        job_id: int,
    ) -> list[tuple[Upload, StoredObject]]:
        uploads = list(
            (
                await db.execute(
                    select(Upload, StoredObject)
                    .join(ImportJobUpload, ImportJobUpload.upload_id == Upload.id)
                    .join(StoredObject, Upload.stored_object_id == StoredObject.id)
                    .where(ImportJobUpload.job_id == job_id)
                )
            ).all()
        )
        orphan_uploads: list[tuple[Upload, StoredObject]] = []
        for upload, _blob in uploads:
            upload_id = require_persisted_id(upload.id, entity="upload")
            ref_count = (
                await db.execute(
                    select(func.count(ImportJobUpload.id)).where(
                        ImportJobUpload.upload_id == upload_id,
                        ImportJobUpload.job_id != job_id,
                    )
                )
            ).scalar_one()
            input_ref_count = (
                await db.execute(
                    select(func.count(ScoreInputAsset.id)).where(
                        ScoreInputAsset.upload_id == upload_id,
                    )
                )
            ).scalar_one()
            if ref_count == 0 and input_ref_count == 0:
                orphan_uploads.append((upload, _blob))
        return orphan_uploads

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    ImportArtifact,
    ImportJob,
    ImportJobUpload,
    ScoreInputAsset,
    StorageBlob,
    StorageUsageCategory,
    Upload,
)
from app.db.model_utils import require_persisted_id
from app.modules.storage_usage.service import storage_usage_service
from app.storage import FileStorage, file_storage


@dataclass(frozen=True)
class StoredObjectCleanup:
    category: StorageUsageCategory
    object_type: str
    object_id: str
    storage_key: str
    bytes_count: int
    reason: str
    delete_storage: bool = True


class ImportJobDeletionService:
    """Delete import-job rows and their owned temporary storage artifacts."""

    def __init__(self, storage: FileStorage | None = None) -> None:
        self.storage = storage or file_storage

    async def delete_job(self, db: AsyncSession, job: ImportJob, user_id: int) -> None:
        job_id = require_persisted_id(job.id, entity="import job")
        orphan_uploads = await self._orphan_uploads_after_job_delete(db, job_id)
        cleanup_objects = await self._collect_delete_cleanup_objects(db, job_id, orphan_uploads)
        blob_ids_to_delete = self._blob_ids_to_delete(orphan_uploads, cleanup_objects)
        await db.delete(job)
        await db.flush()
        await self._delete_orphan_upload_rows(db, orphan_uploads)
        await self._delete_orphan_blob_rows(db, blob_ids_to_delete)
        await db.commit()
        await self._delete_storage_and_release_usage(db, user_id, cleanup_objects)

    async def cleanup_binary_artifacts(
        self,
        db: AsyncSession,
        job: ImportJob,
        user_id: int,
    ) -> None:
        job_id = require_persisted_id(job.id, entity="import job")
        orphan_uploads = await self._orphan_uploads_after_job_delete(db, job_id)
        cleanup_objects = await self._collect_delete_cleanup_objects(db, job_id, orphan_uploads)
        blob_ids_to_delete = self._blob_ids_to_delete(orphan_uploads, cleanup_objects)
        await db.execute(sa_delete(ImportArtifact).where(ImportArtifact.job_id == job_id))
        await db.execute(sa_delete(ImportJobUpload).where(ImportJobUpload.job_id == job_id))
        await db.flush()
        await self._delete_orphan_upload_rows(db, orphan_uploads)
        await self._delete_orphan_blob_rows(db, blob_ids_to_delete)
        await db.commit()
        await self._delete_storage_and_release_usage(db, user_id, cleanup_objects)

    async def _collect_delete_cleanup_objects(
        self,
        db: AsyncSession,
        job_id: int,
        orphan_uploads: list[tuple[Upload, StorageBlob]],
    ) -> list[StoredObjectCleanup]:
        artifacts = list(
            (
                await db.execute(
                    select(ImportArtifact).where(ImportArtifact.job_id == job_id)
                )
            )
            .scalars()
            .all()
        )
        cleanup_objects = [
            StoredObjectCleanup(
                category=StorageUsageCategory.TEMP_IMPORT,
                object_type="import_artifact",
                object_id=artifact.artifact_uuid,
                storage_key=artifact.storage_key,
                bytes_count=artifact.size_bytes or 0,
                reason="import_job_deleted",
            )
            for artifact in artifacts
        ]
        cleanup_objects.extend(
            StoredObjectCleanup(
                category=StorageUsageCategory.UPLOAD,
                object_type="upload",
                object_id=upload.upload_uuid,
                storage_key=blob.storage_key,
                bytes_count=blob.size_bytes,
                reason="import_job_deleted",
                delete_storage=False,
            )
            for upload, blob in orphan_uploads
        )
        seen_blob_ids: set[int] = set()
        for _upload, blob in orphan_uploads:
            blob_id = require_persisted_id(blob.id, entity="storage blob")
            if blob_id in seen_blob_ids:
                continue
            seen_blob_ids.add(blob_id)
            blob_ref_count = (
                await db.execute(select(func.count(Upload.id)).where(Upload.blob_id == blob_id))
            ).scalar_one()
            orphan_count = sum(
                1 for _candidate_upload, candidate_blob in orphan_uploads if candidate_blob.id == blob_id
            )
            if blob_ref_count <= orphan_count:
                cleanup_objects.append(
                    StoredObjectCleanup(
                        category=StorageUsageCategory.UPLOAD,
                        object_type="storage_blob",
                        object_id=blob.blob_uuid,
                        storage_key=blob.storage_key,
                        bytes_count=0,
                        reason="orphan_blob_deleted",
                        delete_storage=True,
                    )
                )
        return cleanup_objects

    async def _orphan_uploads_after_job_delete(
        self,
        db: AsyncSession,
        job_id: int,
    ) -> list[tuple[Upload, StorageBlob]]:
        uploads = list(
            (
                await db.execute(
                    select(Upload, StorageBlob)
                    .join(ImportJobUpload, ImportJobUpload.upload_id == Upload.id)
                    .join(StorageBlob, Upload.blob_id == StorageBlob.id)
                    .where(ImportJobUpload.job_id == job_id)
                )
            )
            .all()
        )
        orphan_uploads: list[tuple[Upload, StorageBlob]] = []
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

    @staticmethod
    def _blob_ids_to_delete(
        orphan_uploads: list[tuple[Upload, StorageBlob]],
        cleanup_objects: list[StoredObjectCleanup],
    ) -> set[int]:
        return {
            require_persisted_id(blob.id, entity="storage blob")
            for _upload, blob in orphan_uploads
            if any(
                item.object_type == "storage_blob" and item.object_id == blob.blob_uuid
                for item in cleanup_objects
            )
        }

    @staticmethod
    async def _delete_orphan_upload_rows(
        db: AsyncSession,
        orphan_uploads: list[tuple[Upload, StorageBlob]],
    ) -> None:
        for upload, _blob in orphan_uploads:
            await db.delete(upload)
        await db.flush()

    @staticmethod
    async def _delete_orphan_blob_rows(db: AsyncSession, blob_ids: set[int]) -> None:
        for blob_id in blob_ids:
            blob = await db.get(StorageBlob, blob_id)
            if blob is not None:
                await db.delete(blob)

    async def _delete_storage_and_release_usage(
        self,
        db: AsyncSession,
        user_id: int,
        cleanup_objects: list[StoredObjectCleanup],
    ) -> None:
        for cleanup_object in cleanup_objects:
            if cleanup_object.delete_storage:
                self.storage.delete(cleanup_object.storage_key)
            await storage_usage_service.record_release(
                db,
                user_id=user_id,
                category=cleanup_object.category,
                bytes_count=cleanup_object.bytes_count,
                reason=cleanup_object.reason,
                object_type=cleanup_object.object_type,
                object_id=cleanup_object.object_id,
                storage_key=cleanup_object.storage_key,
            )

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
    StoredObject,
    StorageUsageCategory,
    Upload,
)
from app.db.model_utils import require_persisted_id
from app.modules.storage_usage.service import storage_usage_service
from app.storage import ObjectStorage, object_storage


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

    def __init__(self, storage: ObjectStorage | None = None) -> None:
        self.storage = storage or object_storage

    async def delete_job(self, db: AsyncSession, job: ImportJob, user_id: int) -> None:
        job_id = require_persisted_id(job.id, entity="import job")
        orphan_uploads = await self._orphan_uploads_after_job_delete(db, job_id)
        cleanup_objects = await self._collect_delete_cleanup_objects(db, job_id, orphan_uploads)
        object_ids_to_delete = self._object_ids_to_delete(orphan_uploads, cleanup_objects)
        artifacts = list(
            (await db.scalars(select(ImportArtifact).where(ImportArtifact.job_id == job_id))).all()
        )
        await db.delete(job)
        await db.flush()
        for artifact in artifacts:
            await db.delete(artifact.stored_object)
        await self._delete_orphan_upload_rows(db, orphan_uploads)
        await self._delete_orphan_object_rows(db, object_ids_to_delete)
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
        object_ids_to_delete = self._object_ids_to_delete(orphan_uploads, cleanup_objects)
        artifacts = list(
            (await db.scalars(select(ImportArtifact).where(ImportArtifact.job_id == job_id))).all()
        )
        await db.execute(sa_delete(ImportArtifact).where(ImportArtifact.job_id == job_id))
        for artifact in artifacts:
            await db.delete(artifact.stored_object)
        await db.execute(sa_delete(ImportJobUpload).where(ImportJobUpload.job_id == job_id))
        await db.flush()
        await self._delete_orphan_upload_rows(db, orphan_uploads)
        await self._delete_orphan_object_rows(db, object_ids_to_delete)
        await db.commit()
        await self._delete_storage_and_release_usage(db, user_id, cleanup_objects)

    async def _collect_delete_cleanup_objects(
        self,
        db: AsyncSession,
        job_id: int,
        orphan_uploads: list[tuple[Upload, StoredObject]],
    ) -> list[StoredObjectCleanup]:
        artifacts = list(
            (await db.execute(select(ImportArtifact).where(ImportArtifact.job_id == job_id)))
            .scalars()
            .all()
        )
        cleanup_objects = [
            StoredObjectCleanup(
                category=StorageUsageCategory.TEMP_IMPORT,
                object_type="import_artifact",
                object_id=artifact.artifact_uuid,
                storage_key=artifact.stored_object.object_key,
                bytes_count=artifact.stored_object.byte_size or 0,
                reason="import_job_deleted",
            )
            for artifact in artifacts
        ]
        cleanup_objects.extend(
            StoredObjectCleanup(
                category=StorageUsageCategory.UPLOAD,
                object_type="upload",
                object_id=upload.upload_uuid,
                storage_key=blob.object_key,
                bytes_count=blob.byte_size,
                reason="import_job_deleted",
                delete_storage=False,
            )
            for upload, blob in orphan_uploads
        )
        seen_object_ids: set[int] = set()
        for _upload, blob in orphan_uploads:
            stored_object_id = require_persisted_id(blob.id, entity="stored object")
            if stored_object_id in seen_object_ids:
                continue
            seen_object_ids.add(stored_object_id)
            blob_ref_count = (
                await db.execute(
                    select(func.count(Upload.id)).where(Upload.stored_object_id == stored_object_id)
                )
            ).scalar_one()
            orphan_count = sum(
                1
                for _candidate_upload, candidate_blob in orphan_uploads
                if candidate_blob.id == stored_object_id
            )
            if blob_ref_count <= orphan_count:
                cleanup_objects.append(
                    StoredObjectCleanup(
                        category=StorageUsageCategory.UPLOAD,
                        object_type="stored_object",
                        object_id=str(blob.id),
                        storage_key=blob.object_key,
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

    @staticmethod
    def _object_ids_to_delete(
        orphan_uploads: list[tuple[Upload, StoredObject]],
        cleanup_objects: list[StoredObjectCleanup],
    ) -> set[int]:
        return {
            require_persisted_id(blob.id, entity="stored object")
            for _upload, blob in orphan_uploads
            if any(
                item.object_type == "stored_object" and item.object_id == str(blob.id)
                for item in cleanup_objects
            )
        }

    @staticmethod
    async def _delete_orphan_upload_rows(
        db: AsyncSession,
        orphan_uploads: list[tuple[Upload, StoredObject]],
    ) -> None:
        for upload, _blob in orphan_uploads:
            await db.delete(upload)
        await db.flush()

    @staticmethod
    async def _delete_orphan_object_rows(db: AsyncSession, object_ids: set[int]) -> None:
        for stored_object_id in object_ids:
            blob = await db.get(StoredObject, stored_object_id)
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

from __future__ import annotations
from app.modules.storage_objects.retirement import retire_released_objects

from dataclasses import dataclass
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.model_utils import require_persisted_id
from app.db.models import (
    ImportArtifact,
    ImportDispatch,
    ImportJob,
    ImportJobUpload,
    Score,
    ScoreInputAsset,
    ScorePlaybackAsset,
    ScoreRenderAsset,
    ScoreRevision,
    ScoreRevisionSource,
    StoredObject,
    StorageUsageCategory,
    Upload,
)
from app.modules.scores.cleanup_records import StorageUsageReleaseRecord
from app.modules.storage_usage.service import storage_usage_service

from .deletion_delivery import (
    ScoreDeletionDeliveryService,
    ScoreDeletionLease,
    StaleScoreDeletionAttempt,
    require_current_attempt,
)


@dataclass(frozen=True)
class ScoreDeletionResult:
    scores_deleted: int = 0
    object_retirements_queued: int = 0


class ScoreDeletionExecutor:
    """One permitted Score graph cleanup; the caller owns its transaction."""

    def __init__(self, delivery: ScoreDeletionDeliveryService | None = None):
        self.delivery = delivery or ScoreDeletionDeliveryService()

    def execute(self, db: Session, lease: ScoreDeletionLease) -> ScoreDeletionResult:
        operation = require_current_attempt(db, lease)
        score = (
            db.scalar(
                select(Score)
                .where(Score.id == operation.score_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if operation.score_id is not None
            else None
        )
        if score is None:
            if not self.delivery.complete(db, lease):
                raise StaleScoreDeletionAttempt("Deletion attempt lost completion authority")
            operation.score_id = None
            return ScoreDeletionResult()
        if score.score_uuid != operation.score_uuid or score.deleted_at is None:
            raise ValueError("Deletion operation requires its tombstoned Score")
        score_id = require_persisted_id(score.id, entity="score")
        owner_user_id = score.owner_user_id
        originating_job = self._single_score_originating_job(
            db,
            score_id=score_id,
            originating_job_id=score.originating_job_id,
        )
        usage_releases: list[StorageUsageReleaseRecord] = []
        source_rows = list(
            db.execute(
                select(
                    ScoreRevisionSource.source_uuid,
                    StoredObject.object_key,
                    StoredObject.byte_size,
                )
                .join(StoredObject, ScoreRevisionSource.stored_object_id == StoredObject.id)
                .join(
                    ScoreRevision,
                    ScoreRevisionSource.revision_id == ScoreRevision.id,
                )
                .where(ScoreRevision.score_id == score_id)
            ).all()
        )
        usage_releases.extend(
            StorageUsageReleaseRecord(
                category=StorageUsageCategory.SOURCE,
                bytes_count=size_bytes or 0,
                object_type="score_revision_source",
                object_id=source_uuid,
                storage_key=storage_key,
            )
            for source_uuid, storage_key, size_bytes in source_rows
        )
        storage_keys = [storage_key for _, storage_key, _ in source_rows]
        render_rows = list(
            db.execute(
                select(
                    ScoreRenderAsset.asset_uuid,
                    StoredObject.object_key,
                    StoredObject.byte_size,
                )
                .join(StoredObject, ScoreRenderAsset.stored_object_id == StoredObject.id)
                .join(ScoreRevision, ScoreRenderAsset.revision_id == ScoreRevision.id)
                .where(ScoreRevision.score_id == score_id)
            ).all()
        )
        usage_releases.extend(
            StorageUsageReleaseRecord(
                category=StorageUsageCategory.DERIVED_RENDER,
                bytes_count=size_bytes or 0,
                object_type="score_render_asset",
                object_id=asset_uuid,
                storage_key=storage_key,
            )
            for asset_uuid, storage_key, size_bytes in render_rows
        )
        storage_keys.extend(storage_key for _, storage_key, _ in render_rows)
        audio_rows = list(
            db.execute(
                select(
                    ScorePlaybackAsset.asset_uuid,
                    StoredObject.object_key,
                    StoredObject.byte_size,
                )
                .join(StoredObject, ScorePlaybackAsset.stored_object_id == StoredObject.id)
                .join(ScoreRevision, ScorePlaybackAsset.revision_id == ScoreRevision.id)
                .where(ScoreRevision.score_id == score_id)
            ).all()
        )
        usage_releases.extend(
            StorageUsageReleaseRecord(
                category=StorageUsageCategory.DERIVED_AUDIO,
                bytes_count=size_bytes or 0,
                object_type="score_playback_asset",
                object_id=asset_uuid,
                storage_key=storage_key,
            )
            for asset_uuid, storage_key, size_bytes in audio_rows
        )
        storage_keys.extend(storage_key for _, storage_key, _ in audio_rows)
        input_rows = list(
            db.execute(
                select(
                    ScoreInputAsset.asset_uuid,
                    ScoreInputAsset.upload_id,
                    StoredObject.id,
                    StoredObject.object_key,
                    StoredObject.byte_size,
                )
                .join(Upload, ScoreInputAsset.upload_id == Upload.id)
                .join(StoredObject, Upload.stored_object_id == StoredObject.id)
                .where(ScoreInputAsset.score_id == score_id)
            ).all()
        )
        usage_releases.extend(
            StorageUsageReleaseRecord(
                category=StorageUsageCategory.INPUT_ASSET,
                bytes_count=size_bytes or 0,
                object_type="score_input_asset",
                object_id=asset_uuid,
                storage_key=storage_key,
            )
            for asset_uuid, _upload_id, _object_id, storage_key, size_bytes in input_rows
        )
        upload_ids_to_maybe_delete = [upload_id for _asset_uuid, upload_id, *_rest in input_rows]
        objects_by_upload = {
            upload_id: (stored_object_id, storage_key)
            for _asset_uuid, upload_id, stored_object_id, storage_key, _size_bytes in input_rows
        }
        representations = list(
            db.scalars(select(StoredObject).where(StoredObject.object_key.in_(storage_keys)))
        )
        score.head_revision_id = None
        db.delete(score)
        db.flush()
        released_ids = [representation.id for representation in representations]
        for upload_id in upload_ids_to_maybe_delete:
            import_refs = (
                db.execute(
                    select(func.count(ImportJobUpload.id)).where(
                        ImportJobUpload.upload_id == upload_id
                    )
                )
            ).scalar_one()
            input_refs = (
                db.execute(
                    select(func.count(ScoreInputAsset.id)).where(
                        ScoreInputAsset.upload_id == upload_id
                    )
                )
            ).scalar_one()
            if import_refs or input_refs:
                continue
            upload = db.get(Upload, upload_id)
            if upload is None:
                continue
            stored_object_id, object_key = objects_by_upload[upload_id]
            db.delete(upload)
            db.flush()
            released_ids.append(stored_object_id)
        import_cleanup, import_object_ids = self._delete_originating_import_job_sync(
            db,
            originating_job,
        )
        for release in usage_releases:
            storage_usage_service.record_release_sync(
                db,
                user_id=owner_user_id,
                category=release.category,
                bytes_count=release.bytes_count,
                reason="delete_score",
                object_type=release.object_type,
                object_id=release.object_id,
                storage_key=release.storage_key,
            )
        for release in import_cleanup:
            storage_usage_service.record_release_sync(
                db,
                user_id=owner_user_id,
                category=release.category,
                bytes_count=release.bytes_count,
                reason="import_job_deleted",
                object_type=release.object_type,
                object_id=release.object_id,
                storage_key=release.storage_key,
            )
        operations = retire_released_objects(db, *(released_ids + import_object_ids))
        if not self.delivery.complete(db, lease):
            raise StaleScoreDeletionAttempt("Deletion attempt lost completion authority")
        return ScoreDeletionResult(
            scores_deleted=1,
            object_retirements_queued=len(operations),
        )

    def _delete_originating_import_job_sync(
        self,
        db: Session,
        job: ImportJob | None,
    ) -> tuple[list[StorageUsageReleaseRecord], list[int]]:
        if job is None:
            return [], []
        job_id = require_persisted_id(job.id, entity="import job")
        artifact_rows = list(
            db.execute(
                select(
                    ImportArtifact.artifact_uuid,
                    StoredObject.object_key,
                    StoredObject.byte_size,
                )
                .join(StoredObject, ImportArtifact.stored_object_id == StoredObject.id)
                .where(ImportArtifact.job_id == job_id)
            ).all()
        )
        upload_rows = list(
            db.execute(
                select(
                    Upload.id,
                    Upload.upload_uuid,
                    StoredObject.id,
                    StoredObject.object_key,
                    StoredObject.byte_size,
                )
                .join(ImportJobUpload, ImportJobUpload.upload_id == Upload.id)
                .join(StoredObject, Upload.stored_object_id == StoredObject.id)
                .where(ImportJobUpload.job_id == job_id)
            ).all()
        )
        cleanup: list[StorageUsageReleaseRecord] = [
            StorageUsageReleaseRecord(
                category=StorageUsageCategory.TEMP_IMPORT,
                bytes_count=size_bytes or 0,
                object_type="import_artifact",
                object_id=artifact_uuid,
                storage_key=storage_key,
            )
            for artifact_uuid, storage_key, size_bytes in artifact_rows
        ]
        orphan_uploads: list[tuple[int, str, int, str, int]] = []
        for (
            upload_id,
            upload_uuid,
            stored_object_id,
            storage_key,
            size_bytes,
        ) in upload_rows:
            other_job_refs = db.execute(
                select(func.count(ImportJobUpload.id)).where(
                    ImportJobUpload.upload_id == upload_id,
                    ImportJobUpload.job_id != job_id,
                )
            ).scalar_one()
            input_refs = db.execute(
                select(func.count(ScoreInputAsset.id)).where(ScoreInputAsset.upload_id == upload_id)
            ).scalar_one()
            if other_job_refs == 0 and input_refs == 0:
                orphan_uploads.append(
                    (
                        upload_id,
                        upload_uuid,
                        stored_object_id,
                        storage_key,
                        size_bytes or 0,
                    )
                )
        for (
            _upload_id,
            upload_uuid,
            _object_id,
            storage_key,
            size_bytes,
        ) in orphan_uploads:
            cleanup.append(
                StorageUsageReleaseRecord(
                    category=StorageUsageCategory.UPLOAD,
                    bytes_count=size_bytes,
                    object_type="upload",
                    object_id=upload_uuid,
                    storage_key=storage_key,
                )
            )
        objects = list(
            db.scalars(
                select(StoredObject).where(
                    StoredObject.object_key.in_([key for _, key, _ in artifact_rows])
                )
            )
        )
        db.delete(job)
        db.flush()
        released_ids = [stored_object.id for stored_object in objects]
        for upload_id, _upload_uuid, object_id, _key, _size in orphan_uploads:
            upload = db.get(Upload, upload_id)
            if upload is not None:
                db.delete(upload)
                released_ids.append(object_id)
        return cleanup, released_ids

    def _single_score_originating_job(
        self,
        db: Session,
        *,
        score_id: int,
        originating_job_id: int | None,
    ) -> ImportJob | None:
        if originating_job_id is None:
            return None
        sibling_count = (
            db.execute(
                select(func.count(Score.id)).where(
                    Score.originating_job_id == originating_job_id,
                    Score.id != score_id,
                    Score.__table__.c.deleted_at.is_(None),
                )
            )
        ).scalar_one()
        if sibling_count:
            return None
        dispatch = db.scalar(
            select(ImportDispatch)
            .where(ImportDispatch.job_id == originating_job_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if dispatch is None:
            raise ValueError("Originating Import job requires its durable dispatch")
        return db.scalar(
            select(ImportJob)
            .where(ImportJob.id == originating_job_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

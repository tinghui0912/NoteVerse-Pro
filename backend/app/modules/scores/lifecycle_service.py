from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from sqlmodel import col

from app.core.config import settings
from app.db.model_utils import require_persisted_id
from app.db.models import (
    ImportArtifact,
    ImportJob,
    ImportJobUpload,
    Score,
    ScoreDeletionStatus,
    ScoreInputAsset,
    ScorePlaybackAsset,
    ScoreRenderAsset,
    ScoreRevision,
    ScoreRevisionSource,
    StorageBlob,
    StorageUsageCategory,
    Upload,
)
from app.modules.async_operations.diagnostics import (
    AsyncOperationKindValue,
    AsyncOperationStatusValue,
    apply_async_diagnostic,
    clear_async_diagnostic,
)
from app.modules.practice.cleanup_service import PracticeCleanupService, practice_cleanup_service
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.scores.repository import ScoreRepository
from app.modules.storage_usage.service import storage_usage_service
from app.storage import FileStorage, file_storage
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class ScoreDeletionCleanupResult:
    scores_deleted: int = 0
    storage_objects_deleted: int = 0


class ScoreLifecycleService:
    """Lifecycle orchestration for score deletion and future cleanup workflows."""

    def __init__(
        self,
        repository: ScoreRepository | None = None,
        storage: FileStorage | None = None,
        access_policy: ScoreAccessPolicy | None = None,
        practice_cleanup: PracticeCleanupService | None = None,
    ) -> None:
        self.repository = repository or ScoreRepository()
        self.storage = storage or file_storage
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.practice_cleanup = practice_cleanup or practice_cleanup_service

    async def delete_score(self, db: AsyncSession, score_uuid: str, user_id: int) -> None:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.DELETE, user_id=user_id
        )
        score = await self.repository.get(db, access.score.score_uuid, lock=True)
        assert score is not None
        if score.deletion_status != ScoreDeletionStatus.ACTIVE:
            return
        now = utc_now_naive()
        score.deletion_status = ScoreDeletionStatus.DELETING
        score.deletion_requested_at = now
        score.deleted_at = now
        score.cleanup_attempt_count = 0
        score.next_cleanup_at = None
        score.deletion_error = None
        clear_async_diagnostic(score)
        await db.commit()

    def cleanup_deleting_scores(
        self,
        db: Session,
        *,
        limit: int | None = None,
    ) -> ScoreDeletionCleanupResult:
        now = utc_now_naive()
        effective_limit = limit or settings.SCORE_DELETION_CLEANUP_BATCH_SIZE
        rows = list(
            db.execute(
                select(Score)
                .where(
                    Score.deletion_status == ScoreDeletionStatus.DELETING,
                    Score.cleanup_attempt_count < settings.SCORE_DELETION_CLEANUP_MAX_ATTEMPTS,
                    or_(col(Score.next_cleanup_at).is_(None), col(Score.next_cleanup_at) <= now),
                )
                .order_by(
                    col(Score.next_cleanup_at).asc().nullsfirst(),
                    col(Score.deletion_requested_at).asc(),
                    col(Score.id).asc(),
                )
                .limit(effective_limit)
            ).scalars()
        )
        total = ScoreDeletionCleanupResult()
        for score in rows:
            score_id = require_persisted_id(score.id, entity="score")
            try:
                result = self.cleanup_deleting_score(db, score)
            except Exception as exc:
                db.rollback()
                self._mark_cleanup_failed(db, score_id, exc)
                continue
            total = ScoreDeletionCleanupResult(
                scores_deleted=total.scores_deleted + result.scores_deleted,
                storage_objects_deleted=(
                    total.storage_objects_deleted + result.storage_objects_deleted
                ),
            )
        return total

    def cleanup_deleting_score(self, db: Session, score: Score) -> ScoreDeletionCleanupResult:
        if score.deletion_status != ScoreDeletionStatus.DELETING:
            return ScoreDeletionCleanupResult()
        score_id = require_persisted_id(score.id, entity="score")
        owner_user_id = score.owner_user_id
        originating_job = self._single_score_originating_job(
            db,
            score_id=score_id,
            originating_job_id=score.originating_job_id,
        )
        usage_releases: list[tuple[StorageUsageCategory, int, str, str, str]] = []
        source_rows = list(
            db.execute(
                select(
                    ScoreRevisionSource.source_uuid,
                    ScoreRevisionSource.storage_key,
                    ScoreRevisionSource.size_bytes,
                )
                .join(
                    ScoreRevision,
                    ScoreRevisionSource.revision_id == ScoreRevision.id,
                )
                .where(ScoreRevision.score_id == score_id)
            ).all()
        )
        usage_releases.extend(
            (
                StorageUsageCategory.SOURCE,
                size_bytes or 0,
                "score_revision_source",
                source_uuid,
                storage_key,
            )
            for source_uuid, storage_key, size_bytes in source_rows
        )
        storage_keys = [storage_key for _, storage_key, _ in source_rows]
        render_rows = list(
            db.execute(
                select(
                    ScoreRenderAsset.asset_uuid,
                    ScoreRenderAsset.storage_key,
                    ScoreRenderAsset.size_bytes,
                )
                .join(ScoreRevision, ScoreRenderAsset.revision_id == ScoreRevision.id)
                .where(ScoreRevision.score_id == score_id)
            ).all()
        )
        usage_releases.extend(
            (
                StorageUsageCategory.DERIVED_RENDER,
                size_bytes or 0,
                "score_render_asset",
                asset_uuid,
                storage_key,
            )
            for asset_uuid, storage_key, size_bytes in render_rows
        )
        storage_keys.extend(storage_key for _, storage_key, _ in render_rows)
        audio_rows = list(
            db.execute(
                select(
                    ScorePlaybackAsset.asset_uuid,
                    ScorePlaybackAsset.storage_key,
                    ScorePlaybackAsset.size_bytes,
                )
                .join(ScoreRevision, ScorePlaybackAsset.revision_id == ScoreRevision.id)
                .where(ScoreRevision.score_id == score_id)
            ).all()
        )
        usage_releases.extend(
            (
                StorageUsageCategory.DERIVED_AUDIO,
                size_bytes or 0,
                "score_playback_asset",
                asset_uuid,
                storage_key,
            )
            for asset_uuid, storage_key, size_bytes in audio_rows
        )
        storage_keys.extend(storage_key for _, storage_key, _ in audio_rows)
        input_rows = list(
            db.execute(
                select(
                    ScoreInputAsset.asset_uuid,
                    ScoreInputAsset.upload_id,
                    StorageBlob.id,
                    StorageBlob.blob_uuid,
                    StorageBlob.storage_key,
                    StorageBlob.size_bytes,
                )
                .join(Upload, ScoreInputAsset.upload_id == Upload.id)
                .join(StorageBlob, Upload.blob_id == StorageBlob.id)
                .where(ScoreInputAsset.score_id == score_id)
            ).all()
        )
        usage_releases.extend(
            (
                StorageUsageCategory.INPUT_ASSET,
                size_bytes or 0,
                "score_input_asset",
                asset_uuid,
                storage_key,
            )
            for asset_uuid, _upload_id, _blob_id, _blob_uuid, storage_key, size_bytes in input_rows
        )
        upload_ids_to_maybe_delete = [upload_id for _asset_uuid, upload_id, *_rest in input_rows]
        blob_rows_by_upload = {
            upload_id: (blob_id, blob_uuid, storage_key)
            for _asset_uuid, upload_id, blob_id, blob_uuid, storage_key, _size_bytes in input_rows
        }
        score.head_revision_id = None
        practice_storage_keys = self._cleanup_practice_for_score_sync(db, score_id)
        db.delete(score)
        db.flush()
        blobs_to_delete: dict[int, tuple[str, str]] = {}
        for upload_id in upload_ids_to_maybe_delete:
            import_refs = (
                db.execute(
                    select(func.count(ImportJobUpload.id)).where(ImportJobUpload.upload_id == upload_id)
                )
            ).scalar_one()
            input_refs = (
                db.execute(
                    select(func.count(ScoreInputAsset.id)).where(ScoreInputAsset.upload_id == upload_id)
                )
            ).scalar_one()
            if import_refs or input_refs:
                continue
            upload = db.get(Upload, upload_id)
            if upload is None:
                continue
            blob_id, blob_uuid, blob_storage_key = blob_rows_by_upload[upload_id]
            db.delete(upload)
            blob_refs = (
                db.execute(select(func.count(Upload.id)).where(Upload.blob_id == blob_id))
            ).scalar_one()
            if blob_refs <= 1:
                blob = db.get(StorageBlob, blob_id)
                if blob is not None:
                    db.delete(blob)
                    blobs_to_delete[blob_id] = (blob_uuid, blob_storage_key)
        import_cleanup = self._delete_originating_import_job_sync(
            db,
            originating_job,
            owner_user_id,
        )
        db.commit()
        for category, size_bytes, object_type, object_id, storage_key in usage_releases:
            storage_usage_service.record_release_sync(
                db,
                user_id=owner_user_id,
                category=category,
                bytes_count=size_bytes,
                reason="delete_score",
                object_type=object_type,
                object_id=object_id,
                storage_key=storage_key,
            )
        deleted_storage_count = 0
        for key in storage_keys:
            if self._delete_storage_best_effort(key):
                deleted_storage_count += 1
        for category, bytes_count, object_type, object_id, storage_key, delete_storage in import_cleanup:
            storage_usage_service.record_release_sync(
                db,
                user_id=owner_user_id,
                category=category,
                bytes_count=bytes_count,
                reason="import_job_deleted",
                object_type=object_type,
                object_id=object_id,
                storage_key=storage_key,
            )
            if delete_storage and self._delete_storage_best_effort(storage_key):
                deleted_storage_count += 1
        for _blob_uuid, blob_storage_key in blobs_to_delete.values():
            if self._delete_storage_best_effort(blob_storage_key):
                deleted_storage_count += 1
        for key in practice_storage_keys:
            if self._delete_storage_best_effort(key):
                deleted_storage_count += 1
        return ScoreDeletionCleanupResult(
            scores_deleted=1,
            storage_objects_deleted=deleted_storage_count,
        )

    def _mark_cleanup_failed(self, db: Session, score_id: int, exc: Exception) -> None:
        score = db.get(Score, score_id)
        if score is None or score.deletion_status != ScoreDeletionStatus.DELETING:
            return
        now = utc_now_naive()
        score.cleanup_attempt_count += 1
        retry_delay = self._cleanup_retry_delay_seconds(score.cleanup_attempt_count)
        score.next_cleanup_at = now + timedelta(seconds=retry_delay)
        score.deletion_error = str(exc)[:4000]
        apply_async_diagnostic(
            score,
            kind=AsyncOperationKindValue.SCORE_DELETION,
            status=(
                AsyncOperationStatusValue.EXHAUSTED
                if score.cleanup_attempt_count >= settings.SCORE_DELETION_CLEANUP_MAX_ATTEMPTS
                else AsyncOperationStatusValue.RETRYING
            ),
            raw_status=score.deletion_status.value,
            last_error=score.deletion_error,
            attempts=score.cleanup_attempt_count,
            max_attempts=settings.SCORE_DELETION_CLEANUP_MAX_ATTEMPTS,
        )
        db.commit()

    def _cleanup_retry_delay_seconds(self, attempt_count: int) -> int:
        exponent = min(max(attempt_count - 1, 0), 6)
        return settings.SCORE_DELETION_CLEANUP_RETRY_BASE_SECONDS * (2**exponent)

    def _cleanup_practice_for_score_sync(self, db: Session, score_id: int) -> list[str]:
        from app.db.models import PracticeSession
        from sqlalchemy import delete as sa_delete

        sessions = list(
            db.execute(
                select(PracticeSession).where(PracticeSession.score_id == score_id)
            ).scalars()
        )
        storage_keys = [
            session.audio_path for session in sessions if session.audio_path is not None
        ]
        db.execute(sa_delete(PracticeSession).where(PracticeSession.score_id == score_id))
        db.flush()
        return storage_keys

    def _delete_originating_import_job_sync(
        self,
        db: Session,
        job: ImportJob | None,
        user_id: int,
    ) -> list[tuple[StorageUsageCategory, int, str, str, str, bool]]:
        if job is None:
            return []
        job_id = require_persisted_id(job.id, entity="import job")
        artifact_rows = list(
            db.execute(
                select(
                    ImportArtifact.artifact_uuid,
                    ImportArtifact.storage_key,
                    ImportArtifact.size_bytes,
                ).where(ImportArtifact.job_id == job_id)
            ).all()
        )
        upload_rows = list(
            db.execute(
                select(
                    Upload.id,
                    Upload.upload_uuid,
                    StorageBlob.id,
                    StorageBlob.blob_uuid,
                    StorageBlob.storage_key,
                    StorageBlob.size_bytes,
                )
                .join(ImportJobUpload, ImportJobUpload.upload_id == Upload.id)
                .join(StorageBlob, Upload.blob_id == StorageBlob.id)
                .where(ImportJobUpload.job_id == job_id)
            ).all()
        )
        cleanup: list[tuple[StorageUsageCategory, int, str, str, str, bool]] = [
            (
                StorageUsageCategory.TEMP_IMPORT,
                size_bytes or 0,
                "import_artifact",
                artifact_uuid,
                storage_key,
                True,
            )
            for artifact_uuid, storage_key, size_bytes in artifact_rows
        ]
        orphan_uploads: list[tuple[int, str, int, str, str, int]] = []
        for upload_id, upload_uuid, blob_id, blob_uuid, storage_key, size_bytes in upload_rows:
            other_job_refs = db.execute(
                select(func.count(ImportJobUpload.id)).where(
                    ImportJobUpload.upload_id == upload_id,
                    ImportJobUpload.job_id != job_id,
                )
            ).scalar_one()
            input_refs = db.execute(
                select(func.count(ScoreInputAsset.id)).where(
                    ScoreInputAsset.upload_id == upload_id
                )
            ).scalar_one()
            if other_job_refs == 0 and input_refs == 0:
                orphan_uploads.append(
                    (upload_id, upload_uuid, blob_id, blob_uuid, storage_key, size_bytes or 0)
                )
        for _upload_id, upload_uuid, _blob_id, _blob_uuid, storage_key, size_bytes in orphan_uploads:
            cleanup.append(
                (
                    StorageUsageCategory.UPLOAD,
                    size_bytes,
                    "upload",
                    upload_uuid,
                    storage_key,
                    False,
                )
            )
        db.delete(job)
        db.flush()
        seen_blob_ids: set[int] = set()
        for upload_id, _upload_uuid, blob_id, blob_uuid, storage_key, _size_bytes in orphan_uploads:
            upload = db.get(Upload, upload_id)
            if upload is not None:
                db.delete(upload)
            if blob_id in seen_blob_ids:
                continue
            seen_blob_ids.add(blob_id)
            blob_refs = db.execute(
                select(func.count(Upload.id)).where(Upload.blob_id == blob_id)
            ).scalar_one()
            if blob_refs <= 1:
                blob = db.get(StorageBlob, blob_id)
                if blob is not None:
                    db.delete(blob)
                    cleanup.append(
                        (
                            StorageUsageCategory.UPLOAD,
                            0,
                            "storage_blob",
                            blob_uuid,
                            storage_key,
                            True,
                        )
                    )
        return cleanup

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
                    Score.deletion_status == ScoreDeletionStatus.ACTIVE,
                )
            )
        ).scalar_one()
        if sibling_count:
            return None
        return db.get(ImportJob, originating_job_id)

    async def _single_score_originating_job_uuid(
        self,
        db: AsyncSession,
        *,
        score_id: int,
        originating_job_id: int | None,
    ) -> str | None:
        if originating_job_id is None:
            return None
        sibling_count = (
            await db.execute(
                select(func.count(Score.id)).where(
                    Score.originating_job_id == originating_job_id,
                    Score.id != score_id,
                    Score.deletion_status == ScoreDeletionStatus.ACTIVE,
                )
            )
        ).scalar_one()
        if sibling_count:
            return None
        job = await db.get(ImportJob, originating_job_id)
        return job.job_uuid if job is not None else None

    def _delete_storage_best_effort(self, storage_key: str) -> bool:
        try:
            self.storage.delete(storage_key)
            return True
        except Exception:
            # Database deletion is authoritative; orphan cleanup retries storage removal.
            return False


score_lifecycle_service = ScoreLifecycleService()

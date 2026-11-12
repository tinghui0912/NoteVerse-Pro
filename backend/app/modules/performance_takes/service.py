from __future__ import annotations


from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ResourceNotFoundException,
)
from app.db.models.performance_take import PerformanceTake
from app.db.models import StorageUsageCategory
from app.modules.storage_usage.service import storage_usage_service
from app.modules.storage_objects.retirement import retire_after_release
from app.db.models.score import Score, ScoreDeletionStatus
from app.modules.performance_takes.aggregate import take_from_row
from app.modules.performance_takes.recording_media_policy import capture_extension
from app.modules.performance_takes.repository import PerformanceTakeRepository
from app.modules.performance_takes.schemas import (
    PerformanceTakeDeleteResponse,
    PerformanceTakeListResponse,
    PerformanceTakePlaybackRead,
    PerformanceTakeRead,
)
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.shared.constants import ErrorCode
from app.storage.base import ObjectStorage
from app.storage.factory import object_storage


class PerformanceTakeService:
    def __init__(
        self,
        repository: PerformanceTakeRepository | None = None,
        storage: ObjectStorage | None = None,
        score_access_policy: ScoreAccessPolicy | None = None,
    ) -> None:
        self.repository = repository or PerformanceTakeRepository()
        self.storage = storage or object_storage
        self.score_access_policy = score_access_policy or ScoreAccessPolicy()

    def _to_read_dto(
        self,
        take: PerformanceTake,
        *,
        score: Score | None = None,
        can_open_score: bool = False,
    ) -> PerformanceTakeRead:
        facts = take_from_row(take)
        manifest, recording = facts.manifest, facts.recording_object
        linked_score_id = (
            score.score_uuid
            if can_open_score
            and score is not None
            and score.deletion_status == ScoreDeletionStatus.ACTIVE
            else None
        )

        return PerformanceTakeRead(
            take_id=manifest.take_uuid,
            manifest=manifest.snapshot,
            recording_media={"mime_type": recording.content_type, "byte_size": recording.byte_size},
            linked_score_id=linked_score_id,
            can_open_score=linked_score_id is not None,
            created_at=take.created_at,
        )

    async def _can_open_score(self, db: AsyncSession, user_id: int, score: Score | None) -> bool:
        if score is None or score.deletion_status != ScoreDeletionStatus.ACTIVE:
            return False
        try:
            await self.score_access_policy.authorize(
                db,
                score.score_uuid,
                ScoreAction.VIEW,
                user_id=user_id,
            )
            return True
        except Exception:
            return False

    async def list_takes(
        self,
        db: AsyncSession,
        user_id: int,
        score_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> PerformanceTakeListResponse:
        score_db_id: Optional[int] = None
        if score_id is not None:
            score_res = await db.execute(select(Score).where(Score.score_uuid == score_id))
            score_filter = score_res.scalars().first()
            if not score_filter:
                return PerformanceTakeListResponse(
                    items=[], total=0, limit=limit, offset=offset, has_more=False
                )
            score_db_id = score_filter.id

        items, total = await self.repository.list_takes(
            db, user_id, linked_score_id=score_db_id, limit=limit, offset=offset
        )

        score_ids = {item.linked_score_id for item in items if item.linked_score_id is not None}
        score_map: dict[int, Score] = {}
        if score_ids:
            scores_res = await db.execute(select(Score).where(Score.id.in_(score_ids)))
            for s in scores_res.scalars().all():
                if s.id is not None:
                    score_map[s.id] = s

        read_items: list[PerformanceTakeRead] = []
        for item in items:
            score_obj = (
                score_map.get(item.linked_score_id) if item.linked_score_id is not None else None
            )
            can_open_score = await self._can_open_score(db, user_id, score_obj)
            read_items.append(
                self._to_read_dto(
                    item,
                    score=score_obj,
                    can_open_score=can_open_score,
                )
            )

        has_more = (offset + len(items)) < total
        return PerformanceTakeListResponse(
            items=read_items,
            total=total,
            limit=limit,
            offset=offset,
            has_more=has_more,
        )

    async def get_take(
        self,
        db: AsyncSession,
        user_id: int,
        take_id: str,
    ) -> PerformanceTakeRead:
        take = await self.repository.get_by_uuid(db, user_id, take_id)
        if take is None:
            raise ResourceNotFoundException(
                "performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND
            )

        score = (
            await db.get(Score, take.linked_score_id) if take.linked_score_id is not None else None
        )
        can_open_score = await self._can_open_score(db, user_id, score)

        return self._to_read_dto(take, score=score, can_open_score=can_open_score)

    async def get_playback_url(
        self,
        db: AsyncSession,
        user_id: int,
        take_id: str,
    ) -> PerformanceTakePlaybackRead:
        take = await self.repository.get_by_uuid(db, user_id, take_id)
        if take is None:
            raise ResourceNotFoundException(
                "performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND
            )

        facts = take_from_row(take)
        manifest, recording = facts.manifest, facts.recording_object
        playback_url = self.storage.download_url(
            recording.object_key,
            content_type=recording.content_type,
        )
        ext = capture_extension(manifest.snapshot.capture.kind, recording.content_type)
        download_url = self.storage.download_url(
            recording.object_key,
            filename=f"performance-{manifest.take_uuid}.{ext}",
            content_type=recording.content_type,
        )

        return PerformanceTakePlaybackRead(
            take_id=manifest.take_uuid,
            playback_url=playback_url,
            download_url=download_url,
            expires_in=3600,
        )

    async def get_media_delivery(
        self,
        db: AsyncSession,
        user_id: int,
        take_id: str,
    ) -> tuple[str, str, str]:
        """Return an authorized, server-streamed media target without exposing its object key."""
        take = await self.repository.get_by_uuid(db, user_id, take_id)
        if take is None:
            raise ResourceNotFoundException(
                "performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND
            )
        facts = take_from_row(take)
        manifest, recording = facts.manifest, facts.recording_object
        extension = capture_extension(manifest.snapshot.capture.kind, recording.content_type)
        return (
            recording.object_key,
            f"performance-{manifest.take_uuid}.{extension}",
            recording.content_type,
        )

    async def delete_take(
        self,
        db: AsyncSession,
        user_id: int,
        take_id: str,
    ) -> PerformanceTakeDeleteResponse:
        take = await self.repository.get_by_uuid(db, user_id, take_id, lock=True)
        if take is None:
            raise ResourceNotFoundException(
                "performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND
            )

        facts = take_from_row(take)
        object_id = take.recording_object_id
        await db.delete(take)
        operations = await retire_after_release(db, object_id)
        await storage_usage_service.record_release(
            db,
            user_id=user_id,
            category=StorageUsageCategory.UPLOAD,
            bytes_count=facts.recording_object.byte_size,
            reason="performance_take_deleted",
            object_type="performance_take",
            object_id=take_id,
            storage_key=facts.recording_object.object_key,
            auto_commit=False,
        )
        await db.commit()
        from app.worker.dispatch.stored_object_retirement import dispatch_retirements_best_effort

        dispatch_retirements_best_effort(operations)
        return PerformanceTakeDeleteResponse(take_id=take_id)

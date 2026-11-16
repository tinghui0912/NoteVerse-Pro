from __future__ import annotations
from app.modules.storage_objects.reads import StoredObjectDelivery
from app.storage import ObjectStorage


from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import (
    ResourceNotFoundException,
)
from app.db.models.performance_take import PerformanceTake
from app.db.models import StorageUsageCategory
from app.modules.storage_usage.service import storage_usage_service
from app.modules.storage_objects.retirement import retire_after_release
from app.db.models.score import Score
from app.modules.performance_takes.aggregate import performance_take_facts_from_row
from app.modules.performance_takes.recording_media_admission import recording_extension
from app.modules.performance_takes.repository import PerformanceTakeRepository
from app.modules.performance_takes.schemas import (
    PerformanceTakeListResponse,
    PerformanceTakePlaybackRead,
    PerformanceTakeRead,
)
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.shared.error_codes import CustomerErrorCode
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
        facts = performance_take_facts_from_row(take)
        manifest, recording = facts.manifest, facts.recording_object
        linked_score_id = (
            score.score_uuid
            if can_open_score and score is not None and score.deleted_at is None
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

    def _can_open_score(self, db: Session, user_id: int, score: Score | None) -> bool:
        if score is None or score.deleted_at is not None:
            return False
        try:
            self.score_access_policy.authorize_score(
                db,
                score.score_uuid,
                ScoreAction.VIEW,
                user_id=user_id,
            )
            return True
        except Exception:
            return False

    def list_takes(
        self,
        db: Session,
        user_id: int,
        score_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> PerformanceTakeListResponse:
        score_db_id: Optional[int] = None
        if score_id is not None:
            score_res = db.execute(select(Score).where(Score.score_uuid == score_id))
            score_filter = score_res.scalars().first()
            if not score_filter:
                return PerformanceTakeListResponse(
                    items=[], total=0, limit=limit, offset=offset, has_more=False
                )
            score_db_id = score_filter.id

        items, total = self.repository.list_takes(
            db, user_id, linked_score_id=score_db_id, limit=limit, offset=offset
        )

        score_ids = {item.linked_score_id for item in items if item.linked_score_id is not None}
        score_map: dict[int, Score] = {}
        if score_ids:
            scores_res = db.execute(select(Score).where(Score.id.in_(score_ids)))
            for s in scores_res.scalars().all():
                if s.id is not None:
                    score_map[s.id] = s

        read_items: list[PerformanceTakeRead] = []
        for item in items:
            score_obj = (
                score_map.get(item.linked_score_id) if item.linked_score_id is not None else None
            )
            can_open_score = self._can_open_score(db, user_id, score_obj)
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

    def get_take(
        self,
        db: Session,
        user_id: int,
        take_id: str,
    ) -> PerformanceTakeRead:
        take = self.repository.get_by_uuid(db, user_id, take_id)
        if take is None:
            raise ResourceNotFoundException(
                "performance_take", take_id, CustomerErrorCode.RESOURCE_NOT_FOUND
            )

        score = db.get(Score, take.linked_score_id) if take.linked_score_id is not None else None
        can_open_score = self._can_open_score(db, user_id, score)

        return self._to_read_dto(take, score=score, can_open_score=can_open_score)

    def get_playback_url(
        self,
        db: Session,
        user_id: int,
        take_id: str,
    ) -> PerformanceTakePlaybackRead:
        take = self.repository.get_by_uuid(db, user_id, take_id)
        if take is None:
            raise ResourceNotFoundException(
                "performance_take", take_id, CustomerErrorCode.RESOURCE_NOT_FOUND
            )

        facts = performance_take_facts_from_row(take)
        manifest, recording = facts.manifest, facts.recording_object
        playback_url = self.storage.download_url(
            recording.object_key,
            content_type=recording.content_type,
        )
        ext = recording_extension(manifest.snapshot.capture.kind, recording.content_type)
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

    def get_media_delivery(
        self,
        db: Session,
        user_id: int,
        take_id: str,
    ) -> StoredObjectDelivery:
        """Return an authorized, server-streamed media target without exposing its object key."""
        take = self.repository.get_by_uuid(db, user_id, take_id)
        if take is None:
            raise ResourceNotFoundException(
                "performance_take", take_id, CustomerErrorCode.RESOURCE_NOT_FOUND
            )
        facts = performance_take_facts_from_row(take)
        manifest, recording = facts.manifest, facts.recording_object
        extension = recording_extension(manifest.snapshot.capture.kind, recording.content_type)
        return StoredObjectDelivery.for_object(
            take.recording_object, f"performance-{manifest.take_uuid}.{extension}"
        )

    def delete_take(
        self,
        db: Session,
        user_id: int,
        take_id: str,
    ) -> None:
        take = self.repository.get_by_uuid(db, user_id, take_id, lock=True)
        if take is None:
            raise ResourceNotFoundException(
                "performance_take", take_id, CustomerErrorCode.RESOURCE_NOT_FOUND
            )

        facts = performance_take_facts_from_row(take)
        object_id = take.recording_object_id
        db.delete(take)
        operations = retire_after_release(db, object_id)
        storage_usage_service.record_release(
            db,
            user_id=user_id,
            category=StorageUsageCategory.UPLOAD,
            bytes_count=facts.recording_object.byte_size,
            reason="performance_take_deleted",
            object_type="performance_take",
            object_id=take_id,
            storage_key=facts.recording_object.object_key,
        )
        db.commit()
        from app.worker.dispatch.stored_object_retirement import dispatch_retirements_best_effort

        dispatch_retirements_best_effort(operations)
        return None

from __future__ import annotations

from app.modules.media_storage.delivery import MediaDeliveryService

from app.modules.storage_governance.usage.service import StorageUsageService
from app.modules.media_storage.reads import StoredObjectDelivery


from sqlalchemy.orm import Session

from app.core.exceptions import (
    ValidationException,
    ResourceNotFoundException,
    UnauthorizedException,
)
from app.db.models.performance_take import PerformanceTake
from app.modules.storage_governance.usage.domain import StorageUsageCategory

from app.modules.media_storage.retirement import retire_after_release
from app.db.models.score import Score
from app.modules.performance_takes.aggregate import performance_take_facts_from_row
from app.modules.performance_takes.recording_media_admission import recording_extension
from app.modules.performance_takes.repository import PerformanceTakeRepository
from app.modules.performance_takes.read_model import PerformanceTakeReadModel, take_read
from app.shared.feed_cursor import decode_cursor, encode_cursor
import json
from app.modules.performance_takes.schemas import (
    PerformanceTakeListRead,
    PerformanceTakePlaybackRead,
    PerformanceTakeRead,
)
from app.modules.score_access.actions import ScoreAction
from app.modules.score_access.policy import ScoreAccessPolicy
from app.shared.error_codes import CustomerErrorCode


class PerformanceTakeService:
    def __init__(
        self,
        repository: PerformanceTakeRepository | None = None,
        score_access_policy: ScoreAccessPolicy | None = None,
        *,
        usage: StorageUsageService,
        delivery: MediaDeliveryService,
    ) -> None:
        self.delivery = delivery
        self.usage = usage
        self.repository = repository or PerformanceTakeRepository()
        self.storage = delivery.storage
        self.score_access_policy = score_access_policy or ScoreAccessPolicy()

    def _to_read_dto(
        self, take: PerformanceTake, *, score: Score | None = None, can_open_score: bool = False
    ) -> PerformanceTakeRead:
        return take_read(
            take,
            score.score_uuid
            if can_open_score and score is not None and score.deleted_at is None
            else None,
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
        except (UnauthorizedException, ResourceNotFoundException):
            return False

    def list_takes(
        self,
        db: Session,
        user_id: int,
        score_id: str | None = None,
        limit: int = 50,
        cursor: str | None = None,
    ) -> PerformanceTakeListRead:
        scope = json.dumps([user_id, score_id], separators=(",", ":"))
        before = decode_cursor(cursor, collection="performance_takes", scope=scope)
        rows = self.repository.list_takes(
            db, user_id, score_uuid=score_id, limit=limit + 1, before=before
        )
        page = rows[:limit]
        next_cursor = (
            encode_cursor("performance_takes", scope, page[-1].created_at, page[-1].id)
            if len(rows) > limit
            else None
        )
        return PerformanceTakeListRead(
            items=PerformanceTakeReadModel().take_page(db, user_id, page), next_cursor=next_cursor
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

        if take.media_status != "READY":
            raise ValidationException(
                CustomerErrorCode.VALIDATION_ERROR,
                field="media_status",
                details={"reason": "media_not_ready"},
            )
        facts = performance_take_facts_from_row(take)
        manifest, recording = facts.manifest, facts.recording_object
        ext = recording_extension(manifest.snapshot.capture.kind, recording.content_type)
        target = StoredObjectDelivery.for_object(
            take.recording_object, f"performance-{manifest.take_uuid}.{ext}"
        )
        db.commit()
        db.close()
        playback_url = self.delivery.signed_url(target)
        download_url = self.delivery.signed_url(target, attachment=True)

        return PerformanceTakePlaybackRead(
            take_id=manifest.take_uuid,
            playback_url=playback_url,
            download_url=download_url,
            expires_in=self.delivery.policy.signed_url_ttl_seconds,
        )

    def delete_take(
        self,
        db: Session,
        user_id: int,
        take_id: str,
    ) -> list[str]:
        self.usage.committed_bytes(db, user_id, lock=True)
        take = self.repository.get_by_uuid(db, user_id, take_id, lock=True)
        if take is None:
            raise ResourceNotFoundException(
                "performance_take", take_id, CustomerErrorCode.RESOURCE_NOT_FOUND
            )

        facts = performance_take_facts_from_row(take)
        object_id = take.recording_object_id
        db.delete(take)
        self.usage.record_release(
            db,
            user_id=user_id,
            category=StorageUsageCategory.UPLOAD,
            bytes_count=facts.recording_object.byte_size,
            reason="performance_take_deleted",
            object_type="performance_take",
            object_id=take_id,
            storage_key=facts.recording_object.object_key,
        )
        return retire_after_release(db, object_id)

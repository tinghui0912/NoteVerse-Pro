from __future__ import annotations
from app.db.models.performance_take_manifest import PerformanceTakeMediaKind


from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ResourceNotFoundException,
)
from app.db.models.performance_take import (
    PerformanceTake,
    PerformanceTakeDeletionStatus,
)
from app.db.models.performance_take_delete_outbox import (
    PerformanceTakeDeleteOutbox,
    PerformanceTakeDeleteOutboxStatus,
)
from app.db.models.score import Score, ScoreDeletionStatus
from app.modules.performance_takes.aggregate import take_from_row
from app.modules.performance_takes.repository import PerformanceTakeRepository
from app.modules.performance_takes.schemas import (
    PerformanceTakeListResponse,
    PerformanceTakePlaybackRead,
    PerformanceTakeRead,
)
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.shared.constants import ErrorCode
from app.storage.base import ObjectStorage
from app.storage.factory import object_storage
from app.utils.timezone import utc_now_naive


def _status_value(status: object) -> str:
    value = getattr(status, "value", status)
    return str(value)


def _media_kind_value(media_kind: object) -> str:
    value = getattr(media_kind, "value", media_kind)
    return str(value or PerformanceTakeMediaKind.AUDIO.value).upper()


def _extension_for_mime(mime_type: str) -> str:
    cleaned = mime_type.split(";")[0].strip().lower()
    mapping = {
        "audio/webm": "webm",
        "audio/mp4": "mp4",
        "audio/ogg": "ogg",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "video/webm": "webm",
        "video/mp4": "mp4",
    }
    return mapping.get(cleaned, "webm")


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
        manifest, blob = facts.manifest, facts.recording_object
        linked_score_id = (
            score.score_uuid
            if can_open_score
            and score is not None
            and score.deletion_status == ScoreDeletionStatus.ACTIVE
            else None
        )

        deletion_status = _status_value(take.deletion_status)

        return PerformanceTakeRead(
            take_id=manifest.take_uuid,
            manifest=manifest.snapshot,
            archive_media={"mime_type": blob.content_type, "byte_size": blob.byte_size},
            linked_score_id=linked_score_id,
            can_open_score=linked_score_id is not None,
            deletion_status=deletion_status,
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
        if (
            take is None
            or _status_value(take.deletion_status) == PerformanceTakeDeletionStatus.DELETING.value
        ):
            raise ResourceNotFoundException(
                "performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND
            )

        facts = take_from_row(take)
        manifest, blob = facts.manifest, facts.recording_object
        playback_url = self.storage.download_url(
            blob.object_key,
            content_type=blob.content_type,
        )
        ext = _extension_for_mime(blob.content_type)
        download_url = self.storage.download_url(
            blob.object_key,
            filename=f"performance-{manifest.take_uuid}.{ext}",
            content_type=blob.content_type,
        )

        return PerformanceTakePlaybackRead(
            take_id=manifest.take_uuid,
            playback_url=playback_url,
            download_url=download_url,
            media_kind=_media_kind_value(manifest.snapshot.capture.kind),
            media_mime_type=blob.content_type,
            media_byte_size=blob.byte_size,
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
        if (
            take is None
            or _status_value(take.deletion_status) == PerformanceTakeDeletionStatus.DELETING.value
        ):
            raise ResourceNotFoundException(
                "performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND
            )
        facts = take_from_row(take)
        manifest, blob = facts.manifest, facts.recording_object
        extension = _extension_for_mime(blob.content_type)
        return (
            blob.object_key,
            f"performance-{manifest.take_uuid}.{extension}",
            blob.content_type,
        )

    async def delete_take(
        self,
        db: AsyncSession,
        user_id: int,
        take_id: str,
    ) -> dict[str, str]:
        take = await self.repository.get_by_uuid(db, user_id, take_id, lock=True)
        if take is None:
            raise ResourceNotFoundException(
                "performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND
            )

        if _status_value(take.deletion_status) == PerformanceTakeDeletionStatus.DELETING.value:
            return {"status": "deleting", "take_id": take_id}

        facts = take_from_row(take)
        manifest, blob = facts.manifest, facts.recording_object
        take.deletion_status = PerformanceTakeDeletionStatus.DELETING.value
        outbox = PerformanceTakeDeleteOutbox(
            take_id=take.id,
            take_uuid=manifest.take_uuid,
            user_id=manifest.user_id,
            object_key=blob.object_key,
            media_byte_size=blob.byte_size,
            status=PerformanceTakeDeleteOutboxStatus.PENDING.value,
            next_attempt_at=utc_now_naive(),
        )
        await self.repository.create_delete_outbox(db, outbox, auto_commit=False)
        await db.commit()

        try:
            from app.worker.dispatch.performance_take_deletion import (
                dispatch_performance_take_deletion,
            )

            dispatch_performance_take_deletion(outbox.outbox_uuid)
        except Exception:
            pass

        return {"status": "deleting", "take_id": take_id}

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import (
    RenderOutboxStatus,
    RevisionRenderOutbox,
    Score,
    ScoreRevision,
)
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class RenderOutboxPayload:
    outbox_uuid: str
    score_uuid: str
    revision_uuid: str
    user_id: int
    render_profile: str


async def create_render_outbox(
    db: AsyncSession,
    *,
    score_id: int,
    revision_id: int,
    requested_by_user_id: int,
    render_profile: str = "default",
) -> RevisionRenderOutbox:
    existing = (
        await db.execute(
            select(RevisionRenderOutbox).where(
                RevisionRenderOutbox.revision_id == revision_id,
                RevisionRenderOutbox.render_profile == render_profile,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    outbox = RevisionRenderOutbox(
        outbox_uuid=str(uuid.uuid4()),
        score_id=score_id,
        revision_id=revision_id,
        requested_by_user_id=requested_by_user_id,
        render_profile=render_profile,
        status=RenderOutboxStatus.PENDING,
    )
    db.add(outbox)
    await db.flush()
    return outbox


class RenderOutboxService:
    def claim(self, db: Session, outbox_uuid: str) -> RenderOutboxPayload | None:
        outbox = db.execute(
            select(RevisionRenderOutbox)
            .where(RevisionRenderOutbox.outbox_uuid == outbox_uuid)
            .with_for_update()
        ).scalar_one_or_none()
        if outbox is None or outbox.status in {
            RenderOutboxStatus.PROCESSING,
            RenderOutboxStatus.COMPLETED,
        }:
            return None
        if (
            outbox.status == RenderOutboxStatus.FAILED
            and outbox.next_attempt_at > utc_now_naive()
        ):
            return None
        if outbox.attempt_count >= settings.RENDER_OUTBOX_MAX_ATTEMPTS:
            return None

        score = db.get(Score, outbox.score_id)
        revision = db.get(ScoreRevision, outbox.revision_id)
        if score is None or revision is None or outbox.requested_by_user_id is None:
            outbox.status = RenderOutboxStatus.FAILED
            outbox.attempt_count = settings.RENDER_OUTBOX_MAX_ATTEMPTS
            outbox.last_error = "Render outbox references unavailable resources"
            outbox.updated_at = utc_now_naive()
            return None

        now = utc_now_naive()
        outbox.status = RenderOutboxStatus.PROCESSING
        outbox.attempt_count += 1
        outbox.started_at = now
        outbox.updated_at = now
        return RenderOutboxPayload(
            outbox_uuid=outbox.outbox_uuid,
            score_uuid=score.score_uuid,
            revision_uuid=revision.revision_uuid,
            user_id=outbox.requested_by_user_id,
            render_profile=outbox.render_profile,
        )

    def complete(self, db: Session, outbox_uuid: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None:
            return
        now = utc_now_naive()
        outbox.status = RenderOutboxStatus.COMPLETED
        outbox.completed_at = now
        outbox.last_error = None
        outbox.updated_at = now

    def fail(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None:
            return
        now = utc_now_naive()
        delay = settings.RENDER_OUTBOX_RETRY_BASE_SECONDS * (2 ** max(0, outbox.attempt_count - 1))
        outbox.status = RenderOutboxStatus.FAILED
        outbox.next_attempt_at = now + timedelta(seconds=delay)
        outbox.last_error = error[:4000]
        outbox.updated_at = now

    def mark_dispatched(self, db: Session, outbox_uuid: str) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not self._is_dispatchable(outbox):
            return False
        now = utc_now_naive()
        outbox.status = RenderOutboxStatus.DISPATCHED
        outbox.dispatched_at = now
        outbox.updated_at = now
        return True

    def release_dispatch(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or outbox.status != RenderOutboxStatus.DISPATCHED:
            return
        outbox.status = RenderOutboxStatus.PENDING
        outbox.dispatched_at = None
        outbox.last_error = error[:4000]
        outbox.updated_at = utc_now_naive()

    def recover_and_list_due(self, db: Session) -> list[str]:
        now = utc_now_naive()
        dispatched_cutoff = now - timedelta(
            seconds=settings.RENDER_OUTBOX_DISPATCH_TIMEOUT_SECONDS
        )
        processing_cutoff = now - timedelta(
            seconds=settings.RENDER_OUTBOX_PROCESSING_TIMEOUT_SECONDS
        )
        stale = db.execute(
            select(RevisionRenderOutbox).where(
                or_(
                    RevisionRenderOutbox.status == RenderOutboxStatus.DISPATCHED,
                    RevisionRenderOutbox.status == RenderOutboxStatus.PROCESSING,
                )
            )
        ).scalars().all()
        for outbox in stale:
            is_stale_dispatch = (
                outbox.status == RenderOutboxStatus.DISPATCHED
                and outbox.dispatched_at is not None
                and outbox.dispatched_at <= dispatched_cutoff
            )
            is_stale_processing = (
                outbox.status == RenderOutboxStatus.PROCESSING
                and outbox.started_at is not None
                and outbox.started_at <= processing_cutoff
            )
            if is_stale_dispatch or is_stale_processing:
                outbox.status = RenderOutboxStatus.FAILED
                outbox.next_attempt_at = now
                outbox.last_error = "Render delivery lease expired"
                outbox.updated_at = now

        due = db.execute(
            select(RevisionRenderOutbox.outbox_uuid)
            .where(
                RevisionRenderOutbox.status.in_([
                    RenderOutboxStatus.PENDING,
                    RenderOutboxStatus.FAILED,
                ]),
                RevisionRenderOutbox.next_attempt_at <= now,
                RevisionRenderOutbox.attempt_count < settings.RENDER_OUTBOX_MAX_ATTEMPTS,
            )
            .order_by(RevisionRenderOutbox.created_at)
            .limit(settings.RENDER_OUTBOX_DISPATCH_BATCH_SIZE)
        ).scalars().all()
        db.commit()
        return list(due)

    @staticmethod
    def _get(db: Session, outbox_uuid: str) -> RevisionRenderOutbox | None:
        return db.execute(
            select(RevisionRenderOutbox).where(
                RevisionRenderOutbox.outbox_uuid == outbox_uuid
            )
        ).scalar_one_or_none()

    @staticmethod
    def _is_dispatchable(outbox: RevisionRenderOutbox) -> bool:
        return (
            outbox.status in {RenderOutboxStatus.PENDING, RenderOutboxStatus.FAILED}
            and outbox.attempt_count < settings.RENDER_OUTBOX_MAX_ATTEMPTS
            and outbox.next_attempt_at <= utc_now_naive()
        )


render_outbox_service = RenderOutboxService()

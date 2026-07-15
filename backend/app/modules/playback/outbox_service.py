from __future__ import annotations

import uuid
from dataclasses import dataclass, replace
from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import (
    PlaybackAssetKind,
    PlaybackOutbox,
    PlaybackOutboxStatus,
    Score,
    ScoreDeletionStatus,
    ScoreRevision,
)
from app.modules.async_operations.diagnostics import (
    AsyncOperationKindValue,
    AsyncOperationStatusValue,
    apply_async_diagnostic,
    clear_async_diagnostic,
)
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class PlaybackOutboxPayload:
    outbox_uuid: str
    score_uuid: str
    revision_uuid: str
    source_fingerprint: str
    asset_kind: PlaybackAssetKind
    attempt: int
    max_attempts: int


async def create_playback_outbox(
    db: AsyncSession,
    *,
    score_id: int,
    revision_id: int,
    requested_by_user_id: int,
    source_fingerprint: str,
    asset_kind: PlaybackAssetKind = PlaybackAssetKind.AUDIO,
) -> PlaybackOutbox:
    existing = (
        await db.execute(
            select(PlaybackOutbox).where(
                PlaybackOutbox.revision_id == revision_id,
                PlaybackOutbox.asset_kind == asset_kind,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    outbox = PlaybackOutbox(
        outbox_uuid=str(uuid.uuid4()),
        score_id=score_id,
        revision_id=revision_id,
        requested_by_user_id=requested_by_user_id,
        source_fingerprint=source_fingerprint,
        asset_kind=asset_kind,
        status=PlaybackOutboxStatus.PENDING,
    )
    db.add(outbox)
    await db.flush()
    return outbox


class PlaybackOutboxService:
    def claim(self, db: Session, outbox_uuid: str) -> PlaybackOutboxPayload | None:
        outbox = db.execute(
            select(PlaybackOutbox)
            .where(PlaybackOutbox.outbox_uuid == outbox_uuid)
            .with_for_update()
        ).scalar_one_or_none()
        if outbox is None or outbox.status in {
            PlaybackOutboxStatus.PROCESSING,
            PlaybackOutboxStatus.COMPLETED,
        }:
            return None
        if (
            outbox.status == PlaybackOutboxStatus.FAILED
            and outbox.next_attempt_at > utc_now_naive()
        ):
            return None
        if outbox.attempt_count >= settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS:
            return None

        attempt = outbox.attempt_count + 1
        payload = self._build_payload(db, outbox)
        if payload is None:
            return None
        payload = replace(
            payload,
            attempt=attempt,
            max_attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
        )
        now = utc_now_naive()
        outbox.status = PlaybackOutboxStatus.PROCESSING
        outbox.attempt_count += 1
        outbox.started_at = now
        outbox.updated_at = now
        return payload

    def _build_payload(
        self, db: Session, outbox: PlaybackOutbox
    ) -> PlaybackOutboxPayload | None:
        score = db.get(Score, outbox.score_id)
        revision = db.get(ScoreRevision, outbox.revision_id)
        if (
            score is not None
            and score.deletion_status == ScoreDeletionStatus.ACTIVE
            and revision is not None
            and revision.score_id == outbox.score_id
            and revision.content_hash == outbox.source_fingerprint
        ):
            return PlaybackOutboxPayload(
                outbox_uuid=outbox.outbox_uuid,
                score_uuid=score.score_uuid,
                revision_uuid=revision.revision_uuid,
                source_fingerprint=outbox.source_fingerprint,
                asset_kind=outbox.asset_kind,
                attempt=0,
                max_attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
            )

        outbox.status = PlaybackOutboxStatus.FAILED
        outbox.attempt_count = settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS
        outbox.last_error = "Playback outbox references unavailable or stale resources"
        apply_async_diagnostic(
            outbox,
            kind=AsyncOperationKindValue.PLAYBACK,
            status=AsyncOperationStatusValue.EXHAUSTED,
            raw_status=outbox.status.value,
            last_error=outbox.last_error,
            attempts=outbox.attempt_count,
            max_attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
        )
        outbox.updated_at = utc_now_naive()
        return None

    def complete(self, db: Session, outbox_uuid: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None:
            return
        now = utc_now_naive()
        outbox.status = PlaybackOutboxStatus.COMPLETED
        outbox.completed_at = now
        outbox.last_error = None
        clear_async_diagnostic(outbox)
        outbox.updated_at = now

    def fail(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None:
            return
        now = utc_now_naive()
        delay = settings.PLAYBACK_OUTBOX_RETRY_BASE_SECONDS * (
            2 ** max(0, outbox.attempt_count - 1)
        )
        outbox.status = PlaybackOutboxStatus.FAILED
        outbox.next_attempt_at = now + timedelta(seconds=delay)
        outbox.last_error = error[:4000]
        apply_async_diagnostic(
            outbox,
            kind=AsyncOperationKindValue.PLAYBACK,
            status=(
                AsyncOperationStatusValue.EXHAUSTED
                if outbox.attempt_count >= settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS
                else AsyncOperationStatusValue.RETRYING
            ),
            raw_status=outbox.status.value,
            last_error=outbox.last_error,
            attempts=outbox.attempt_count,
            max_attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
        )
        outbox.updated_at = now

    def mark_dispatched(self, db: Session, outbox_uuid: str) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not self._is_dispatchable(outbox):
            return False
        now = utc_now_naive()
        outbox.status = PlaybackOutboxStatus.DISPATCHED
        outbox.dispatched_at = now
        clear_async_diagnostic(outbox)
        outbox.updated_at = now
        return True

    def release_dispatch(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or outbox.status != PlaybackOutboxStatus.DISPATCHED:
            return
        outbox.status = PlaybackOutboxStatus.PENDING
        outbox.dispatched_at = None
        outbox.last_error = error[:4000]
        apply_async_diagnostic(
            outbox,
            kind=AsyncOperationKindValue.PLAYBACK,
            status=AsyncOperationStatusValue.QUEUED,
            raw_status=outbox.status.value,
            last_error=outbox.last_error,
            attempts=outbox.attempt_count,
            max_attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
        )
        outbox.updated_at = utc_now_naive()

    def recover_and_list_due(self, db: Session) -> list[str]:
        now = utc_now_naive()
        dispatched_cutoff = now - timedelta(
            seconds=settings.PLAYBACK_OUTBOX_DISPATCH_TIMEOUT_SECONDS
        )
        processing_cutoff = now - timedelta(
            seconds=settings.PLAYBACK_OUTBOX_PROCESSING_TIMEOUT_SECONDS
        )
        stale = db.execute(
            select(PlaybackOutbox).where(
                or_(
                    PlaybackOutbox.status == PlaybackOutboxStatus.DISPATCHED,
                    PlaybackOutbox.status == PlaybackOutboxStatus.PROCESSING,
                )
            )
        ).scalars().all()
        for outbox in stale:
            is_stale_dispatch = (
                outbox.status == PlaybackOutboxStatus.DISPATCHED
                and outbox.dispatched_at is not None
                and outbox.dispatched_at <= dispatched_cutoff
            )
            is_stale_processing = (
                outbox.status == PlaybackOutboxStatus.PROCESSING
                and outbox.started_at is not None
                and outbox.started_at <= processing_cutoff
            )
            if is_stale_dispatch or is_stale_processing:
                outbox.status = PlaybackOutboxStatus.FAILED
                outbox.next_attempt_at = now
                outbox.last_error = "Playback delivery lease expired"
                apply_async_diagnostic(
                    outbox,
                    kind=AsyncOperationKindValue.PLAYBACK,
                    status=AsyncOperationStatusValue.FAILED,
                    raw_status=outbox.status.value,
                    last_error=outbox.last_error,
                    attempts=outbox.attempt_count,
                    max_attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
                )
                outbox.updated_at = now

        due = db.execute(
            select(PlaybackOutbox.outbox_uuid)
            .where(
                PlaybackOutbox.__table__.c.status.in_(
                    [PlaybackOutboxStatus.PENDING, PlaybackOutboxStatus.FAILED]
                ),
                PlaybackOutbox.next_attempt_at <= now,
                PlaybackOutbox.attempt_count < settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
            )
            .order_by(PlaybackOutbox.created_at)
            .limit(settings.PLAYBACK_OUTBOX_DISPATCH_BATCH_SIZE)
        ).scalars().all()
        db.commit()
        return list(due)

    @staticmethod
    def _get(db: Session, outbox_uuid: str) -> PlaybackOutbox | None:
        return db.execute(
            select(PlaybackOutbox).where(PlaybackOutbox.outbox_uuid == outbox_uuid)
        ).scalar_one_or_none()

    @staticmethod
    def _is_dispatchable(outbox: PlaybackOutbox) -> bool:
        return (
            outbox.status in {PlaybackOutboxStatus.PENDING, PlaybackOutboxStatus.FAILED}
            and outbox.attempt_count < settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS
            and outbox.next_attempt_at <= utc_now_naive()
        )


playback_outbox_service = PlaybackOutboxService()

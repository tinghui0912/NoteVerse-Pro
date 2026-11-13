from __future__ import annotations

import uuid
from dataclasses import dataclass, replace

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.async_trace_context import get_async_trace_context
from app.core.config import settings
from app.core.logger import get_request_id, logger
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
from app.modules.async_operations.durable_delivery import (
    ClaimAdmission,
    DeliveryLifecyclePolicy,
    DeliveryStatuses,
    DurableDeliveryLifecycle,
)
from app.utils.timezone import utc_now_naive
from app.modules.revisions.presentation_demand import (
    revision_presentation_demand,
    lock_presentation_score,
    RevisionPresentationDemand,
)


def _delivery_lifecycle() -> DurableDeliveryLifecycle[PlaybackOutboxStatus]:
    return DurableDeliveryLifecycle(
        statuses=DeliveryStatuses(
            pending=PlaybackOutboxStatus.PENDING,
            dispatched=PlaybackOutboxStatus.DISPATCHED,
            processing=PlaybackOutboxStatus.PROCESSING,
            failed=PlaybackOutboxStatus.FAILED,
            succeeded=PlaybackOutboxStatus.COMPLETED,
        ),
        policy=DeliveryLifecyclePolicy(
            max_attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
            retry_base_seconds=settings.PLAYBACK_OUTBOX_RETRY_BASE_SECONDS,
            dispatch_timeout_seconds=settings.PLAYBACK_OUTBOX_DISPATCH_TIMEOUT_SECONDS,
            processing_timeout_seconds=settings.PLAYBACK_OUTBOX_PROCESSING_TIMEOUT_SECONDS,
        ),
    )


@dataclass(frozen=True)
class PlaybackOutboxPayload:
    outbox_uuid: str
    score_uuid: str
    revision_uuid: str
    source_fingerprint: str
    asset_kind: PlaybackAssetKind
    attempt: int
    max_attempts: int
    originating_request_id: str | None = None
    traceparent: str | None = None
    tracestate: str | None = None


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
            select(PlaybackOutbox)
            .where(
                PlaybackOutbox.revision_id == revision_id,
                PlaybackOutbox.asset_kind == asset_kind,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if existing is not None:
        if existing.status == PlaybackOutboxStatus.SUPERSEDED:
            rearm_revision_outbox(existing)
        return existing

    outbox = _new_playback_outbox(
        score_id=score_id,
        revision_id=revision_id,
        requested_by_user_id=requested_by_user_id,
        source_fingerprint=source_fingerprint,
        asset_kind=asset_kind,
    )
    db.add(outbox)
    await db.flush()
    return outbox


def create_playback_outbox_sync(
    db: Session,
    *,
    score_id: int,
    revision_id: int,
    requested_by_user_id: int,
    source_fingerprint: str,
    asset_kind: PlaybackAssetKind = PlaybackAssetKind.AUDIO,
) -> PlaybackOutbox:
    existing = db.execute(
        select(PlaybackOutbox)
        .where(PlaybackOutbox.revision_id == revision_id, PlaybackOutbox.asset_kind == asset_kind)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if existing is not None:
        if existing.status == PlaybackOutboxStatus.SUPERSEDED:
            rearm_revision_outbox(existing)
        return existing
    outbox = _new_playback_outbox(
        score_id=score_id,
        revision_id=revision_id,
        requested_by_user_id=requested_by_user_id,
        source_fingerprint=source_fingerprint,
        asset_kind=asset_kind,
    )
    db.add(outbox)
    db.flush()
    return outbox


def _new_playback_outbox(
    *,
    score_id: int,
    revision_id: int,
    requested_by_user_id: int,
    source_fingerprint: str,
    asset_kind: PlaybackAssetKind = PlaybackAssetKind.AUDIO,
) -> PlaybackOutbox:
    traceparent, tracestate = get_async_trace_context()
    return PlaybackOutbox(
        outbox_uuid=str(uuid.uuid4()),
        score_id=score_id,
        revision_id=revision_id,
        requested_by_user_id=requested_by_user_id,
        originating_request_id=get_request_id(),
        traceparent=traceparent,
        tracestate=tracestate,
        source_fingerprint=source_fingerprint,
        asset_kind=asset_kind,
        status=PlaybackOutboxStatus.PENDING,
    )


class PlaybackOutboxService:
    def claim(self, db: Session, outbox_uuid: str) -> PlaybackOutboxPayload | None:
        target = db.execute(
            select(PlaybackOutbox).where(PlaybackOutbox.outbox_uuid == outbox_uuid)
        ).scalar_one_or_none()
        locked_score = lock_presentation_score(db, target.score_id) if target is not None else None
        outbox = db.execute(
            select(PlaybackOutbox)
            .where(PlaybackOutbox.outbox_uuid == outbox_uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if outbox is None or outbox.status in {
            PlaybackOutboxStatus.PROCESSING,
            PlaybackOutboxStatus.COMPLETED,
            PlaybackOutboxStatus.SUPERSEDED,
        }:
            return None
        demand = revision_presentation_demand(
            db, locked_score, outbox.revision_id, outbox.source_fingerprint
        )
        if demand == RevisionPresentationDemand.UNAVAILABLE:
            self._exhaust_unavailable_resources(outbox)
            return None
        if demand == RevisionPresentationDemand.NOT_DEMANDED:
            _delivery_lifecycle().reset(
                outbox,
                status=PlaybackOutboxStatus.SUPERSEDED,
                reset_attempts=False,
                now=utc_now_naive(),
            )
            clear_async_diagnostic(outbox)
            logger.bind(
                event="revision_derivative.superseded",
                score_id=outbox.score_id,
                revision_id=outbox.revision_id,
                outbox_id=outbox.outbox_uuid,
                operation_kind="playback",
            ).info("revision_derivative.superseded")
            return None
        lifecycle = _delivery_lifecycle()
        if lifecycle.claim_admission(outbox, now=utc_now_naive()) is not ClaimAdmission.READY:
            return None
        payload = self._build_payload(db, outbox)
        if payload is None:
            return None
        if not lifecycle.claim(outbox, now=utc_now_naive()):
            return None
        return replace(
            payload, attempt=outbox.attempt_count, max_attempts=lifecycle.policy.max_attempts
        )

    def _build_payload(self, db: Session, outbox: PlaybackOutbox) -> PlaybackOutboxPayload | None:
        payload = self._build_revision_audio_payload(db, outbox)
        if payload is not None:
            return payload

        self._exhaust_unavailable_resources(outbox)
        return None

    @staticmethod
    def _build_revision_audio_payload(
        db: Session,
        outbox: PlaybackOutbox,
    ) -> PlaybackOutboxPayload | None:
        score = db.get(Score, outbox.score_id)
        revision = db.get(ScoreRevision, outbox.revision_id)
        if (
            score is None
            or score.deletion_status != ScoreDeletionStatus.ACTIVE
            or revision is None
            or revision.score_id != outbox.score_id
            or revision.content_hash != outbox.source_fingerprint
        ):
            return None

        return PlaybackOutboxPayload(
            outbox_uuid=outbox.outbox_uuid,
            score_uuid=score.score_uuid,
            revision_uuid=revision.revision_uuid,
            source_fingerprint=outbox.source_fingerprint,
            asset_kind=outbox.asset_kind,
            attempt=0,
            max_attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
            originating_request_id=outbox.originating_request_id,
            traceparent=outbox.traceparent,
            tracestate=outbox.tracestate,
        )

    @staticmethod
    def _exhaust_unavailable_resources(outbox: PlaybackOutbox) -> None:
        _delivery_lifecycle().exhaust(
            outbox,
            error="Playback outbox references unavailable or stale resources",
            now=utc_now_naive(),
        )
        apply_async_diagnostic(
            outbox,
            kind=AsyncOperationKindValue.PLAYBACK,
            status=AsyncOperationStatusValue.EXHAUSTED,
            raw_status=outbox.status.value,
            last_error=outbox.last_error,
            attempts=outbox.attempt_count,
            max_attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
        )

    def supersede(self, db: Session, outbox_uuid: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or outbox.status != PlaybackOutboxStatus.PROCESSING:
            return
        _delivery_lifecycle().reset(
            outbox,
            status=PlaybackOutboxStatus.SUPERSEDED,
            reset_attempts=False,
            now=utc_now_naive(),
        )
        clear_async_diagnostic(outbox)

    def complete(self, db: Session, outbox_uuid: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or outbox.status == PlaybackOutboxStatus.SUPERSEDED:
            return
        _delivery_lifecycle().complete(outbox, now=utc_now_naive())
        clear_async_diagnostic(outbox)

    def fail(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or outbox.status == PlaybackOutboxStatus.SUPERSEDED:
            return
        _delivery_lifecycle().fail(outbox, error=error, now=utc_now_naive())
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

    def mark_dispatched(self, db: Session, outbox_uuid: str) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not _delivery_lifecycle().dispatch(outbox, now=utc_now_naive()):
            return False
        clear_async_diagnostic(outbox)
        return True

    def release_dispatch(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not _delivery_lifecycle().release_dispatch(
            outbox, error=error, now=utc_now_naive()
        ):
            return
        apply_async_diagnostic(
            outbox,
            kind=AsyncOperationKindValue.PLAYBACK,
            status=AsyncOperationStatusValue.QUEUED,
            raw_status=outbox.status.value,
            last_error=outbox.last_error,
            attempts=outbox.attempt_count,
            max_attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
        )

    def recover_and_list_due(self, db: Session) -> list[str]:
        now = utc_now_naive()
        stale = (
            db.execute(
                select(PlaybackOutbox).where(
                    or_(
                        PlaybackOutbox.status == PlaybackOutboxStatus.DISPATCHED,
                        PlaybackOutbox.status == PlaybackOutboxStatus.PROCESSING,
                    )
                )
            )
            .scalars()
            .all()
        )
        for outbox in stale:
            if _delivery_lifecycle().recover_lease(
                outbox, error="Playback delivery lease expired", now=now
            ):
                apply_async_diagnostic(
                    outbox,
                    kind=AsyncOperationKindValue.PLAYBACK,
                    status=AsyncOperationStatusValue.FAILED,
                    raw_status=outbox.status.value,
                    last_error=outbox.last_error,
                    attempts=outbox.attempt_count,
                    max_attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
                )

        due = (
            db.execute(
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
            )
            .scalars()
            .all()
        )
        db.commit()
        return list(due)

    @staticmethod
    def _get(db: Session, outbox_uuid: str) -> PlaybackOutbox | None:
        return db.execute(
            select(PlaybackOutbox)
            .where(PlaybackOutbox.outbox_uuid == outbox_uuid)
            .with_for_update()
        ).scalar_one_or_none()


playback_outbox_service = PlaybackOutboxService()


def rearm_revision_outbox(outbox: PlaybackOutbox) -> None:
    _delivery_lifecycle().rearm(outbox, now=utc_now_naive())
    clear_async_diagnostic(outbox)
    logger.bind(
        event="revision_derivative.reactivated",
        score_id=outbox.score_id,
        revision_id=outbox.revision_id,
        outbox_id=outbox.outbox_uuid,
        operation_kind="playback",
    ).info("revision_derivative.reactivated")

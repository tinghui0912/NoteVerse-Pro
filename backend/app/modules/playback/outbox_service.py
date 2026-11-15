from __future__ import annotations

import uuid
from dataclasses import dataclass, asdict

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.async_trace_context import get_async_trace_context
from app.core.config import settings
from app.core.logger import logger
from app.core.request_correlation import get_request_id
from app.db.models import (
    PlaybackAssetKind,
    PlaybackOutbox,
    PlaybackOutboxStatus,
    Score,
    ScoreRevision,
)
from app.modules.durable_work.failure import (
    DurableFailure,
    DurableFailureClass,
    set_failure_facts,
    clear_failure_facts,
)
from app.modules.durable_work.delivery import (
    ClaimAdmission,
    DeliveryLifecyclePolicy,
    DeliveryStatuses,
    DurableDeliveryLifecycle,
    DeliveryAttemptLease,
    StaleDeliveryAttempt,
)
from app.shared.time import utc_now
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
            retry_base_seconds=settings.PLAYBACK_OUTBOX_RETRY_BASE_SECONDS,
            dispatch_timeout_seconds=settings.PLAYBACK_OUTBOX_DISPATCH_TIMEOUT_SECONDS,
            processing_timeout_seconds=settings.PLAYBACK_OUTBOX_PROCESSING_TIMEOUT_SECONDS,
            max_attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
        ),
    )


@dataclass(frozen=True)
class PlaybackTarget:
    outbox_uuid: str
    score_uuid: str
    revision_uuid: str
    source_fingerprint: str
    asset_kind: PlaybackAssetKind
    originating_request_id: str | None = None
    traceparent: str | None = None
    tracestate: str | None = None


@dataclass(frozen=True, kw_only=True)
class PlaybackOutboxPayload(PlaybackTarget):
    lease: DeliveryAttemptLease
    max_attempts: int


def create_playback_outbox(
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
    def require_attempt(
        self,
        db: Session,
        *,
        outbox_uuid: str,
        lease: DeliveryAttemptLease,
        score_id: int,
        revision_id: int,
        source_fingerprint: str,
        asset_kind: PlaybackAssetKind,
    ) -> PlaybackOutbox:
        """Caller holds Score; refresh the delivery fence before semantic mutation."""
        row = self._get(db, outbox_uuid)
        if row is None or not _delivery_lifecycle().attempt_matches(row, lease):
            raise StaleDeliveryAttempt("Playback execution lease is stale")
        if (row.score_id, row.revision_id, row.source_fingerprint, row.asset_kind) != (
            score_id,
            revision_id,
            source_fingerprint,
            asset_kind,
        ):
            raise StaleDeliveryAttempt("Playback attempt target disagrees with execution")
        return row

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
                now=utc_now(),
            )
            clear_failure_facts(outbox)
            logger.bind(
                event="revision_derivative.superseded",
                score_id=outbox.score_id,
                revision_id=outbox.revision_id,
                outbox_id=outbox.outbox_uuid,
                operation_kind="playback",
            ).info("revision_derivative.superseded")
            return None
        lifecycle = _delivery_lifecycle()
        admission = lifecycle.claim_admission(outbox, now=utc_now())
        if admission is ClaimAdmission.EXHAUSTED:
            lifecycle.exhaust(outbox, error="Playback delivery attempts exhausted", now=utc_now())
            self._record_failure(
                outbox,
                code="playback_attempts_exhausted",
                stage="playback",
                classification=DurableFailureClass.TRANSIENT,
            )
            return None
        if admission is not ClaimAdmission.READY:
            return None
        payload = self._build_payload(db, outbox)
        if payload is None:
            return None
        lease = lifecycle.claim(outbox, token=str(uuid.uuid4()), now=utc_now())
        if lease is None:
            return None
        clear_failure_facts(outbox)
        return PlaybackOutboxPayload(
            **asdict(payload), lease=lease, max_attempts=lifecycle.policy.max_attempts
        )

    def _build_payload(self, db: Session, outbox: PlaybackOutbox) -> PlaybackTarget | None:
        payload = self._build_revision_audio_payload(db, outbox)
        if payload is not None:
            return payload

        self._exhaust_unavailable_resources(outbox)
        return None

    @staticmethod
    def _build_revision_audio_payload(
        db: Session,
        outbox: PlaybackOutbox,
    ) -> PlaybackTarget | None:
        score = db.get(Score, outbox.score_id)
        revision = db.get(ScoreRevision, outbox.revision_id)
        if (
            score is None
            or score.deleted_at is not None
            or revision is None
            or revision.score_id != outbox.score_id
            or revision.content_hash != outbox.source_fingerprint
        ):
            return None

        return PlaybackTarget(
            outbox_uuid=outbox.outbox_uuid,
            score_uuid=score.score_uuid,
            revision_uuid=revision.revision_uuid,
            source_fingerprint=outbox.source_fingerprint,
            asset_kind=outbox.asset_kind,
            originating_request_id=outbox.originating_request_id,
            traceparent=outbox.traceparent,
            tracestate=outbox.tracestate,
        )

    @staticmethod
    def _exhaust_unavailable_resources(outbox: PlaybackOutbox) -> None:
        _delivery_lifecycle().exhaust(
            outbox,
            error="Playback outbox references unavailable or stale resources",
            now=utc_now(),
        )
        set_failure_facts(
            outbox,
            DurableFailure(
                "playback_resources_unavailable", "playback", DurableFailureClass.PERMANENT, False
            ),
            detail=outbox.failure_detail,
        )

    def supersede(self, db: Session, outbox_uuid: str, *, lease: DeliveryAttemptLease) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not _delivery_lifecycle().attempt_matches(outbox, lease):
            return False
        _delivery_lifecycle().reset(
            outbox,
            status=PlaybackOutboxStatus.SUPERSEDED,
            reset_attempts=False,
            now=utc_now(),
        )
        clear_failure_facts(outbox)
        return True

    def complete(self, db: Session, outbox_uuid: str, *, lease: DeliveryAttemptLease) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not _delivery_lifecycle().complete_attempt(
            outbox, lease=lease, now=utc_now()
        ):
            return False
        clear_failure_facts(outbox)
        return True

    def fail(
        self, db: Session, outbox_uuid: str, error: str, *, lease: DeliveryAttemptLease
    ) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not _delivery_lifecycle().fail_attempt(
            outbox, lease=lease, error=error, now=utc_now()
        ):
            return False
        self._record_failure(
            outbox,
            code="playback_execution_failed",
            stage="playback",
            classification=DurableFailureClass.SYSTEM_ERROR,
        )
        return True

    def mark_dispatched(self, db: Session, outbox_uuid: str) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not _delivery_lifecycle().dispatch(outbox, now=utc_now()):
            return False
        clear_failure_facts(outbox)
        return True

    def release_dispatch(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not _delivery_lifecycle().release_dispatch(
            outbox, error=error, now=utc_now()
        ):
            return
        self._record_failure(
            outbox,
            code="playback_dispatch_failed",
            stage="dispatch",
            classification=DurableFailureClass.TRANSIENT,
        )

    def recover_and_list_due(self, db: Session) -> list[str]:
        now = utc_now()
        stale = (
            db.execute(
                select(PlaybackOutbox)
                .where(
                    or_(
                        PlaybackOutbox.status == PlaybackOutboxStatus.DISPATCHED,
                        PlaybackOutbox.status == PlaybackOutboxStatus.PROCESSING,
                    )
                )
                .with_for_update(skip_locked=True)
                .execution_options(populate_existing=True)
            )
            .scalars()
            .all()
        )
        for outbox in stale:
            if _delivery_lifecycle().recover_lease(
                outbox, error="Playback delivery lease expired", now=now
            ):
                self._record_failure(
                    outbox,
                    code="playback_delivery_lease_expired",
                    stage="playback",
                    classification=DurableFailureClass.TRANSIENT,
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
    def _record_failure(
        outbox: PlaybackOutbox, *, code: str, stage: str, classification: DurableFailureClass
    ) -> None:
        retryable = outbox.attempt_count < settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS
        set_failure_facts(
            outbox,
            DurableFailure(
                code if retryable else "playback_attempts_exhausted",
                stage,
                classification,
                retryable,
            ),
            detail=outbox.failure_detail,
        )

    def rearm_for_operator(self, db: Session, operation_id: str) -> str:
        from app.core.exceptions import ResourceNotFoundException, ValidationException

        outbox = self._get(db, operation_id)
        if outbox is None:
            raise ResourceNotFoundException("async_operation", operation_id)
        if (
            outbox.status not in (PlaybackOutboxStatus.PENDING, PlaybackOutboxStatus.FAILED)
            or outbox.failure_code is None
        ):
            raise ValidationException(field="status", details={"status": outbox.status.value})
        previous = outbox.status.value
        _delivery_lifecycle().rearm(outbox, now=utc_now())
        clear_failure_facts(outbox)
        return previous

    @staticmethod
    def _get(db: Session, outbox_uuid: str) -> PlaybackOutbox | None:
        return db.execute(
            select(PlaybackOutbox)
            .where(PlaybackOutbox.outbox_uuid == outbox_uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()


playback_outbox_service = PlaybackOutboxService()


def rearm_revision_outbox(outbox: PlaybackOutbox) -> None:
    _delivery_lifecycle().rearm(outbox, now=utc_now())
    clear_failure_facts(outbox)
    logger.bind(
        event="revision_derivative.reactivated",
        score_id=outbox.score_id,
        revision_id=outbox.revision_id,
        outbox_id=outbox.outbox_uuid,
        operation_kind="playback",
    ).info("revision_derivative.reactivated")

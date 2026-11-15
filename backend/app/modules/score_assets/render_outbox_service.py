from __future__ import annotations

import uuid
from dataclasses import asdict

from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from sqlmodel import col

from app.core.async_trace_context import get_async_trace_context
from app.core.config import settings
from app.core.logger import logger
from app.core.request_correlation import get_request_id
from app.db.models import (
    ImportJob,
    RenderOutbox,
    RenderOutboxStatus,
    RenderTargetType,
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
    DeliveryAttemptLease,
    StaleDeliveryAttempt,
)
from app.modules.score_assets import render_payloads
from app.utils.timezone import utc_now_naive
from app.modules.revisions.presentation_demand import (
    revision_presentation_demand,
    lock_presentation_score,
    RevisionPresentationDemand,
)


def _delivery_lifecycle() -> DurableDeliveryLifecycle[RenderOutboxStatus]:
    return DurableDeliveryLifecycle(
        statuses=DeliveryStatuses(
            pending=RenderOutboxStatus.PENDING,
            dispatched=RenderOutboxStatus.DISPATCHED,
            processing=RenderOutboxStatus.PROCESSING,
            failed=RenderOutboxStatus.FAILED,
            succeeded=RenderOutboxStatus.COMPLETED,
        ),
        policy=DeliveryLifecyclePolicy(
            max_attempts=settings.RENDER_OUTBOX_MAX_ATTEMPTS,
            retry_base_seconds=settings.RENDER_OUTBOX_RETRY_BASE_SECONDS,
            dispatch_timeout_seconds=settings.RENDER_OUTBOX_DISPATCH_TIMEOUT_SECONDS,
            processing_timeout_seconds=settings.RENDER_OUTBOX_PROCESSING_TIMEOUT_SECONDS,
        ),
    )


def create_revision_render_outbox(
    db: Session,
    *,
    score_id: int,
    revision_id: int,
    requested_by_user_id: int,
    source_fingerprint: str,
    render_profile: str = "default",
) -> RenderOutbox:
    existing = db.execute(
        select(RenderOutbox)
        .where(
            RenderOutbox.revision_id == revision_id, RenderOutbox.render_profile == render_profile
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if existing is not None:
        if existing.status == RenderOutboxStatus.SUPERSEDED:
            rearm_revision_outbox(existing)
        return existing
    outbox = _new_revision_render_outbox(
        score_id=score_id,
        revision_id=revision_id,
        requested_by_user_id=requested_by_user_id,
        source_fingerprint=source_fingerprint,
        render_profile=render_profile,
    )
    db.add(outbox)
    db.flush()
    return outbox


def _new_revision_render_outbox(
    *,
    score_id: int,
    revision_id: int,
    requested_by_user_id: int,
    source_fingerprint: str,
    render_profile: str = "default",
) -> RenderOutbox:
    traceparent, tracestate = get_async_trace_context()
    return RenderOutbox(
        outbox_uuid=str(uuid.uuid4()),
        target_type=RenderTargetType.SCORE_REVISION,
        score_id=score_id,
        revision_id=revision_id,
        requested_by_user_id=requested_by_user_id,
        originating_request_id=get_request_id(),
        traceparent=traceparent,
        tracestate=tracestate,
        source_fingerprint=source_fingerprint,
        render_profile=render_profile,
        status=RenderOutboxStatus.PENDING,
    )


def create_review_thumbnail_render_outbox(
    db: Session,
    *,
    import_job_id: int,
    source_fingerprint: str,
    render_profile: str = "review-thumbnail",
) -> RenderOutbox:
    existing = db.execute(
        select(RenderOutbox).where(
            RenderOutbox.import_job_id == import_job_id,
            RenderOutbox.render_profile == render_profile,
            RenderOutbox.source_fingerprint == source_fingerprint,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    outbox = _new_review_thumbnail_outbox(
        import_job_id=import_job_id,
        source_fingerprint=source_fingerprint,
        render_profile=render_profile,
    )
    db.add(outbox)
    db.flush()
    return outbox


def _new_review_thumbnail_outbox(
    *, import_job_id: int, source_fingerprint: str, render_profile: str
) -> RenderOutbox:
    traceparent, tracestate = get_async_trace_context()
    return RenderOutbox(
        outbox_uuid=str(uuid.uuid4()),
        target_type=RenderTargetType.REVIEW_THUMBNAIL,
        import_job_id=import_job_id,
        originating_request_id=get_request_id(),
        traceparent=traceparent,
        tracestate=tracestate,
        source_fingerprint=source_fingerprint,
        render_profile=render_profile,
        status=RenderOutboxStatus.PENDING,
    )


class RenderOutboxService:
    def require_revision_attempt(
        self,
        db: Session,
        *,
        outbox_uuid: str,
        lease: DeliveryAttemptLease,
        score_id: int,
        revision_id: int,
        source_fingerprint: str,
        profile: str,
    ) -> RenderOutbox:
        """Caller holds Score; acquire the refreshed delivery row before adoption."""
        row = self._require_attempt(db, outbox_uuid, lease)
        if (
            row.target_type,
            row.score_id,
            row.revision_id,
            row.source_fingerprint,
            row.render_profile,
        ) != (
            RenderTargetType.SCORE_REVISION,
            score_id,
            revision_id,
            source_fingerprint,
            profile,
        ):
            raise StaleDeliveryAttempt("Render attempt target disagrees with execution")
        return row

    def require_thumbnail_attempt(
        self,
        db: Session,
        *,
        outbox_uuid: str,
        lease: DeliveryAttemptLease,
        job_id: int,
        source_fingerprint: str,
        profile: str,
    ) -> RenderOutbox:
        """Caller holds ImportJob; acquire the refreshed delivery row before adoption."""
        row = self._require_attempt(db, outbox_uuid, lease)
        if (row.target_type, row.import_job_id, row.source_fingerprint, row.render_profile) != (
            RenderTargetType.REVIEW_THUMBNAIL,
            job_id,
            source_fingerprint,
            profile,
        ):
            raise StaleDeliveryAttempt("Thumbnail attempt target disagrees with execution")
        return row

    def _require_attempt(self, db: Session, uuid: str, lease: DeliveryAttemptLease) -> RenderOutbox:
        row = self._get(db, uuid)
        if row is None or not _delivery_lifecycle().attempt_matches(row, lease):
            raise StaleDeliveryAttempt("Render execution lease is stale")
        return row

    def __init__(
        self,
        payload_builder: render_payloads.RenderPayloadBuilder | None = None,
    ) -> None:
        self.payload_builder = payload_builder or render_payloads.RenderPayloadBuilder()

    def claim(self, db: Session, outbox_uuid: str) -> render_payloads.RenderOutboxPayload | None:
        target = db.execute(
            select(RenderOutbox).where(RenderOutbox.outbox_uuid == outbox_uuid)
        ).scalar_one_or_none()
        locked_score = (
            lock_presentation_score(db, target.score_id)
            if target is not None and target.target_type == RenderTargetType.SCORE_REVISION
            else None
        )
        if target is not None and target.target_type == RenderTargetType.REVIEW_THUMBNAIL:
            db.execute(
                select(ImportJob)
                .where(ImportJob.id == target.import_job_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            ).scalar_one_or_none()
        outbox = db.execute(
            select(RenderOutbox)
            .where(RenderOutbox.outbox_uuid == outbox_uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if outbox is None or outbox.status in {
            RenderOutboxStatus.PROCESSING,
            RenderOutboxStatus.COMPLETED,
            RenderOutboxStatus.SUPERSEDED,
        }:
            return None
        demand = (
            revision_presentation_demand(
                db, locked_score, outbox.revision_id, outbox.source_fingerprint
            )
            if outbox.target_type == RenderTargetType.SCORE_REVISION
            else None
        )
        if demand == RevisionPresentationDemand.UNAVAILABLE:
            self._exhaust_unavailable_resources(outbox)
            return None
        if demand == RevisionPresentationDemand.NOT_DEMANDED:
            _delivery_lifecycle().reset(
                outbox,
                status=RenderOutboxStatus.SUPERSEDED,
                reset_attempts=False,
                now=utc_now_naive(),
            )
            clear_async_diagnostic(outbox)
            logger.bind(
                event="revision_derivative.superseded",
                score_id=outbox.score_id,
                revision_id=outbox.revision_id,
                outbox_id=outbox.outbox_uuid,
                operation_kind="render",
            ).info("revision_derivative.superseded")
            return None
        lifecycle = _delivery_lifecycle()
        if lifecycle.claim_admission(outbox, now=utc_now_naive()) is not ClaimAdmission.READY:
            return None
        payload = self._build_payload(db, outbox)
        if payload is None:
            return None
        lease = lifecycle.claim(outbox, token=str(uuid.uuid4()), now=utc_now_naive())
        if lease is None:
            return None
        return render_payloads.RenderOutboxPayload(
            **asdict(payload), lease=lease, max_attempts=lifecycle.policy.max_attempts
        )

    def _build_payload(
        self, db: Session, outbox: RenderOutbox
    ) -> render_payloads.RenderTarget | None:
        result = self.payload_builder.build(db, outbox)
        if result.payload is not None:
            return result.payload

        if result.terminal_completed:
            _delivery_lifecycle().finish(
                outbox, status=RenderOutboxStatus.COMPLETED, error=None, now=utc_now_naive()
            )
            clear_async_diagnostic(outbox)
            return None

        if outbox.status == RenderOutboxStatus.COMPLETED:
            return None
        self._exhaust_unavailable_resources(outbox)
        return None

    @staticmethod
    def _exhaust_unavailable_resources(outbox: RenderOutbox) -> None:
        _delivery_lifecycle().exhaust(
            outbox, error="Render outbox references unavailable resources", now=utc_now_naive()
        )
        apply_async_diagnostic(
            outbox,
            kind=AsyncOperationKindValue.RENDER,
            status=AsyncOperationStatusValue.EXHAUSTED,
            raw_status=outbox.status.value,
            last_error=outbox.last_error,
            attempts=outbox.attempt_count,
            max_attempts=settings.RENDER_OUTBOX_MAX_ATTEMPTS,
        )

    def supersede(self, db: Session, outbox_uuid: str, *, lease: DeliveryAttemptLease) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not _delivery_lifecycle().attempt_matches(outbox, lease):
            return False
        _delivery_lifecycle().reset(
            outbox, status=RenderOutboxStatus.SUPERSEDED, reset_attempts=False, now=utc_now_naive()
        )
        clear_async_diagnostic(outbox)
        return True

    def complete(self, db: Session, outbox_uuid: str, *, lease: DeliveryAttemptLease) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not _delivery_lifecycle().complete_attempt(
            outbox, lease=lease, now=utc_now_naive()
        ):
            return False
        clear_async_diagnostic(outbox)
        return True

    def fail(
        self, db: Session, outbox_uuid: str, error: str, *, lease: DeliveryAttemptLease
    ) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not _delivery_lifecycle().fail_attempt(
            outbox, lease=lease, error=error, now=utc_now_naive()
        ):
            return False
        apply_async_diagnostic(
            outbox,
            kind=AsyncOperationKindValue.RENDER,
            status=(
                AsyncOperationStatusValue.EXHAUSTED
                if outbox.attempt_count >= settings.RENDER_OUTBOX_MAX_ATTEMPTS
                else AsyncOperationStatusValue.RETRYING
            ),
            raw_status=outbox.status.value,
            last_error=outbox.last_error,
            attempts=outbox.attempt_count,
            max_attempts=settings.RENDER_OUTBOX_MAX_ATTEMPTS,
        )
        return True

    def target_type(self, db: Session, outbox_uuid: str) -> RenderTargetType | None:
        return db.execute(
            select(RenderOutbox.target_type).where(RenderOutbox.outbox_uuid == outbox_uuid)
        ).scalar_one_or_none()

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
            kind=AsyncOperationKindValue.RENDER,
            status=AsyncOperationStatusValue.QUEUED,
            raw_status=outbox.status.value,
            last_error=outbox.last_error,
            attempts=outbox.attempt_count,
            max_attempts=settings.RENDER_OUTBOX_MAX_ATTEMPTS,
        )

    def recover_and_list_due(self, db: Session) -> list[str]:
        now = utc_now_naive()
        stale = (
            db.execute(
                select(RenderOutbox)
                .where(
                    or_(
                        RenderOutbox.status == RenderOutboxStatus.DISPATCHED,
                        RenderOutbox.status == RenderOutboxStatus.PROCESSING,
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
                outbox, error="Render delivery lease expired", now=now
            ):
                apply_async_diagnostic(
                    outbox,
                    kind=AsyncOperationKindValue.RENDER,
                    status=AsyncOperationStatusValue.FAILED,
                    raw_status=outbox.status.value,
                    last_error=outbox.last_error,
                    attempts=outbox.attempt_count,
                    max_attempts=settings.RENDER_OUTBOX_MAX_ATTEMPTS,
                )

        due = (
            db.execute(
                select(RenderOutbox.outbox_uuid)
                .where(
                    col(RenderOutbox.status).in_(
                        [RenderOutboxStatus.PENDING, RenderOutboxStatus.FAILED]
                    ),
                    RenderOutbox.next_attempt_at <= now,
                    RenderOutbox.attempt_count < settings.RENDER_OUTBOX_MAX_ATTEMPTS,
                )
                .order_by(RenderOutbox.created_at)
                .limit(settings.RENDER_OUTBOX_DISPATCH_BATCH_SIZE)
            )
            .scalars()
            .all()
        )
        db.commit()
        return list(due)

    @staticmethod
    def _get(db: Session, outbox_uuid: str) -> RenderOutbox | None:
        return db.execute(
            select(RenderOutbox)
            .where(RenderOutbox.outbox_uuid == outbox_uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()


render_outbox_service = RenderOutboxService()


def rearm_revision_outbox(outbox: RenderOutbox) -> None:
    _delivery_lifecycle().rearm(outbox, now=utc_now_naive())
    clear_async_diagnostic(outbox)
    logger.bind(
        event="revision_derivative.reactivated",
        score_id=outbox.score_id,
        revision_id=outbox.revision_id,
        outbox_id=outbox.outbox_uuid,
        operation_kind="render",
    ).info("revision_derivative.reactivated")

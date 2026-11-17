from __future__ import annotations

import uuid

from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from sqlmodel import col

from app.core.config import settings
from app.core.logger import logger
from app.db.models import (
    ScoreRevisionRenderOutbox,
    ScoreRevisionRenderStatus,
)
from app.modules.durable_work.failure import (
    DurableFailure,
    set_failure_facts,
    clear_failure_facts,
)
from app.shared.durable_failure import DurableFailureClass
from app.modules.durable_work.delivery import (
    ClaimAdmission,
    DeliveryLifecyclePolicy,
    DeliveryStatuses,
    DurableDeliveryLifecycle,
    DeliveryAttemptLease,
    StaleDeliveryAttempt,
)
from app.modules.revisions import render_target as targets
from app.shared.time import utc_now
from app.modules.revisions.presentation_demand import (
    revision_presentation_demand,
    lock_presentation_score,
    RevisionPresentationDemand,
)


def _delivery_lifecycle() -> DurableDeliveryLifecycle[ScoreRevisionRenderStatus]:
    return DurableDeliveryLifecycle(
        statuses=DeliveryStatuses(
            pending=ScoreRevisionRenderStatus.PENDING,
            dispatched=ScoreRevisionRenderStatus.DISPATCHED,
            processing=ScoreRevisionRenderStatus.PROCESSING,
            failed=ScoreRevisionRenderStatus.FAILED,
            succeeded=ScoreRevisionRenderStatus.COMPLETED,
        ),
        policy=DeliveryLifecyclePolicy(
            max_attempts=settings.REVISION_RENDER_MAX_ATTEMPTS,
            retry_base_seconds=settings.REVISION_RENDER_RETRY_BASE_SECONDS,
            dispatch_timeout_seconds=settings.REVISION_RENDER_DISPATCH_TIMEOUT_SECONDS,
            processing_timeout_seconds=settings.REVISION_RENDER_PROCESSING_TIMEOUT_SECONDS,
        ),
    )


class ScoreRevisionRenderDelivery:
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
    ) -> ScoreRevisionRenderOutbox:
        """Caller holds Score; acquire the refreshed delivery row before adoption."""
        row = self._require_attempt(db, outbox_uuid, lease)
        if (
            row.score_id,
            row.revision_id,
            row.source_fingerprint,
            row.render_profile,
        ) != (
            score_id,
            revision_id,
            source_fingerprint,
            profile,
        ):
            raise StaleDeliveryAttempt("Render attempt target disagrees with execution")
        return row

    def _require_attempt(
        self, db: Session, uuid: str, lease: DeliveryAttemptLease
    ) -> ScoreRevisionRenderOutbox:
        row = self._get(db, uuid)
        if row is None or not _delivery_lifecycle().attempt_matches(row, lease):
            raise StaleDeliveryAttempt("Render execution lease is stale")
        return row

    def claim(self, db: Session, outbox_uuid: str) -> targets.ScoreRevisionRenderAttempt | None:
        target = db.execute(
            select(ScoreRevisionRenderOutbox).where(
                ScoreRevisionRenderOutbox.outbox_uuid == outbox_uuid
            )
        ).scalar_one_or_none()
        locked_score = lock_presentation_score(db, target.score_id) if target is not None else None
        outbox = db.execute(
            select(ScoreRevisionRenderOutbox)
            .where(ScoreRevisionRenderOutbox.outbox_uuid == outbox_uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if outbox is None or outbox.status in {
            ScoreRevisionRenderStatus.PROCESSING,
            ScoreRevisionRenderStatus.COMPLETED,
            ScoreRevisionRenderStatus.SUPERSEDED,
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
                status=ScoreRevisionRenderStatus.SUPERSEDED,
                reset_attempts=False,
                now=utc_now(),
            )
            clear_failure_facts(outbox)
            logger.bind(
                event="revision_derivative.superseded",
                score_id=outbox.score_id,
                revision_id=outbox.revision_id,
                outbox_id=outbox.outbox_uuid,
                operation_kind="revision_render",
            ).info("revision_derivative.superseded")
            return None
        lifecycle = _delivery_lifecycle()
        admission = lifecycle.claim_admission(outbox, now=utc_now())
        if admission is ClaimAdmission.EXHAUSTED:
            lifecycle.exhaust(outbox, error="Render delivery attempts exhausted", now=utc_now())
            self._record_failure(
                outbox,
                code="render_attempts_exhausted",
                stage="render",
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
        return targets.ScoreRevisionRenderAttempt(
            target=payload, lease=lease, max_attempts=lifecycle.policy.max_attempts
        )

    def _build_payload(
        self, db: Session, outbox: ScoreRevisionRenderOutbox
    ) -> targets.ScoreRevisionRenderTarget | None:
        payload = targets.revision_render_target(db, outbox)
        if payload is None:
            self._exhaust_unavailable_resources(outbox)
        return payload

    @staticmethod
    def _exhaust_unavailable_resources(outbox: ScoreRevisionRenderOutbox) -> None:
        _delivery_lifecycle().exhaust(
            outbox, error="Render outbox references unavailable resources", now=utc_now()
        )
        set_failure_facts(
            outbox,
            DurableFailure(
                "render_resources_unavailable", "render", DurableFailureClass.PERMANENT, False
            ),
            detail=outbox.failure_detail,
        )

    def supersede(self, db: Session, outbox_uuid: str, *, lease: DeliveryAttemptLease) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not _delivery_lifecycle().attempt_matches(outbox, lease):
            return False
        _delivery_lifecycle().reset(
            outbox, status=ScoreRevisionRenderStatus.SUPERSEDED, reset_attempts=False, now=utc_now()
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
            code="render_execution_failed",
            stage="render",
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
            code="render_dispatch_failed",
            stage="dispatch",
            classification=DurableFailureClass.TRANSIENT,
        )

    def recover_and_list_due(self, db: Session) -> list[str]:
        now = utc_now()
        stale = (
            db.execute(
                select(ScoreRevisionRenderOutbox)
                .where(
                    or_(
                        ScoreRevisionRenderOutbox.status == ScoreRevisionRenderStatus.DISPATCHED,
                        ScoreRevisionRenderOutbox.status == ScoreRevisionRenderStatus.PROCESSING,
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
                self._record_failure(
                    outbox,
                    code="render_delivery_lease_expired",
                    stage="render",
                    classification=DurableFailureClass.TRANSIENT,
                )

        due = (
            db.execute(
                select(ScoreRevisionRenderOutbox.outbox_uuid)
                .where(
                    col(ScoreRevisionRenderOutbox.status).in_(
                        [ScoreRevisionRenderStatus.PENDING, ScoreRevisionRenderStatus.FAILED]
                    ),
                    ScoreRevisionRenderOutbox.next_attempt_at <= now,
                    ScoreRevisionRenderOutbox.attempt_count < settings.REVISION_RENDER_MAX_ATTEMPTS,
                )
                .order_by(ScoreRevisionRenderOutbox.created_at)
                .limit(settings.REVISION_RENDER_DISPATCH_BATCH_SIZE)
            )
            .scalars()
            .all()
        )
        db.commit()
        return list(due)

    @staticmethod
    def _record_failure(
        outbox: ScoreRevisionRenderOutbox,
        *,
        code: str,
        stage: str,
        classification: DurableFailureClass,
    ) -> None:
        retryable = outbox.attempt_count < settings.REVISION_RENDER_MAX_ATTEMPTS
        set_failure_facts(
            outbox,
            DurableFailure(
                code if retryable else "render_attempts_exhausted",
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
            outbox.status
            not in (ScoreRevisionRenderStatus.PENDING, ScoreRevisionRenderStatus.FAILED)
            or outbox.failure_code is None
        ):
            raise ValidationException(field="status", details={"status": outbox.status.value})
        previous = outbox.status.value
        _delivery_lifecycle().rearm(outbox, now=utc_now())
        clear_failure_facts(outbox)
        return previous

    @staticmethod
    def _get(db: Session, outbox_uuid: str) -> ScoreRevisionRenderOutbox | None:
        return db.execute(
            select(ScoreRevisionRenderOutbox)
            .where(ScoreRevisionRenderOutbox.outbox_uuid == outbox_uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()


revision_render_delivery = ScoreRevisionRenderDelivery()


def rearm_revision_outbox(outbox: ScoreRevisionRenderOutbox) -> None:
    _delivery_lifecycle().rearm(outbox, now=utc_now())
    clear_failure_facts(outbox)
    logger.bind(
        event="revision_derivative.reactivated",
        score_id=outbox.score_id,
        revision_id=outbox.revision_id,
        outbox_id=outbox.outbox_uuid,
        operation_kind="revision_render",
    ).info("revision_derivative.reactivated")

from __future__ import annotations


from dataclasses import dataclass, replace

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import (
    PerformanceTakeDeleteOutbox,
    PerformanceTakeDeleteOutboxStatus,
)
from app.modules.async_operations.durable_delivery import (
    ClaimAdmission,
    DeliveryLifecyclePolicy,
    DeliveryStatuses,
    DurableDeliveryLifecycle,
)
from app.utils.timezone import utc_now_naive


def _delivery_lifecycle() -> DurableDeliveryLifecycle[str]:
    return DurableDeliveryLifecycle(
        statuses=DeliveryStatuses(
            pending=PerformanceTakeDeleteOutboxStatus.PENDING.value,
            dispatched=PerformanceTakeDeleteOutboxStatus.DISPATCHED.value,
            processing=PerformanceTakeDeleteOutboxStatus.PROCESSING.value,
            failed=PerformanceTakeDeleteOutboxStatus.FAILED.value,
            succeeded=PerformanceTakeDeleteOutboxStatus.COMPLETED.value,
        ),
        policy=DeliveryLifecyclePolicy(
            max_attempts=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS,
            retry_base_seconds=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_RETRY_BASE_SECONDS,
            dispatch_timeout_seconds=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_TIMEOUT_SECONDS,
            processing_timeout_seconds=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_PROCESSING_TIMEOUT_SECONDS,
        ),
    )


@dataclass(frozen=True)
class PerformanceTakeDeletePayload:
    outbox_uuid: str
    take_id: int
    take_uuid: str
    user_id: int

    object_key: str
    media_byte_size: int
    attempt: int
    max_attempts: int


class PerformanceTakeDeleteOutboxService:
    def claim(
        self,
        db: Session,
        outbox_uuid: str,
    ) -> PerformanceTakeDeletePayload | None:
        outbox = db.execute(
            select(PerformanceTakeDeleteOutbox)
            .where(PerformanceTakeDeleteOutbox.outbox_uuid == outbox_uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if outbox is None:
            return None
        lifecycle = _delivery_lifecycle()
        if lifecycle.claim_admission(outbox, now=utc_now_naive()) is not ClaimAdmission.READY:
            return None

        payload = self._build_payload(outbox)
        if not lifecycle.claim(outbox, now=utc_now_naive()):
            return None
        return replace(
            payload, attempt=outbox.attempt_count, max_attempts=lifecycle.policy.max_attempts
        )

    def _build_payload(
        self,
        outbox: PerformanceTakeDeleteOutbox,
    ) -> PerformanceTakeDeletePayload:
        return PerformanceTakeDeletePayload(
            outbox_uuid=outbox.outbox_uuid,
            take_id=outbox.take_id,
            take_uuid=outbox.take_uuid,
            user_id=outbox.user_id,
            object_key=outbox.object_key,
            media_byte_size=outbox.media_byte_size,
            attempt=0,
            max_attempts=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS,
        )

    def complete(self, db: Session, outbox_uuid: str, *, attempt: int | None = None) -> bool:
        outbox = self._get(db, outbox_uuid, lock=True)
        if outbox is None:
            return False
        return _delivery_lifecycle().complete_attempt(
            outbox, expected_attempt=attempt, now=utc_now_naive()
        )

    def fail(
        self,
        db: Session,
        outbox_uuid: str,
        error: str,
        *,
        attempt: int | None = None,
    ) -> bool:
        outbox = self._get(db, outbox_uuid, lock=True)
        if outbox is None:
            return False
        return _delivery_lifecycle().fail_attempt(
            outbox, expected_attempt=attempt, error=error, now=utc_now_naive()
        )

    def mark_dispatched(self, db: Session, outbox_uuid: str) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not _delivery_lifecycle().dispatch(outbox, now=utc_now_naive()):
            return False
        return True

    def release_dispatch(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is not None:
            _delivery_lifecycle().release_dispatch(outbox, error=error, now=utc_now_naive())

    def recover_and_list_due(self, db: Session) -> list[str]:
        now = utc_now_naive()
        stale = db.execute(
            select(PerformanceTakeDeleteOutbox).where(
                or_(
                    PerformanceTakeDeleteOutbox.status
                    == PerformanceTakeDeleteOutboxStatus.DISPATCHED.value,
                    PerformanceTakeDeleteOutbox.status
                    == PerformanceTakeDeleteOutboxStatus.PROCESSING.value,
                )
            )
        ).scalars()
        for outbox in stale:
            _delivery_lifecycle().recover_lease(
                outbox, error="Performance take deletion lease expired", now=now
            )

        due = db.execute(
            select(PerformanceTakeDeleteOutbox.outbox_uuid)
            .where(
                PerformanceTakeDeleteOutbox.status.in_(
                    [
                        PerformanceTakeDeleteOutboxStatus.PENDING.value,
                        PerformanceTakeDeleteOutboxStatus.FAILED.value,
                    ]
                ),
                PerformanceTakeDeleteOutbox.next_attempt_at <= now,
                PerformanceTakeDeleteOutbox.attempt_count
                < settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS,
            )
            .order_by(PerformanceTakeDeleteOutbox.created_at)
            .limit(settings.PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_BATCH_SIZE)
        )
        return list(due.scalars())

    @staticmethod
    def _get(
        db: Session,
        outbox_uuid: str,
        *,
        lock: bool = False,
    ) -> PerformanceTakeDeleteOutbox | None:
        statement = select(PerformanceTakeDeleteOutbox).where(
            PerformanceTakeDeleteOutbox.outbox_uuid == outbox_uuid
        )
        if lock:
            statement = statement.with_for_update().execution_options(populate_existing=True)
        return db.execute(statement).scalar_one_or_none()


performance_take_delete_outbox_service = PerformanceTakeDeleteOutboxService()

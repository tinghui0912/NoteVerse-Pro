"""Score deletion durable delivery, row locks and attempt fencing."""

from dataclasses import dataclass
from datetime import timedelta
from uuid import uuid4
from sqlalchemy import select, or_, and_
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.db.models import ScoreDeletionOperation, ScoreDeletionOperationStatus as Status
from app.modules.async_operations.durable_delivery import (
    DurableDeliveryLifecycle,
    DeliveryStatuses,
    DeliveryLifecyclePolicy,
    ClaimAdmission,
)
from app.modules.async_operations.diagnostics import (
    apply_async_diagnostic,
    clear_async_diagnostic,
    AsyncOperationKindValue,
    AsyncOperationStatusValue,
)
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class ScoreDeletionLease:
    operation_uuid: str
    score_uuid: str
    attempt: int
    token: str
    traceparent: str | None = None
    tracestate: str | None = None


class StaleScoreDeletionAttempt(RuntimeError):
    """The worker no longer owns this deletion attempt."""


def lock_operation(db: Session, operation_uuid: str) -> ScoreDeletionOperation | None:
    with db.no_autoflush:
        return db.scalar(
            select(ScoreDeletionOperation)
            .where(ScoreDeletionOperation.operation_uuid == operation_uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
        )


def require_current_attempt(db: Session, lease: ScoreDeletionLease) -> ScoreDeletionOperation:
    row = lock_operation(db, lease.operation_uuid)
    if (
        row is None
        or row.status != Status.PROCESSING
        or row.attempt_count != lease.attempt
        or row.attempt_token != lease.token
        or row.score_uuid != lease.score_uuid
    ):
        raise StaleScoreDeletionAttempt("Score deletion execution lease is stale")
    return row


class ScoreDeletionDeliveryService:
    @staticmethod
    def lifecycle() -> DurableDeliveryLifecycle[Status]:
        return DurableDeliveryLifecycle(
            statuses=DeliveryStatuses(
                Status.PENDING,
                Status.DISPATCHED,
                Status.PROCESSING,
                Status.FAILED,
                Status.COMPLETED,
            ),
            policy=DeliveryLifecyclePolicy(
                max_attempts=settings.SCORE_DELETION_MAX_ATTEMPTS,
                retry_base_seconds=settings.SCORE_DELETION_RETRY_BASE_SECONDS,
                retry_max_seconds=settings.SCORE_DELETION_RETRY_BASE_SECONDS * 64,
                dispatch_timeout_seconds=settings.SCORE_DELETION_DISPATCH_TIMEOUT_SECONDS,
                processing_timeout_seconds=settings.SCORE_DELETION_PROCESSING_TIMEOUT_SECONDS,
            ),
        )

    def mark_dispatched(self, db: Session, operation_uuid: str) -> bool:
        row = lock_operation(db, operation_uuid)
        if row is None or not self.lifecycle().dispatch(row, now=utc_now_naive()):
            return False
        clear_async_diagnostic(row)
        return True

    def release_dispatch(self, db: Session, operation_uuid: str, error: str) -> bool:
        row = lock_operation(db, operation_uuid)
        if row is None or not self.lifecycle().release_dispatch(
            row, error=error, now=utc_now_naive()
        ):
            return False
        self._diagnose(row)
        return True

    def claim(self, db: Session, operation_uuid: str) -> ScoreDeletionLease | None:
        row = lock_operation(db, operation_uuid)
        if row is None:
            return None
        lifecycle, now = self.lifecycle(), utc_now_naive()
        admission = lifecycle.claim_admission(row, now=now)
        if admission is ClaimAdmission.EXHAUSTED:
            lifecycle.exhaust(row, error="Score deletion attempts exhausted", now=now)
            row.attempt_token = None
            self._diagnose(row)
            return None
        if not lifecycle.claim(row, now=now):
            return None
        row.attempt_token = str(uuid4())
        clear_async_diagnostic(row)
        return ScoreDeletionLease(
            row.operation_uuid,
            row.score_uuid,
            row.attempt_count,
            row.attempt_token,
            row.traceparent,
            row.tracestate,
        )

    def complete(self, db: Session, lease: ScoreDeletionLease) -> bool:
        try:
            row = require_current_attempt(db, lease)
        except StaleScoreDeletionAttempt:
            return False
        if not self.lifecycle().complete_attempt(
            row, expected_attempt=lease.attempt, now=utc_now_naive()
        ):
            return False
        row.attempt_token = None
        clear_async_diagnostic(row)
        return True

    def fail(self, db: Session, lease: ScoreDeletionLease, error: str) -> bool:
        try:
            row = require_current_attempt(db, lease)
        except StaleScoreDeletionAttempt:
            return False
        if not self.lifecycle().fail_attempt(
            row, expected_attempt=lease.attempt, error=error, now=utc_now_naive()
        ):
            return False
        row.attempt_token = None
        self._diagnose(row)
        return True

    def recover_and_list_due(self, db: Session) -> list[str]:
        now = utc_now_naive()
        columns = ScoreDeletionOperation.__table__.c
        rows = db.scalars(
            select(ScoreDeletionOperation)
            .where(
                or_(
                    and_(
                        columns.status.in_([Status.PENDING, Status.FAILED]),
                        columns.next_attempt_at <= now,
                        columns.attempt_count < settings.SCORE_DELETION_MAX_ATTEMPTS,
                    ),
                    and_(
                        columns.status == Status.DISPATCHED,
                        columns.dispatched_at
                        <= now
                        - timedelta(seconds=settings.SCORE_DELETION_DISPATCH_TIMEOUT_SECONDS),
                    ),
                    and_(
                        columns.status == Status.PROCESSING,
                        columns.started_at
                        <= now
                        - timedelta(seconds=settings.SCORE_DELETION_PROCESSING_TIMEOUT_SECONDS),
                    ),
                )
            )
            .order_by(columns.next_attempt_at, columns.id)
            .limit(settings.SCORE_DELETION_BATCH_SIZE)
            .with_for_update(skip_locked=True)
            .execution_options(populate_existing=True)
        ).all()
        due = []
        for row in rows:
            if self.lifecycle().recover_lease(
                row, error="Score deletion delivery lease expired", now=now
            ):
                row.attempt_token = None
                self._diagnose(row)
            if self.lifecycle().is_dispatchable(row, now=now):
                due.append(row.operation_uuid)
        return due

    def rearm(self, db: Session, operation_uuid: str) -> ScoreDeletionOperation:
        row = lock_operation(db, operation_uuid)
        if row is None:
            raise ResourceNotFoundException("async_operation", operation_uuid)
        self._rearm(row)
        return row

    async def rearm_async(
        self, db: AsyncSession, operation_uuid: str
    ) -> tuple[ScoreDeletionOperation, str]:
        row = (
            await db.execute(
                select(ScoreDeletionOperation)
                .where(ScoreDeletionOperation.operation_uuid == operation_uuid)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if row is None:
            raise ResourceNotFoundException("async_operation", operation_uuid)
        previous = row.status.value
        self._rearm(row)
        return row, previous

    def _rearm(self, row: ScoreDeletionOperation) -> None:
        if row.status not in (Status.PENDING, Status.FAILED):
            raise ValidationException(field="status", details={"status": row.status.value})
        self.lifecycle().rearm(row, now=utc_now_naive())
        row.attempt_token = None
        clear_async_diagnostic(row)

    @staticmethod
    def _diagnose(row: ScoreDeletionOperation) -> None:
        status = AsyncOperationStatusValue.FAILED
        if row.attempt_count >= settings.SCORE_DELETION_MAX_ATTEMPTS:
            status = AsyncOperationStatusValue.EXHAUSTED
        elif row.next_attempt_at > utc_now_naive():
            status = AsyncOperationStatusValue.RETRYING
        apply_async_diagnostic(
            row,
            kind=AsyncOperationKindValue.SCORE_DELETION,
            status=status,
            raw_status=row.status.value,
            last_error=row.last_error,
            attempts=row.attempt_count,
            max_attempts=settings.SCORE_DELETION_MAX_ATTEMPTS,
        )


score_deletion_delivery = ScoreDeletionDeliveryService()

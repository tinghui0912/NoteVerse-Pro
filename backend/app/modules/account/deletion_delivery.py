"""Account-owned delivery leases, successful unit continuation and retry recovery."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import uuid4
from sqlalchemy import select, or_, and_
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.models import AccountDeletionOperation, AccountDeletionStatus as Status
from app.modules.durable_work.delivery import (
    DeliveryAttemptLease,
    DeliveryStatuses,
    DeliveryLifecyclePolicy,
    DurableDeliveryLifecycle,
)
from app.shared.time import utc_now
from .deletion_repository import AccountDeletionRepository


@dataclass(frozen=True)
class AccountDeletionLease(DeliveryAttemptLease):
    operation_uuid: str


class StaleAccountDeletionAttempt(RuntimeError):
    """The current worker no longer owns this erasure unit."""


class AccountDeletionDelivery:
    def __init__(self) -> None:
        self.repository = AccountDeletionRepository()

    @staticmethod
    def lifecycle() -> DurableDeliveryLifecycle[Status]:
        return DurableDeliveryLifecycle(
            DeliveryStatuses(
                Status.PENDING,
                Status.DISPATCHED,
                Status.PROCESSING,
                Status.FAILED,
                Status.COMPLETED,
            ),
            DeliveryLifecyclePolicy(
                settings.ACCOUNT_DELETION_MAX_ATTEMPTS,
                settings.ACCOUNT_DELETION_INTERVAL_SECONDS,
                settings.ACCOUNT_DELETION_PROCESSING_TIMEOUT_SECONDS,
                settings.ACCOUNT_DELETION_PROCESSING_TIMEOUT_SECONDS,
            ),
        )

    def claim(self, db: Session, uuid: str) -> AccountDeletionLease | None:
        row = self.repository.operation(db, uuid, lock=True)
        if row is None or row.next_attempt_at > utc_now():
            return None
        lease = self.lifecycle().claim(row, token=str(uuid4()), now=utc_now())
        return (
            AccountDeletionLease(operation_uuid=uuid, attempt=lease.attempt, token=lease.token)
            if lease
            else None
        )

    def require(self, db: Session, lease: AccountDeletionLease) -> AccountDeletionOperation:
        row = self.repository.operation(db, lease.operation_uuid, lock=True)
        if row is None or not self.lifecycle().attempt_matches(row, lease):
            raise StaleAccountDeletionAttempt("Account deletion lease is stale")
        return row

    def continue_at(self, db: Session, lease: AccountDeletionLease, when: datetime) -> None:
        row = self.require(db, lease)
        # A successful bounded unit/grace checkpoint is a new delivery generation,
        # not a failed retry. Phase and durable resource facts describe remaining work.
        self.lifecycle().reset(row, status=Status.PENDING, reset_attempts=True, now=utc_now())
        row.next_attempt_at = when

    def complete(self, db: Session, lease: AccountDeletionLease) -> None:
        row = self.require(db, lease)
        if not self.lifecycle().complete_attempt(row, lease=lease, now=utc_now()):
            raise ValueError("Account erasure completion lost ownership")

    def fail(self, db: Session, lease: AccountDeletionLease, error: str) -> None:
        row = self.repository.operation(db, lease.operation_uuid, lock=True)
        if row is not None:
            self.lifecycle().fail_attempt(row, lease=lease, error=error, now=utc_now())

    def dispatch(self, db: Session, uuid: str) -> bool:
        row = self.repository.operation(db, uuid, lock=True)
        return (
            row is not None
            and row.next_attempt_at <= utc_now()
            and self.lifecycle().dispatch(row, now=utc_now())
        )

    def release_dispatch(self, db: Session, uuid: str, error: str) -> None:
        row = self.repository.operation(db, uuid, lock=True)
        if row is not None:
            self.lifecycle().release_dispatch(row, error=error, now=utc_now())

    def recover_and_list_due(self, db: Session) -> list[str]:
        lifecycle, now = self.lifecycle(), utc_now()
        rows = db.scalars(
            select(AccountDeletionOperation)
            .where(
                or_(
                    and_(
                        AccountDeletionOperation.status == Status.DISPATCHED,
                        AccountDeletionOperation.dispatched_at
                        <= now
                        - timedelta(seconds=settings.ACCOUNT_DELETION_PROCESSING_TIMEOUT_SECONDS),
                    ),
                    and_(
                        AccountDeletionOperation.status == Status.PROCESSING,
                        AccountDeletionOperation.started_at
                        <= now
                        - timedelta(seconds=settings.ACCOUNT_DELETION_PROCESSING_TIMEOUT_SECONDS),
                    ),
                )
            )
            .order_by(AccountDeletionOperation.id)
            .limit(settings.ACCOUNT_DELETION_BATCH_SIZE)
            .with_for_update(skip_locked=True)
            .execution_options(populate_existing=True)
        )
        for row in rows:
            lifecycle.recover_lease(row, error="Account deletion lease expired", now=now)
        db.flush()
        return list(
            db.scalars(
                select(AccountDeletionOperation.operation_uuid)
                .where(
                    AccountDeletionOperation.status.in_([Status.PENDING, Status.FAILED]),
                    AccountDeletionOperation.next_attempt_at <= now,
                    AccountDeletionOperation.attempt_count < settings.ACCOUNT_DELETION_MAX_ATTEMPTS,
                )
                .order_by(AccountDeletionOperation.id)
                .limit(settings.ACCOUNT_DELETION_BATCH_SIZE)
            )
        )


account_deletion_delivery = AccountDeletionDelivery()

"""Bounded business expiry releases quota; upload sessions own physical cleanup."""

from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models.performance_take_upload_reservation import (
    PerformanceTakeUploadReservation as Reservation,
)
from app.modules.media_storage.upload_sessions.service import UploadSessionService
from app.modules.storage_governance.quota.service import StorageQuotaService
from app.modules.storage_governance.usage.service import StorageUsageService
from app.shared.time import utc_now
from .states import UploadReservationStatus as Status
from .persistence import lifecycle_from_row
from .effects import apply_reservation_transition


class UploadReservationCleanupService:
    def __init__(
        self, uploads: UploadSessionService, quota: StorageQuotaService, usage: StorageUsageService
    ) -> None:
        self.uploads, self.quota, self.usage = uploads, quota, usage

    def expire(self, db: Session, *, limit: int = 100) -> int:
        ids = list(
            db.scalars(
                select(Reservation.id)
                .where(
                    Reservation.status.in_([Status.RESERVED, Status.FINALIZING]),
                    Reservation.expires_at <= utc_now(),
                )
                .order_by(Reservation.id)
                .limit(limit)
            )
        )
        expired = 0
        for identity in ids:
            owner = db.scalar(select(Reservation.user_id).where(Reservation.id == identity))
            if owner is None:
                continue
            self.quota.lock_user(db, owner)
            row = db.scalar(
                select(Reservation)
                .where(Reservation.id == identity)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if (
                row is None
                or row.status not in (Status.RESERVED, Status.FINALIZING)
                or row.expires_at > utc_now()
            ):
                continue
            apply_reservation_transition(
                self.usage,
                self.quota,
                db,
                row,
                lifecycle_from_row(row).expire(now=utc_now()),
                now=utc_now(),
            )
            self.uploads.cancel(db, row.upload_session_id)
            expired += 1
        return expired

"""Account erasure preserves Take capability/candidate cleanup lineage until acknowledged."""

from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from app.shared.integrity import ResourceIntegrityError
from app.db.models import (
    PerformanceTake,
    PerformanceTakeManifest,
    PerformanceTakeUploadReservation as Reservation,
)
from app.modules.storage_governance.quota.service import StorageQuotaService
from app.modules.performance_takes.service import PerformanceTakeService
from app.modules.performance_takes.upload_reservation.persistence import (
    lifecycle_from_row,
    apply_transition,
)
from app.modules.performance_takes.upload_reservation.states import (
    UploadReservationStatus as Status,
)
from app.shared.time import utc_now


def cleanup_account_take(
    db: Session, user_id: int, *, quota: StorageQuotaService, takes: PerformanceTakeService
) -> str:
    quota.lock_user(db, user_id)
    row = db.scalar(
        select(Reservation)
        .where(
            Reservation.user_id == user_id,
            Reservation.status.in_([Status.RESERVED, Status.FINALIZING]),
        )
        .order_by(Reservation.id)
        .limit(1)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if row is not None:
        transition = lifecycle_from_row(row).cancel_for_account(now=utc_now())
        apply_transition(row, transition, now=utc_now())
        quota.release_hold(db, row.quota_hold_id)
        return "progress"
    take = db.scalar(
        select(PerformanceTake)
        .where(PerformanceTake.owner_user_id == user_id)
        .order_by(PerformanceTake.id)
        .limit(1)
    )
    if take is not None:
        takes.delete_take(db, user_id, take.manifest.take_uuid)
        return "progress"
    return "busy" if account_take_cleanup_pending(db, user_id) else "empty"


def account_take_cleanup_pending(db: Session, user_id: int) -> bool:
    return (
        db.scalar(
            select(Reservation.id)
            .where(
                Reservation.user_id == user_id,
                (Reservation.status.in_([Status.RESERVED, Status.FINALIZING]))
                | (Reservation.staging_cleanup_completed_at.is_(None))
                | (Reservation.orphan_final_object_keys != "[]"),
            )
            .limit(1)
        )
        is not None
    )


def erase_account_take_history(db: Session, user_id: int, *, limit: int) -> bool:
    """Called only after all temporary cleanup ACKs and final recordings are gone."""
    if (
        account_take_cleanup_pending(db, user_id)
        or db.scalar(
            select(PerformanceTake.id).where(PerformanceTake.owner_user_id == user_id).limit(1)
        )
        is not None
    ):
        raise ResourceIntegrityError("Take cleanup lineage is still live")
    ids = list(
        db.scalars(
            select(PerformanceTakeManifest.id)
            .where(PerformanceTakeManifest.user_id == user_id)
            .order_by(PerformanceTakeManifest.id)
            .limit(limit)
        )
    )
    if not ids:
        return False
    db.execute(
        delete(Reservation).where(Reservation.user_id == user_id, Reservation.manifest_id.in_(ids))
    )
    db.execute(delete(PerformanceTakeManifest).where(PerformanceTakeManifest.id.in_(ids)))
    return True


def has_account_takes(db: Session, user_id: int) -> bool:
    """Whether this domain still owns semantic resources for the account."""
    return (
        db.scalar(
            select(PerformanceTake.id).where(PerformanceTake.owner_user_id == user_id).limit(1)
        )
        is not None
    )

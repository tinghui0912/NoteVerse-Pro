"""Bounded account transfer cancellation and acknowledged session erasure."""

from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models import UploadSession, UploadCreationRequest, PerformanceTakeUploadReservation
from .domain import ACTIVE_STATUSES
from .service import UploadSessionService


def close_account_transfers(db: Session, user_id: int) -> str:
    row = db.scalar(
        select(UploadSession)
        .where(UploadSession.user_id == user_id, UploadSession.status.in_(ACTIVE_STATUSES))
        .order_by(UploadSession.id)
        .limit(1)
        .with_for_update()
    )
    if row is not None:
        UploadSessionService.cancel(db, row.id)
        return "progress"
    pending = db.scalar(
        select(UploadSession.id)
        .where(UploadSession.user_id == user_id, UploadSession.cleanup_completed_at.is_(None))
        .limit(1)
    )
    return "busy" if pending is not None else "empty"


def erase_account_transfers(db: Session, user_id: int, *, limit: int) -> bool:
    rows = list(
        db.scalars(
            select(UploadSession)
            .where(UploadSession.user_id == user_id)
            .order_by(UploadSession.id)
            .limit(limit)
            .with_for_update()
        )
    )
    for row in rows:
        if row.cleanup_completed_at is None or row.operation_unknown:
            raise ValueError("Account transfer cleanup is not settled")
        if (
            db.scalar(
                select(UploadCreationRequest.id).where(
                    UploadCreationRequest.upload_session_id == row.id
                )
            )
            is not None
            or db.scalar(
                select(PerformanceTakeUploadReservation.id).where(
                    PerformanceTakeUploadReservation.upload_session_id == row.id
                )
            )
            is not None
        ):
            raise ValueError("Domain history still references an upload session")
        db.delete(row)
    return bool(rows)

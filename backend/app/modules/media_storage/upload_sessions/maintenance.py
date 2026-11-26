"""Bounded recovery and cleanup preserve consumed-object ownership and uncertain IO."""

from uuid import uuid4
from sqlalchemy import select, or_
from app.db.models.upload_session import UploadSession
from app.shared.time import utc_now
from .domain import UploadStatus as Status, UploadMode as Mode, ACTIVE_STATUSES, TERMINAL_STATUSES
from .service import UploadSessionService, lock_session, snapshot


class UploadSessionMaintenance:
    def __init__(self, service: UploadSessionService) -> None:
        self.service = service

    def run(self, *, limit: int = 100) -> dict[str, int]:
        if not 1 <= limit <= 1000:
            raise ValueError("Upload maintenance batch is out of bounds")
        with self.service.sessions() as db:
            ids = list(
                db.scalars(
                    select(UploadSession.session_uuid)
                    .where(
                        or_(
                            UploadSession.operation_unknown.is_(True),
                            UploadSession.status.in_(TERMINAL_STATUSES)
                            & UploadSession.cleanup_completed_at.is_(None),
                            (UploadSession.expires_at <= utc_now())
                            & UploadSession.status.in_(ACTIVE_STATUSES),
                            (UploadSession.status == Status.CONSUMED)
                            & UploadSession.cleanup_completed_at.is_(None),
                        )
                    )
                    .order_by(UploadSession.created_at)
                    .limit(limit)
                )
            )
        recovered = cleaned = failed = unsettled = 0
        for uuid in ids:
            try:
                with self.service.sessions() as db:
                    row = lock_session(db, uuid)
                    work = snapshot(row)
                    db.commit()
                if work.unknown and work.operation_kind != "CLEANUP":
                    resolved = self.service.recover(uuid)
                    recovered += int(resolved)
                    unsettled += int(not resolved)
                cleaned += int(self.clean(uuid))
            except Exception:
                # The committed session, locator and attempt remain the cleanup owner.
                failed += 1
        return {
            "upload_sessions_recovered": recovered,
            "upload_sessions_cleaned": cleaned,
            "upload_sessions_failed": failed,
            "upload_sessions_unsettled": unsettled,
        }

    def clean(self, uuid: str) -> bool:
        with self.service.sessions() as db:
            row = lock_session(db, uuid)
            if row.status in ACTIVE_STATUSES and row.expires_at <= utc_now():
                row.status = Status.EXPIRED
            if row.cleanup_completed_at is not None:
                return False
            if row.status == Status.CONSUMED and row.mode == Mode.MULTIPART:
                row.cleanup_completed_at, row.updated_at = utc_now(), utc_now()
                db.commit()
                return True
            if row.status not in (*TERMINAL_STATUSES, Status.CONSUMED):
                db.commit()
                return False
            if row.operation_unknown and row.operation_kind != "CLEANUP":
                db.commit()
                return False
            if row.capability_expires_at is not None and row.capability_expires_at > utc_now():
                db.commit()
                return False
            row.operation_kind, row.operation_token, row.operation_unknown = (
                "CLEANUP",
                str(uuid4()),
                True,
            )
            work = snapshot(row)
            db.commit()
        # The terminal session excludes semantic consumption while cleanup executes.
        if work.mode == Mode.MULTIPART:
            handles = self.service.storage.list_multipart_uploads(work.key)
            for handle in set(handles) | ({work.handle} if work.handle else set()):
                self.service.storage.abort_multipart_upload(work.key, handle)
        self.service.storage.delete(work.key)
        handles = (
            self.service.storage.list_multipart_uploads(work.key)
            if work.mode == Mode.MULTIPART
            else ()
        )
        if handles or self.service.storage.exists(work.key):
            return False
        with self.service.sessions() as db:
            row = lock_session(db, uuid)
            if (
                row.operation_token != work.token
                or row.generation != work.generation
                or row.status
                not in (
                    *TERMINAL_STATUSES,
                    Status.CONSUMED,
                )
            ):
                return False
            row.cleanup_completed_at, row.operation_unknown, row.updated_at = (
                utc_now(),
                False,
                utc_now(),
            )
            db.commit()
        return True

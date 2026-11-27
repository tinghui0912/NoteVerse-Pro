"""Unknown commits resolve through committed Take and reservation facts, without provider IO."""

from sqlalchemy.orm import Session
from app.db.models.performance_take_upload_reservation import PerformanceTakeUploadReservation
from sqlalchemy.exc import DBAPIError, InterfaceError
from app.modules.media_storage.write_coordinator import SessionFactory
from app.modules.performance_takes.repository import PerformanceTakeRepository
from app.modules.storage_governance.quota.service import StorageQuotaService
from app.modules.storage_governance.quota.states import StorageQuotaHoldStatus
from .states import UploadReservationStatus as Status
from .persistence import lifecycle_from_row, apply_transition
from .domain import FinalizeLease
from app.shared.time import utc_now


def is_transient_db_disconnect(error: BaseException) -> bool:
    return (
        isinstance(error, DBAPIError)
        and error.connection_invalidated
        or isinstance(error, InterfaceError)
    )


class PerformanceTakeFinalizationRecovery:
    def __init__(
        self,
        repository: PerformanceTakeRepository,
        *,
        quota: StorageQuotaService,
        sessions: SessionFactory,
    ) -> None:
        self.repository, self.quota, self.sessions = repository, quota, sessions

    def validate_completed_hold(self, db: Session, row: PerformanceTakeUploadReservation) -> None:
        hold = self.quota.lock_hold(db, row.quota_hold_id)
        if hold.status != StorageQuotaHoldStatus.CONSUMED:
            raise ValueError("Completed Take requires a consumed hold")

    def recover_known_failure(
        self, db: Session, *, user_id: int, take_uuid: str, lease: FinalizeLease
    ) -> None:
        self.quota.lock_user(db, user_id)
        row = self.repository.get_reservation_by_take_uuid(db, user_id, take_uuid, lock=True)
        if row is None:
            return
        if self.repository.get_by_reservation(db, user_id, row.id) is not None:
            self.validate_completed_hold(db, row)
            return
        state = lifecycle_from_row(row)
        if (
            state.status == Status.FINALIZING
            and state.lease is not None
            and state.lease.token == lease.token
        ):
            apply_transition(
                row, state.recover_finalize(token=lease.token, now=utc_now()), now=utc_now()
            )

    def recover_unknown_commit(self, *, user_id: int, take_uuid: str, lease: FinalizeLease) -> None:
        with self.sessions() as db:
            self.recover_known_failure(db, user_id=user_id, take_uuid=take_uuid, lease=lease)
            db.commit()

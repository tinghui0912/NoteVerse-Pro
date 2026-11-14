"""Recovery consumes persisted lineage without repeating admission or physical promotion."""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import DBAPIError, InterfaceError
from app.db.session import AsyncSessionLocal
from app.modules.performance_takes.repository import PerformanceTakeRepository
from app.modules.storage_usage.service import StorageUsageService
from app.utils.timezone import utc_now_naive
from .domain import FinalizeLease, UploadReservationStatus
from .persistence import lifecycle_from_row
from .effects import apply_reservation_transition


def is_transient_db_disconnect(error: BaseException) -> bool:
    if isinstance(error, DBAPIError) and error.connection_invalidated:
        return True
    return isinstance(error, InterfaceError) and (
        "connection is closed" in str(error).lower() or "connection closed" in str(error).lower()
    )


class PerformanceTakeFinalizationRecovery:
    def __init__(
        self, repository: PerformanceTakeRepository, storage_usage_service: StorageUsageService
    ) -> None:
        self.repository = repository
        self.storage_usage_service = storage_usage_service

    async def recover(
        self,
        db: AsyncSession,
        *,
        user_id: int,
        take_uuid: str,
        lease: FinalizeLease,
        unknown_outcome: bool,
    ) -> None:
        row = await self.repository.get_reservation_by_take_uuid(db, user_id, take_uuid, lock=True)
        if row is None:
            return
        state = lifecycle_from_row(row)
        take = await self.repository.get_by_reservation(db, user_id, row.id)
        # COMPLETED without a Take is valid deletion lineage and cannot resurrect it.
        state.assert_take_presence(take is not None, allow_deleted_take=True)
        now = utc_now_naive()
        if take is not None:
            if take.recording_object.object_key != lease.object_key:
                # Refresh orphan evidence after late IO, even if an earlier cleanup saw absence.
                await apply_reservation_transition(
                    self.storage_usage_service,
                    db,
                    row,
                    state.remember_uncertain_candidate(key=lease.object_key, now=now),
                    now=now,
                )
            return
        if state.status is UploadReservationStatus.COMPLETED:
            return
        if (
            state.lease is not None
            and state.lease.token == lease.token
            and state.lease.object_key == lease.object_key
        ):
            transition = (
                state.expire(
                    now=now,
                    unknown_outcome=unknown_outcome,
                    token=lease.token,
                    object_key=lease.object_key,
                )
                if state.expires_at <= now
                else state.recover_finalize(
                    token=lease.token,
                    object_key=lease.object_key,
                    now=now,
                    unknown_outcome=unknown_outcome,
                )
            )
        else:
            # A candidate still held by a different lease cannot be declared abandoned.
            if state.lease is not None and state.lease.object_key == lease.object_key:
                return
            # A late physical result may leave evidence, but never changes the winner's lease.
            transition = state.remember_uncertain_candidate(key=lease.object_key, now=now)
        await apply_reservation_transition(self.storage_usage_service, db, row, transition, now=now)

    async def recover_known_failure(
        self, db: AsyncSession, *, user_id: int, take_uuid: str, lease: FinalizeLease
    ) -> None:
        """Participate only after a known pre-commit rollback, with immediate orphan eligibility."""
        await self.recover(
            db, user_id=user_id, take_uuid=take_uuid, lease=lease, unknown_outcome=False
        )

    async def recover_unknown_commit(
        self, *, user_id: int, take_uuid: str, lease: FinalizeLease
    ) -> None:
        """Resolve every unacknowledged semantic COMMIT from independent persisted lineage."""
        async with AsyncSessionLocal() as db:
            await self.recover(
                db, user_id=user_id, take_uuid=take_uuid, lease=lease, unknown_outcome=True
            )
            await db.commit()

"""Reservation business transitions are independent of upload transport cleanup."""

from dataclasses import dataclass, replace
from datetime import datetime
from .states import UploadReservationStatus as Status


class ReservationInvariantError(ValueError):
    pass


class ReservationTransitionError(ValueError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class FinalizeLease:
    token: str
    object_key: str
    expires_at: datetime


@dataclass(frozen=True)
class TransitionEffects:
    release_quota_hold: bool = False
    commit_storage_object_key: str | None = None


@dataclass(frozen=True)
class ReservationTransition:
    before: "UploadReservationLifecycle"
    after: "UploadReservationLifecycle"
    effects: TransitionEffects = TransitionEffects()


@dataclass(frozen=True)
class UploadReservationLifecycle:
    status: Status
    expires_at: datetime
    lease: FinalizeLease | None = None

    def __post_init__(self) -> None:
        if (self.status == Status.FINALIZING) != (self.lease is not None):
            raise ReservationInvariantError("Finalize lease does not match reservation state")

    def assert_take_presence(self, exists: bool, *, allow_deleted_take: bool = False) -> None:
        if (
            exists
            and self.status != Status.COMPLETED
            or not exists
            and self.status == Status.COMPLETED
            and not allow_deleted_take
        ):
            raise ReservationInvariantError("Take and reservation completion must be atomic")

    def require_current_lease(
        self, *, token: str, object_key: str | None = None, now: datetime | None = None
    ) -> FinalizeLease:
        if (
            self.lease is None
            or self.lease.token != token
            or object_key is not None
            and object_key != self.lease.object_key
            or now is not None
            and self.lease.expires_at <= now
        ):
            raise ReservationTransitionError("finalize_lease_lost")
        return self.lease

    def begin_finalize(self, *, lease: FinalizeLease, now: datetime) -> ReservationTransition:
        if self.status not in (Status.RESERVED, Status.FINALIZING):
            raise ReservationTransitionError("finalize_unavailable")
        if self.expires_at <= now or lease.expires_at <= now:
            raise ReservationTransitionError("reservation_expired")
        if self.lease is not None and self.lease.expires_at > now:
            raise ReservationTransitionError("finalize_in_progress")
        if self.lease is not None and self.lease.token == lease.token:
            raise ReservationTransitionError("finalize_requires_new_token")
        return ReservationTransition(self, replace(self, status=Status.FINALIZING, lease=lease))

    def recover_finalize(self, *, token: str, now: datetime) -> ReservationTransition:
        self.require_current_lease(token=token)
        return ReservationTransition(self, replace(self, status=Status.RESERVED, lease=None))

    def complete(self, *, token: str, object_key: str, now: datetime) -> ReservationTransition:
        self.require_current_lease(token=token, object_key=object_key, now=now)
        if self.expires_at <= now:
            raise ReservationTransitionError("reservation_expired")
        return ReservationTransition(
            self,
            replace(self, status=Status.COMPLETED, lease=None),
            TransitionEffects(commit_storage_object_key=object_key),
        )

    def cancel(self, *, now: datetime) -> ReservationTransition:
        if self.status == Status.CANCELLED:
            return ReservationTransition(self, self)
        if self.status not in (Status.RESERVED, Status.FINALIZING):
            raise ReservationTransitionError("reservation_not_cancellable")
        return ReservationTransition(
            self,
            replace(self, status=Status.CANCELLED, lease=None),
            TransitionEffects(release_quota_hold=True),
        )

    def cancel_for_account(self, *, now: datetime) -> ReservationTransition:
        return self.cancel(now=now)

    def expire(self, *, now: datetime) -> ReservationTransition:
        if self.expires_at > now or self.status not in (Status.RESERVED, Status.FINALIZING):
            raise ReservationTransitionError("reservation_not_expired")
        return ReservationTransition(
            self,
            replace(self, status=Status.EXPIRED, lease=None),
            TransitionEffects(release_quota_hold=True),
        )

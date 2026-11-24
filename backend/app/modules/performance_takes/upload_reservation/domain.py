from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Literal

from app.shared.performance_take_upload import UploadReservationStatus


class ReservationInvariantError(ValueError):
    """Persisted lifecycle facts do not describe a possible aggregate."""


class ReservationTransitionError(ValueError):
    """The requested command is not permitted by the current lifecycle."""

    def __init__(
        self,
        code: Literal[
            "upload_capability_unavailable",
            "upload_capability_expired",
            "finalize_lease_lost",
            "finalize_lease_expired",
            "finalize_in_progress",
            "takeover_requires_new_candidate",
            "finalize_unavailable",
            "reservation_expired",
            "reservation_not_expired",
            "reservation_not_cancellable",
        ],
    ) -> None:
        self.code = code
        super().__init__(code)


UNKNOWN_OUTCOME_GRACE = timedelta(minutes=30)


@dataclass(frozen=True)
class FinalizeLease:
    token: str
    object_key: str
    expires_at: datetime

    def __post_init__(self) -> None:
        if not self.token or not self.object_key:
            raise ReservationInvariantError("Finalize lease identity is required")


@dataclass(frozen=True)
class OrphanFinalCandidate:
    key: str
    remove_after: datetime

    def __post_init__(self) -> None:
        if not self.key:
            raise ReservationInvariantError("Candidate key is required")


@dataclass(frozen=True)
class TransitionEffects:
    release_quota_hold: bool = False
    commit_storage_object_key: str | None = None


@dataclass(frozen=True)
class ReservationTransition:
    before: UploadReservationLifecycle
    after: UploadReservationLifecycle
    effects: TransitionEffects = TransitionEffects()


@dataclass(frozen=True)
class UploadReservationLifecycle:
    status: UploadReservationStatus
    expires_at: datetime
    lease: FinalizeLease | None = None
    orphan_candidates: tuple[OrphanFinalCandidate, ...] = ()
    last_put_url_expires_at: datetime | None = None
    staging_cleanup_after: datetime | None = None
    staging_cleanup_completed_at: datetime | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.status, UploadReservationStatus):
            raise ReservationInvariantError("Unknown reservation status")
        if (self.status is UploadReservationStatus.FINALIZING) != (self.lease is not None):
            raise ReservationInvariantError("Finalize lease does not match status")
        keys = [candidate.key for candidate in self.orphan_candidates]
        if len(keys) != len(set(keys)):
            raise ReservationInvariantError("Duplicate orphan candidate")
        if self.lease is not None and self.lease.object_key in keys:
            raise ReservationInvariantError("Current lease candidate cannot also be abandoned")

    @classmethod
    def reserved(
        cls, *, expires_at: datetime, put_expires_at: datetime
    ) -> UploadReservationLifecycle:
        return cls(
            UploadReservationStatus.RESERVED,
            expires_at,
            last_put_url_expires_at=put_expires_at,
            staging_cleanup_after=put_expires_at,
        )

    def assert_take_presence(self, exists: bool, *, allow_deleted_take: bool = False) -> None:
        if (exists and self.status is not UploadReservationStatus.COMPLETED) or (
            not exists
            and self.status is UploadReservationStatus.COMPLETED
            and not allow_deleted_take
        ):
            raise ReservationInvariantError("Take and reservation completion must be atomic")

    def require_current_lease(
        self, *, token: str, object_key: str | None = None, now: datetime | None = None
    ) -> FinalizeLease:
        lease = self.lease
        if (
            lease is None
            or lease.token != token
            or (object_key is not None and lease.object_key != object_key)
            or (now is not None and lease.expires_at <= now)
        ):
            raise ReservationTransitionError("finalize_lease_lost")
        return lease

    def _transition(
        self, after: UploadReservationLifecycle, effects: TransitionEffects = TransitionEffects()
    ) -> ReservationTransition:
        return ReservationTransition(self, after, effects)

    def refresh_upload(self, *, now: datetime, put_expires_at: datetime) -> ReservationTransition:
        if self.status is not UploadReservationStatus.RESERVED or self.expires_at <= now:
            raise ReservationTransitionError("upload_capability_unavailable")
        if put_expires_at <= now:
            raise ReservationTransitionError("upload_capability_expired")
        return self._transition(
            replace(
                self,
                last_put_url_expires_at=put_expires_at,
                staging_cleanup_after=max(
                    self.staging_cleanup_after or put_expires_at, put_expires_at
                ),
            )
        )

    def _with_orphan(self, key: str, remove_after: datetime) -> UploadReservationLifecycle:
        entries = {candidate.key: candidate for candidate in self.orphan_candidates}
        existing = entries.get(key)
        entries[key] = OrphanFinalCandidate(
            key, max(existing.remove_after, remove_after) if existing else remove_after
        )
        return (
            replace(
                self,
                lease=None,
                status=UploadReservationStatus.RESERVED,
                orphan_candidates=tuple(entries.values()),
            )
            if (self.lease is not None and self.lease.object_key == key)
            else replace(self, orphan_candidates=tuple(entries.values()))
        )

    def remember_uncertain_candidate(self, *, key: str, now: datetime) -> ReservationTransition:
        if self.lease is not None and self.lease.object_key == key:
            return self.recover_finalize(
                token=self.lease.token, object_key=key, now=now, unknown_outcome=True
            )
        return self._transition(self._with_orphan(key, now + UNKNOWN_OUTCOME_GRACE))

    def begin_finalize(self, *, lease: FinalizeLease, now: datetime) -> ReservationTransition:
        if lease.expires_at <= now:
            raise ReservationTransitionError("finalize_lease_expired")
        state = self
        if self.status is UploadReservationStatus.FINALIZING:
            assert self.lease is not None
            if self.lease.expires_at > now:
                raise ReservationTransitionError("finalize_in_progress")
            if lease.token == self.lease.token or lease.object_key == self.lease.object_key:
                raise ReservationTransitionError("takeover_requires_new_candidate")
            state = self._with_orphan(self.lease.object_key, now + UNKNOWN_OUTCOME_GRACE)
        elif self.status is not UploadReservationStatus.RESERVED:
            raise ReservationTransitionError("finalize_unavailable")
        if self.expires_at <= now:
            raise ReservationTransitionError("reservation_expired")
        return self._transition(
            replace(state, status=UploadReservationStatus.FINALIZING, lease=lease)
        )

    def recover_finalize(
        self, *, token: str, object_key: str, now: datetime, unknown_outcome: bool
    ) -> ReservationTransition:
        lease = self.require_current_lease(token=token, object_key=object_key)
        state = self._with_orphan(
            lease.object_key, now + UNKNOWN_OUTCOME_GRACE if unknown_outcome else now
        )
        return self._transition(replace(state, status=UploadReservationStatus.RESERVED, lease=None))

    def _terminal(
        self,
        status: UploadReservationStatus,
        *,
        now: datetime,
        unknown_outcome: bool = True,
        completed_key: str | None = None,
    ) -> ReservationTransition:
        state = self
        if self.lease is not None and completed_key is None:
            state = self._with_orphan(
                self.lease.object_key, now + UNKNOWN_OUTCOME_GRACE if unknown_outcome else now
            )
        after = replace(
            state,
            status=status,
            lease=None,
            staging_cleanup_after=max(
                value
                for value in (self.staging_cleanup_after, self.last_put_url_expires_at, now)
                if value is not None
            ),
        )
        if completed_key is not None:
            after = replace(
                after,
                orphan_candidates=tuple(
                    item for item in after.orphan_candidates if item.key != completed_key
                ),
            )
        return self._transition(
            after,
            TransitionEffects(
                release_quota_hold=completed_key is None,
                commit_storage_object_key=completed_key,
            ),
        )

    def expire(
        self,
        *,
        now: datetime,
        unknown_outcome: bool = True,
        token: str | None = None,
        object_key: str | None = None,
    ) -> ReservationTransition:
        if (
            self.status
            not in {UploadReservationStatus.RESERVED, UploadReservationStatus.FINALIZING}
            or self.expires_at > now
        ):
            raise ReservationTransitionError("reservation_not_expired")
        if self.lease is not None and self.lease.expires_at > now:
            if token is None:
                raise ReservationTransitionError("finalize_in_progress")
            self.require_current_lease(token=token, object_key=object_key)
        return self._terminal(
            UploadReservationStatus.EXPIRED, now=now, unknown_outcome=unknown_outcome
        )

    def cancel(self, *, now: datetime) -> ReservationTransition:
        if self.status is UploadReservationStatus.CANCELLED:
            return self._transition(self)
        if self.status is not UploadReservationStatus.RESERVED:
            raise ReservationTransitionError("reservation_not_cancellable")
        return self._terminal(UploadReservationStatus.CANCELLED, now=now)

    def cancel_for_account(self, *, now: datetime) -> ReservationTransition:
        """Account erasure ends admission while retaining uncertain candidate grace."""
        if self.status not in {
            UploadReservationStatus.RESERVED,
            UploadReservationStatus.FINALIZING,
        }:
            return self._transition(self)
        return self._terminal(UploadReservationStatus.CANCELLED, now=now, unknown_outcome=True)

    def complete(self, *, token: str, object_key: str, now: datetime) -> ReservationTransition:
        self.require_current_lease(token=token, object_key=object_key, now=now)
        if self.expires_at <= now:
            raise ReservationTransitionError("reservation_expired")
        return self._terminal(UploadReservationStatus.COMPLETED, now=now, completed_key=object_key)

    def recover_due(self, *, now: datetime) -> ReservationTransition:
        if self.status is UploadReservationStatus.RESERVED and self.expires_at <= now:
            return self.expire(now=now)
        if self.status is UploadReservationStatus.FINALIZING:
            assert self.lease is not None
            if self.lease.expires_at <= now:
                if self.expires_at <= now:
                    return self.expire(now=now)
                return self.recover_finalize(
                    token=self.lease.token,
                    object_key=self.lease.object_key,
                    now=now,
                    unknown_outcome=True,
                )
        return self._transition(self)

    def can_cleanup_staging(self, *, now: datetime) -> bool:
        return (
            self.status
            not in {UploadReservationStatus.RESERVED, UploadReservationStatus.FINALIZING}
            and self.staging_cleanup_completed_at is None
            and self.staging_cleanup_after is not None
            and self.staging_cleanup_after <= now
        )

    def cleanup_candidates(self, *, now: datetime) -> tuple[OrphanFinalCandidate, ...]:
        return tuple(item for item in self.orphan_candidates if item.remove_after <= now)

    def finish_cleanup(
        self, *, now: datetime, absent_candidates: frozenset[str], staging_absent: bool = False
    ) -> ReservationTransition:
        eligible_keys = {item.key for item in self.cleanup_candidates(now=now)}
        return self._transition(
            replace(
                self,
                orphan_candidates=tuple(
                    item
                    for item in self.orphan_candidates
                    if item.key not in absent_candidates or item.key not in eligible_keys
                ),
                staging_cleanup_completed_at=(
                    now
                    if staging_absent and self.can_cleanup_staging(now=now)
                    else self.staging_cleanup_completed_at
                ),
            )
        )

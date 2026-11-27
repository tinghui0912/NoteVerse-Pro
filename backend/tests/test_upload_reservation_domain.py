"""Business finalize leases, terminal effects and atomic Take presence."""

from datetime import datetime, UTC, timedelta
import pytest
from app.modules.performance_takes.upload_reservation.domain import (
    FinalizeLease,
    UploadReservationLifecycle,
    ReservationTransitionError,
    ReservationInvariantError,
)
from app.modules.performance_takes.upload_reservation.states import (
    UploadReservationStatus as Status,
)

NOW = datetime(2026, 11, 1, tzinfo=UTC)


def reserved():
    return UploadReservationLifecycle(Status.RESERVED, NOW + timedelta(hours=1))


def finalizing():
    return (
        reserved()
        .begin_finalize(
            lease=FinalizeLease("first", "object", NOW + timedelta(minutes=15)), now=NOW
        )
        .after
    )


@pytest.mark.parametrize(
    "command,status,release",
    [
        (lambda s: s.cancel(now=NOW), Status.CANCELLED, True),
        (lambda s: s.expire(now=NOW + timedelta(hours=2)), Status.EXPIRED, True),
        (
            lambda s: s.begin_finalize(
                lease=FinalizeLease("first", "object", NOW + timedelta(minutes=15)), now=NOW
            ),
            Status.FINALIZING,
            False,
        ),
    ],
)
def test_business_transitions_have_explicit_effects(command, status, release):
    change = command(reserved())
    assert change.after.status == status and change.effects.release_quota_hold == release


def test_takeover_requires_expired_lease_and_new_token():
    state = finalizing()
    with pytest.raises(ReservationTransitionError):
        state.begin_finalize(
            lease=FinalizeLease("new", "object", NOW + timedelta(minutes=20)), now=NOW
        )
    with pytest.raises(ReservationTransitionError):
        state.begin_finalize(
            lease=FinalizeLease("first", "object", NOW + timedelta(minutes=40)),
            now=NOW + timedelta(minutes=16),
        )
    second = state.begin_finalize(
        lease=FinalizeLease("second", "object", NOW + timedelta(minutes=40)),
        now=NOW + timedelta(minutes=16),
    ).after
    with pytest.raises(ReservationTransitionError):
        second.complete(token="first", object_key="object", now=NOW + timedelta(minutes=17))
    assert (
        second.complete(
            token="second", object_key="object", now=NOW + timedelta(minutes=17)
        ).effects.commit_storage_object_key
        == "object"
    )


@pytest.mark.parametrize("status", [Status.COMPLETED, Status.CANCELLED, Status.EXPIRED])
def test_terminal_reservations_cannot_reenter_finalizing(status):
    state = UploadReservationLifecycle(status, NOW + timedelta(hours=1))
    with pytest.raises(ReservationTransitionError):
        state.begin_finalize(
            lease=FinalizeLease("token", "object", NOW + timedelta(minutes=15)), now=NOW
        )


def test_take_presence_requires_completed_reservation():
    with pytest.raises(ReservationInvariantError):
        reserved().assert_take_presence(True)
    with pytest.raises(ReservationInvariantError):
        UploadReservationLifecycle(Status.COMPLETED, NOW).assert_take_presence(False)
    UploadReservationLifecycle(Status.COMPLETED, NOW).assert_take_presence(
        False, allow_deleted_take=True
    )

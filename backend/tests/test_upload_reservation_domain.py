from datetime import UTC
from datetime import datetime, timedelta

import pytest

from app.modules.performance_takes.upload_reservation.domain import (
    FinalizeLease,
    OrphanFinalCandidate,
    ReservationInvariantError,
    ReservationTransitionError,
    UploadReservationLifecycle,
    UNKNOWN_OUTCOME_GRACE,
)
from app.shared.performance_take_upload import UploadReservationStatus

NOW = datetime(2026, 11, 1, tzinfo=UTC)


def reserved():
    return UploadReservationLifecycle.reserved(
        expires_at=NOW + timedelta(hours=1),
        put_expires_at=NOW + timedelta(minutes=10),
    )


def finalizing():
    return (
        reserved()
        .begin_finalize(
            lease=FinalizeLease("token", "candidate", NOW + timedelta(minutes=15)), now=NOW
        )
        .after
    )


@pytest.mark.parametrize(
    "command,status,release,commit",
    [
        (lambda s: s.cancel(now=NOW), UploadReservationStatus.CANCELLED, True, None),
        (
            lambda s: s.expire(now=NOW + timedelta(hours=2)),
            UploadReservationStatus.EXPIRED,
            True,
            None,
        ),
        (
            lambda s: s.begin_finalize(
                lease=FinalizeLease("token", "candidate", NOW + timedelta(minutes=15)), now=NOW
            ),
            UploadReservationStatus.FINALIZING,
            False,
            None,
        ),
    ],
)
def test_reserved_commands_and_explicit_effects(command, status, release, commit):
    transition = command(reserved())
    assert transition.after.status is status
    assert transition.effects.release_quota_hold is release
    assert transition.effects.commit_storage_object_key == commit


def test_takeover_requires_expired_lease_and_preserves_unknown_outcome_grace():
    state = finalizing()
    lease = FinalizeLease("second", "next-candidate", NOW + timedelta(minutes=40))
    with pytest.raises(ReservationTransitionError, match="finalize_in_progress"):
        state.begin_finalize(lease=lease, now=NOW)
    now = NOW + timedelta(minutes=16)
    transition = state.begin_finalize(lease=lease, now=now)
    assert transition.after.lease == lease
    assert transition.after.orphan_candidates == (
        OrphanFinalCandidate("candidate", now + UNKNOWN_OUTCOME_GRACE),
    )


@pytest.mark.parametrize("unknown", [False, True])
def test_recovery_validates_identity_and_preserves_cleanup(unknown):
    state = finalizing()
    with pytest.raises(ReservationTransitionError):
        state.recover_finalize(
            token="wrong", object_key="candidate", now=NOW, unknown_outcome=unknown
        )
    transition = state.recover_finalize(
        token="token", object_key="candidate", now=NOW, unknown_outcome=unknown
    )
    assert transition.after.status is UploadReservationStatus.RESERVED
    assert transition.after.lease is None
    assert transition.after.orphan_candidates[0].remove_after == (
        NOW + UNKNOWN_OUTCOME_GRACE if unknown else NOW
    )


def test_complete_commits_quota_without_orphaning_durable_object():
    state = finalizing()
    transition = state.complete(token="token", object_key="candidate", now=NOW)
    assert transition.after.status is UploadReservationStatus.COMPLETED
    assert transition.after.lease is None
    assert transition.after.orphan_candidates == ()
    assert transition.effects.commit_storage_object_key == "candidate"
    assert not transition.effects.release_quota_hold
    with pytest.raises(ReservationTransitionError):
        finalizing().complete(
            token="token", object_key="candidate", now=NOW + timedelta(minutes=16)
        )


def test_finalizing_expiry_releases_holds_and_preserves_candidate_and_staging_horizon():
    now = NOW + timedelta(hours=2)
    transition = finalizing().expire(now=now)
    assert transition.after.status is UploadReservationStatus.EXPIRED
    assert transition.after.lease is None
    assert transition.effects.release_quota_hold
    assert transition.after.staging_cleanup_after == now
    assert transition.after.orphan_candidates[0].remove_after == now + UNKNOWN_OUTCOME_GRACE


@pytest.mark.parametrize(
    "status",
    [
        UploadReservationStatus.CANCELLED,
        UploadReservationStatus.EXPIRED,
        UploadReservationStatus.COMPLETED,
    ],
)
def test_terminal_commands_do_not_reopen_or_claim_cancellation(status):
    state = UploadReservationLifecycle(status, NOW)
    for command in [
        lambda: state.begin_finalize(
            lease=FinalizeLease("x", "key", NOW + timedelta(minutes=1)), now=NOW
        ),
        lambda: state.refresh_upload(now=NOW, put_expires_at=NOW + timedelta(minutes=1)),
        lambda: state.expire(now=NOW),
    ]:
        with pytest.raises(ReservationTransitionError):
            command()
    if status is UploadReservationStatus.CANCELLED:
        assert state.cancel(now=NOW).after == state
        assert not state.cancel(now=NOW).effects.release_quota_hold
    else:
        with pytest.raises(ReservationTransitionError):
            state.cancel(now=NOW)


def test_refresh_and_cleanup_are_domain_commands():
    state = reserved()
    expiry = NOW + timedelta(minutes=20)
    refreshed = state.refresh_upload(now=NOW, put_expires_at=expiry).after
    assert refreshed.last_put_url_expires_at == refreshed.staging_cleanup_after == expiry
    state = state.remember_uncertain_candidate(key="key", now=NOW).after
    state = state.remember_uncertain_candidate(key="key", now=NOW + timedelta(seconds=1)).after
    assert len(state.orphan_candidates) == 1
    assert state.cleanup_candidates(now=NOW) == ()
    assert state.cleanup_candidates(now=NOW + timedelta(hours=1)) == state.orphan_candidates
    assert state.finish_cleanup(now=NOW, absent_candidates=frozenset({"key"})).after == state
    state = state.cancel(now=NOW).after
    assert not state.can_cleanup_staging(now=NOW)
    cleaned = state.finish_cleanup(
        now=NOW + timedelta(hours=2), absent_candidates=frozenset({"key"}), staging_absent=True
    ).after
    assert cleaned.orphan_candidates == ()
    assert cleaned.staging_cleanup_completed_at == NOW + timedelta(hours=2)


@pytest.mark.parametrize(
    "status,lease",
    [
        (UploadReservationStatus.RESERVED, FinalizeLease("t", "k", NOW)),
        (UploadReservationStatus.FINALIZING, None),
        (UploadReservationStatus.COMPLETED, FinalizeLease("t", "k", NOW)),
        (UploadReservationStatus.CANCELLED, FinalizeLease("t", "k", NOW)),
        (UploadReservationStatus.EXPIRED, FinalizeLease("t", "k", NOW)),
    ],
)
def test_invalid_hydration_fails_closed(status, lease):
    with pytest.raises(ReservationInvariantError):
        UploadReservationLifecycle(status, NOW, lease)


def test_take_presence_is_an_atomic_invariant():
    with pytest.raises(ReservationInvariantError):
        reserved().assert_take_presence(True)
    with pytest.raises(ReservationInvariantError):
        UploadReservationLifecycle(UploadReservationStatus.COMPLETED, NOW).assert_take_presence(
            False
        )


def test_expired_lease_cleanup_uses_same_recovery_rules():
    now = NOW + timedelta(minutes=16)
    state = finalizing()
    assert state.recover_due(now=now) == state.recover_finalize(
        token="token", object_key="candidate", now=now, unknown_outcome=True
    )
    assert state.recover_due(now=NOW).after == state


def test_partial_row_lease_and_noncanonical_candidate_json_fail_closed():
    from app.db.models.performance_take_upload_reservation import PerformanceTakeUploadReservation
    from app.modules.performance_takes.upload_reservation.persistence import (
        lifecycle_from_row,
        decode_orphan_candidates,
    )

    row = PerformanceTakeUploadReservation(
        status=UploadReservationStatus.FINALIZING, expires_at=NOW, finalizing_token="half"
    )
    with pytest.raises(ReservationInvariantError):
        lifecycle_from_row(row)
    for payload in ['["key"]', '[{"key":"key","remove_after":null}]', "{}", "not json"]:
        with pytest.raises(ReservationInvariantError):
            decode_orphan_candidates(payload)


def test_active_finalize_lease_remains_fenced_when_reservation_deadline_passes():
    from dataclasses import replace

    state = replace(finalizing(), expires_at=NOW)
    with pytest.raises(ReservationTransitionError, match="finalize_in_progress"):
        state.begin_finalize(
            lease=FinalizeLease("other", "other-key", NOW + timedelta(minutes=20)), now=NOW
        )
    with pytest.raises(ReservationTransitionError, match="finalize_in_progress"):
        state.expire(now=NOW)
    # Only the matching current executor may retire its active expired reservation.
    assert (
        state.expire(now=NOW, token="token", object_key="candidate").after.status
        is UploadReservationStatus.EXPIRED
    )

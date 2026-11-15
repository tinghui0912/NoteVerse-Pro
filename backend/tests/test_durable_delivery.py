from __future__ import annotations

from datetime import UTC

import ast
from dataclasses import FrozenInstanceError, asdict, dataclass, replace
from datetime import datetime, timedelta
from pathlib import Path
import sys

import pytest

from app.modules.durable_work.delivery import (
    ClaimAdmission,
    DeliveryLifecyclePolicy,
    DeliveryStatuses,
    DurableDeliveryLifecycle,
    DeliveryAttemptLease,
)

NOW = datetime(2026, 11, 6, 12, tzinfo=UTC)
LIFECYCLE = DurableDeliveryLifecycle(
    DeliveryStatuses("PENDING", "DISPATCHED", "PROCESSING", "FAILED", "COMPLETED"),
    DeliveryLifecyclePolicy(5, 60, 300, 1200),
)


@dataclass
class Record:
    status: str = "PENDING"
    attempt_token: str | None = None
    attempt_count: int = 0
    next_attempt_at: datetime = NOW
    dispatched_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    last_error: str | None = None
    updated_at: datetime = NOW - timedelta(days=1)


@pytest.mark.parametrize("status", ["PENDING", "FAILED"])
def test_due_delivery_dispatches_without_consuming_attempt(status: str) -> None:
    row = Record(status=status, attempt_count=2)
    assert LIFECYCLE.is_dispatchable(row, now=NOW)
    assert LIFECYCLE.dispatch(row, now=NOW)
    assert (row.status, row.dispatched_at, row.updated_at, row.attempt_count) == (
        "DISPATCHED",
        NOW,
        NOW,
        2,
    )


@pytest.mark.parametrize(
    "row",
    [
        Record(status="FAILED", next_attempt_at=NOW + timedelta(microseconds=1)),
        Record(next_attempt_at=NOW + timedelta(microseconds=1)),
        Record(attempt_count=5),
        Record(status="PROCESSING", attempt_token="token"),
        Record(status="COMPLETED"),
        Record(status="SENT"),
        Record(status="SUPERSEDED"),
        Record(status="EXPIRED"),
    ],
)
def test_non_dispatchable_delivery_is_unchanged(row: Record) -> None:
    row = replace(row)
    before = asdict(row)
    assert not LIFECYCLE.is_dispatchable(row, now=NOW)
    assert not LIFECYCLE.dispatch(row, now=NOW)
    assert asdict(row) == before


def test_dispatch_release_is_pending_without_consuming_attempt_and_truncates_error() -> None:
    row = Record(status="DISPATCHED", attempt_count=2, dispatched_at=NOW)
    assert LIFECYCLE.release_dispatch(row, error="x" * 4001, now=NOW)
    assert (row.status, row.attempt_count, row.dispatched_at, row.updated_at) == (
        "PENDING",
        2,
        None,
        NOW,
    )
    assert row.last_error == "x" * 4000
    before = asdict(row)
    assert not LIFECYCLE.release_dispatch(row, error="late broker response", now=NOW)
    assert asdict(row) == before


@pytest.mark.parametrize("status", ["PENDING", "FAILED", "DISPATCHED"])
def test_claim_increments_one_based_attempt_once(status: str) -> None:
    row = Record(status=status, attempt_count=1)
    assert LIFECYCLE.claim_admission(row, now=NOW) is ClaimAdmission.READY
    assert LIFECYCLE.claim(row, token="token", now=NOW)
    assert (row.status, row.attempt_count, row.started_at, row.updated_at) == (
        "PROCESSING",
        2,
        NOW,
        NOW,
    )
    assert not LIFECYCLE.claim(row, token="token", now=NOW)
    assert row.attempt_count == 2


@pytest.mark.parametrize(
    ("row", "reason"),
    [
        (
            Record(status="FAILED", next_attempt_at=NOW + timedelta(seconds=1), attempt_count=5),
            ClaimAdmission.NOT_DUE,
        ),
        (Record(attempt_count=5), ClaimAdmission.EXHAUSTED),
        (Record(status="COMPLETED"), ClaimAdmission.INACTIVE),
        (Record(status="SUPERSEDED"), ClaimAdmission.INACTIVE),
    ],
)
def test_claim_admission_is_explicit_and_does_not_mutate(
    row: Record, reason: ClaimAdmission
) -> None:
    row = replace(row)
    before = asdict(row)
    assert LIFECYCLE.claim_admission(row, now=NOW) is reason
    assert not LIFECYCLE.claim(row, token="token", now=NOW)
    assert asdict(row) == before


def test_pending_broker_command_can_claim_while_dispatch_admission_is_not_due() -> None:
    row = Record(next_attempt_at=NOW + timedelta(days=1))
    assert not LIFECYCLE.is_dispatchable(row, now=NOW)
    assert LIFECYCLE.claim(row, token="token", now=NOW)


@pytest.mark.parametrize(("attempt", "seconds"), [(1, 60), (2, 120), (4, 480), (5, 960)])
def test_retry_uses_current_one_based_attempt(attempt: int, seconds: int) -> None:
    row = Record(status="PROCESSING", attempt_token="token", attempt_count=attempt)
    LIFECYCLE.fail_attempt(
        row, lease=DeliveryAttemptLease(attempt=attempt, token="token"), error="e" * 4001, now=NOW
    )
    assert (row.status, row.next_attempt_at, row.attempt_count, row.updated_at) == (
        "FAILED",
        NOW + timedelta(seconds=seconds),
        attempt,
        NOW,
    )
    assert row.last_error == "e" * 4000
    if attempt == 5:
        assert not LIFECYCLE.is_dispatchable(row, now=row.next_attempt_at)


@pytest.mark.parametrize(("attempt", "seconds"), [(4, 480), (8, 3840), (10, 3840)])
def test_retry_respects_domain_delay_ceiling(attempt: int, seconds: int) -> None:
    lifecycle = replace(LIFECYCLE, policy=replace(LIFECYCLE.policy, retry_max_seconds=3840))
    row = Record(status="PROCESSING", attempt_token="token", attempt_count=attempt)
    lifecycle.fail_attempt(
        row, lease=DeliveryAttemptLease(attempt=attempt, token="token"), error="retry", now=NOW
    )
    assert row.next_attempt_at == NOW + timedelta(seconds=seconds)


@pytest.mark.parametrize("success", ["COMPLETED", "SENT"])
def test_completion_uses_domain_success_mapping(success: str) -> None:
    lifecycle = replace(LIFECYCLE, statuses=replace(LIFECYCLE.statuses, succeeded=success))
    row = Record(
        status="PROCESSING", attempt_token="token", last_error="transient failure", attempt_count=2
    )
    lifecycle.complete_attempt(row, lease=DeliveryAttemptLease(attempt=2, token="token"), now=NOW)
    assert (row.status, row.completed_at, row.last_error, row.updated_at) == (
        success,
        NOW,
        None,
        NOW,
    )
    assert not lifecycle.claim(row, token="token", now=NOW)


@pytest.mark.parametrize(("status", "timeout"), [("DISPATCHED", 300), ("PROCESSING", 1200)])
@pytest.mark.parametrize("offset_us", [-1, 0, 1])
def test_lease_cutoff_is_inclusive_and_recovery_is_immediately_due(
    status: str, timeout: int, offset_us: int
) -> None:
    started = NOW - timedelta(seconds=timeout) + timedelta(microseconds=offset_us)
    row = Record(
        status=status,
        attempt_count=2,
        dispatched_at=started if status == "DISPATCHED" else None,
        started_at=started if status == "PROCESSING" else None,
        attempt_token="old-token" if status == "PROCESSING" else None,
    )
    before = asdict(row)
    recovered = LIFECYCLE.recover_lease(row, error="domain lease expired", now=NOW)
    assert recovered is (offset_us <= 0)
    if recovered:
        assert (row.status, row.next_attempt_at, row.updated_at, row.last_error) == (
            "FAILED",
            NOW,
            NOW,
            "domain lease expired",
        )
        assert row.attempt_count == 2
        assert row.attempt_token is None
        assert LIFECYCLE.is_dispatchable(row, now=NOW)
    else:
        assert asdict(row) == before


@pytest.mark.parametrize("status", ["PENDING", "COMPLETED", "DISPATCHED", "PROCESSING"])
def test_unleased_or_terminal_record_is_not_recovered(status: str) -> None:
    row = Record(status=status)
    before = asdict(row)
    assert not LIFECYCLE.recover_lease(row, error="expired", now=NOW)
    assert asdict(row) == before


@pytest.mark.parametrize("attempt,token", [(2, "token"), (1, "token"), (3, "token"), (2, "wrong")])
@pytest.mark.parametrize("operation", ["complete", "fail"])
def test_attempt_fencing(attempt, token, operation):
    row = Record(status="PROCESSING", attempt_count=2, attempt_token="token")
    before = asdict(row)
    lease = DeliveryAttemptLease(attempt=attempt, token=token)
    matches = attempt == 2 and token == "token"
    assert LIFECYCLE.attempt_matches(row, lease) is matches
    accepted = (
        LIFECYCLE.complete_attempt(row, lease=lease, now=NOW)
        if operation == "complete"
        else LIFECYCLE.fail_attempt(row, lease=lease, error="failed", now=NOW)
    )
    assert accepted is matches
    if not accepted:
        assert asdict(row) == before
    else:
        assert row.attempt_token is None


def test_terminal_attempt_has_no_execution_authority_or_second_transition():
    row = Record(status="PROCESSING", attempt_count=2, attempt_token="token")
    lease = DeliveryAttemptLease(attempt=2, token="token")
    assert LIFECYCLE.complete_attempt(row, lease=lease, now=NOW)
    before = asdict(row)
    assert not LIFECYCLE.complete_attempt(row, lease=lease, now=NOW + timedelta(days=1))
    assert not LIFECYCLE.fail_attempt(row, lease=lease, error="late", now=NOW)
    assert asdict(row) == before


def test_rearm_resets_common_fields_and_domain_reset_can_preserve_attempts() -> None:
    row = Record(
        status="SUPERSEDED",
        attempt_count=4,
        last_error="error",
        dispatched_at=NOW,
        started_at=NOW,
        completed_at=NOW,
    )
    LIFECYCLE.reset(row, status="SUPERSEDED", reset_attempts=False, now=NOW)
    assert row.attempt_count == 4
    assert row.status == "SUPERSEDED"
    LIFECYCLE.rearm(row, now=NOW)
    assert row == Record(updated_at=NOW)


def test_domain_terminal_and_exhaustion_decisions_use_common_field_mechanics() -> None:
    row = Record(status="PROCESSING", attempt_token="token", attempt_count=1)
    LIFECYCLE.finish(row, status="EXPIRED", error="expiry detail", now=NOW)
    assert (row.status, row.completed_at, row.updated_at, row.last_error) == (
        "EXPIRED",
        NOW,
        NOW,
        "expiry detail",
    )
    LIFECYCLE.exhaust(row, error="resource unavailable", now=NOW)
    assert (row.status, row.attempt_count, row.last_error) == ("FAILED", 5, "resource unavailable")


def test_lifecycle_dependencies_are_standard_library_only() -> None:
    path = Path(__file__).parents[1] / "app/modules/durable_work/delivery.py"
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.ImportFrom):
            assert (node.module or "").split(".")[0] in sys.stdlib_module_names
        elif isinstance(node, ast.Import):
            assert all(alias.name.split(".")[0] in sys.stdlib_module_names for alias in node.names)


def test_claim_is_the_single_processing_entry_and_lease_is_immutable():
    row = Record()
    lease = LIFECYCLE.claim(row, token="opaque-first", now=NOW)
    assert lease == DeliveryAttemptLease(attempt=1, token="opaque-first")
    assert "opaque-first" not in repr(lease)
    with pytest.raises(FrozenInstanceError):
        lease.token = "replacement"
    for operation in (
        lambda: LIFECYCLE.reset(row, status="PROCESSING", reset_attempts=False, now=NOW),
        lambda: LIFECYCLE.finish(row, status="PROCESSING", error=None, now=NOW),
    ):
        with pytest.raises(ValueError):
            operation()
    assert LIFECYCLE.attempt_matches(row, lease)
    assert LIFECYCLE.recover_lease(row, error="expired", now=NOW + timedelta(seconds=1200))
    assert not LIFECYCLE.attempt_matches(row, lease) and row.attempt_token is None
    second = LIFECYCLE.claim(row, token="opaque-second", now=NOW + timedelta(seconds=1200))
    assert second.attempt == 2 and second.token != lease.token


def test_generic_token_mutation_belongs_to_delivery_lifecycle():
    root = Path(__file__).parents[1] / "app"
    owners = set()
    for path in root.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Store):
                if node.attr == "attempt_token":
                    owners.add(path.relative_to(root).as_posix())
    assert owners == {"modules/durable_work/delivery.py"}


def test_domain_execution_leases_share_the_common_attempt_identity():
    from app.modules.import_jobs.dispatch_service import ImportExecutionLease
    from app.modules.scores.deletion_delivery import ScoreDeletionLease
    from app.modules.storage_objects.retirement import RetirementAttempt
    from app.modules.storage_objects.writes import CleanupAttempt

    for lease_type in (ImportExecutionLease, ScoreDeletionLease, RetirementAttempt, CleanupAttempt):
        assert issubclass(lease_type, DeliveryAttemptLease)


@pytest.mark.parametrize("transition", ["finish", "reset", "rearm", "exhaust"])
def test_administrative_lifecycle_transitions_invalidate_processing_ownership(transition):
    row = Record(status="PROCESSING", attempt_count=2, attempt_token="current-token")
    if transition == "finish":
        LIFECYCLE.finish(row, status="CANCELLED", error=None, now=NOW)
    elif transition == "reset":
        LIFECYCLE.reset(row, status="SUPERSEDED", reset_attempts=False, now=NOW)
    elif transition == "rearm":
        LIFECYCLE.rearm(row, now=NOW)
    else:
        LIFECYCLE.exhaust(row, error="exhausted", now=NOW)
    assert row.status != "PROCESSING" and row.attempt_token is None


def test_worker_outcome_services_require_an_explicit_attempt_lease():
    import inspect
    from app.modules.mail.outbox_service import MailOutboxService
    from app.modules.playback.outbox_service import PlaybackOutboxService
    from app.modules.score_assets.render_outbox_service import RenderOutboxService

    for service, commands in (
        (RenderOutboxService, ("complete", "fail", "supersede")),
        (PlaybackOutboxService, ("complete", "fail", "supersede")),
        (MailOutboxService, ("sent", "transient_failure", "permanent_failure")),
    ):
        for command in commands:
            lease = inspect.signature(getattr(service, command)).parameters["lease"]
            assert lease.default is inspect.Parameter.empty
            assert lease.kind is inspect.Parameter.KEYWORD_ONLY

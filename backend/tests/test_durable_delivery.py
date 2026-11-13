from __future__ import annotations

import ast
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timedelta
from pathlib import Path
import sys

import pytest

from app.modules.async_operations.durable_delivery import (
    ClaimAdmission,
    DeliveryLifecyclePolicy,
    DeliveryStatuses,
    DurableDeliveryLifecycle,
)

NOW = datetime(2026, 11, 6, 12)
LIFECYCLE = DurableDeliveryLifecycle(
    DeliveryStatuses("PENDING", "DISPATCHED", "PROCESSING", "FAILED", "COMPLETED"),
    DeliveryLifecyclePolicy(5, 60, 300, 1200),
)


@dataclass
class Record:
    status: str = "PENDING"
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
        Record(status="PROCESSING"),
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
    assert LIFECYCLE.claim(row, now=NOW)
    assert (row.status, row.attempt_count, row.started_at, row.updated_at) == (
        "PROCESSING",
        2,
        NOW,
        NOW,
    )
    assert not LIFECYCLE.claim(row, now=NOW)
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
    assert not LIFECYCLE.claim(row, now=NOW)
    assert asdict(row) == before


def test_pending_broker_command_can_claim_while_dispatch_admission_is_not_due() -> None:
    row = Record(next_attempt_at=NOW + timedelta(days=1))
    assert not LIFECYCLE.is_dispatchable(row, now=NOW)
    assert LIFECYCLE.claim(row, now=NOW)


@pytest.mark.parametrize(("attempt", "seconds"), [(0, 60), (1, 60), (2, 120), (4, 480), (5, 960)])
def test_retry_uses_current_one_based_attempt(attempt: int, seconds: int) -> None:
    row = Record(status="PROCESSING", attempt_count=attempt)
    LIFECYCLE.fail(row, error="e" * 4001, now=NOW)
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
    row = Record(status="PROCESSING", attempt_count=attempt)
    lifecycle.fail(row, error="retry", now=NOW)
    assert row.next_attempt_at == NOW + timedelta(seconds=seconds)


@pytest.mark.parametrize("success", ["COMPLETED", "SENT"])
def test_completion_uses_domain_success_mapping(success: str) -> None:
    lifecycle = replace(LIFECYCLE, statuses=replace(LIFECYCLE.statuses, succeeded=success))
    row = Record(status="PROCESSING", last_error="transient failure", attempt_count=2)
    lifecycle.complete(row, now=NOW)
    assert (row.status, row.completed_at, row.last_error, row.updated_at) == (
        success,
        NOW,
        None,
        NOW,
    )
    assert not lifecycle.claim(row, now=NOW)


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
        assert LIFECYCLE.is_dispatchable(row, now=NOW)
    else:
        assert asdict(row) == before


@pytest.mark.parametrize("status", ["PENDING", "COMPLETED", "DISPATCHED", "PROCESSING"])
def test_unleased_or_terminal_record_is_not_recovered(status: str) -> None:
    row = Record(status=status)
    before = asdict(row)
    assert not LIFECYCLE.recover_lease(row, error="expired", now=NOW)
    assert asdict(row) == before


@pytest.mark.parametrize("expected", [None, 2, 1, 3])
@pytest.mark.parametrize("operation", ["complete", "fail"])
def test_attempt_fencing(expected: int | None, operation: str) -> None:
    row = Record(status="PROCESSING", attempt_count=2)
    before = asdict(row)
    assert LIFECYCLE.attempt_matches(row, expected) is (expected in (None, 2))
    if operation == "complete":
        accepted = LIFECYCLE.complete_attempt(row, expected_attempt=expected, now=NOW)
    else:
        accepted = LIFECYCLE.fail_attempt(row, expected_attempt=expected, error="failed", now=NOW)
    assert accepted is (expected in (None, 2))
    if not accepted:
        assert asdict(row) == before


def test_completed_attempt_is_idempotent_and_rejects_stale_workers() -> None:
    row = Record(status="PROCESSING", attempt_count=2)
    assert LIFECYCLE.complete_attempt(row, expected_attempt=2, now=NOW)
    before = asdict(row)
    assert LIFECYCLE.complete_attempt(row, expected_attempt=2, now=NOW + timedelta(days=1))
    assert not LIFECYCLE.complete_attempt(row, expected_attempt=1, now=NOW)
    assert not LIFECYCLE.fail_attempt(row, expected_attempt=2, error="late", now=NOW)
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
    row = Record(status="PROCESSING", attempt_count=1)
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
    path = Path(__file__).parents[1] / "app/modules/async_operations/durable_delivery.py"
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.ImportFrom):
            assert (node.module or "").split(".")[0] in sys.stdlib_module_names
        elif isinstance(node, ast.Import):
            assert all(alias.name.split(".")[0] in sys.stdlib_module_names for alias in node.names)

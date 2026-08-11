from __future__ import annotations

from datetime import datetime, timedelta

from app.modules.async_operations.delivery_policy import (
    delivery_lease_expired,
    exponential_retry_delay_seconds,
)


def test_exponential_retry_delay_uses_one_based_attempt_count() -> None:
    assert exponential_retry_delay_seconds(base_seconds=60, attempt_count=0) == 60
    assert exponential_retry_delay_seconds(base_seconds=60, attempt_count=1) == 60
    assert exponential_retry_delay_seconds(base_seconds=60, attempt_count=2) == 120
    assert exponential_retry_delay_seconds(base_seconds=60, attempt_count=4) == 480


def test_delivery_lease_expired_detects_stale_dispatch_and_processing() -> None:
    now = datetime(2026, 8, 11, 12, 0, 0)

    assert delivery_lease_expired(
        status="dispatched",
        dispatched_status="dispatched",
        processing_status="processing",
        dispatched_at=now - timedelta(seconds=300),
        started_at=None,
        now=now,
        dispatch_timeout_seconds=300,
        processing_timeout_seconds=1200,
    )
    assert delivery_lease_expired(
        status="processing",
        dispatched_status="dispatched",
        processing_status="processing",
        dispatched_at=None,
        started_at=now - timedelta(seconds=1200),
        now=now,
        dispatch_timeout_seconds=300,
        processing_timeout_seconds=1200,
    )


def test_delivery_lease_expired_ignores_active_or_unleased_records() -> None:
    now = datetime(2026, 8, 11, 12, 0, 0)

    assert not delivery_lease_expired(
        status="pending",
        dispatched_status="dispatched",
        processing_status="processing",
        dispatched_at=now - timedelta(seconds=999),
        started_at=now - timedelta(seconds=999),
        now=now,
        dispatch_timeout_seconds=300,
        processing_timeout_seconds=300,
    )
    assert not delivery_lease_expired(
        status="dispatched",
        dispatched_status="dispatched",
        processing_status="processing",
        dispatched_at=None,
        started_at=None,
        now=now,
        dispatch_timeout_seconds=300,
        processing_timeout_seconds=1200,
    )

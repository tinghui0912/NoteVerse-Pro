"""Shared timing policy helpers for durable background deliveries."""

from __future__ import annotations

from datetime import datetime, timedelta


def exponential_retry_delay_seconds(*, base_seconds: int, attempt_count: int) -> int:
    """Return exponential retry delay for a one-based delivery attempt count."""

    return base_seconds * (2 ** max(0, attempt_count - 1))


def delivery_lease_expired(
    *,
    status: object,
    dispatched_status: object,
    processing_status: object,
    dispatched_at: datetime | None,
    started_at: datetime | None,
    now: datetime,
    dispatch_timeout_seconds: int,
    processing_timeout_seconds: int,
) -> bool:
    """Return whether a dispatched or processing delivery has exceeded its lease."""

    dispatched_cutoff = now - timedelta(seconds=dispatch_timeout_seconds)
    processing_cutoff = now - timedelta(seconds=processing_timeout_seconds)
    return (
        status == dispatched_status
        and dispatched_at is not None
        and dispatched_at <= dispatched_cutoff
    ) or (
        status == processing_status
        and started_at is not None
        and started_at <= processing_cutoff
    )

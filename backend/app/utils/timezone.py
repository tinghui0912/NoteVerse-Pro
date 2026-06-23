"""Timezone helpers for UTC-based timestamps."""

from datetime import datetime, timezone


def utc_now() -> datetime:
    """Return the current timezone-aware UTC datetime."""

    return datetime.now(timezone.utc)


def utc_now_naive() -> datetime:
    """Return the current UTC datetime without timezone information.

    This keeps compatibility with database columns that store naive UTC
    datetimes, such as MySQL `DATETIME`.
    """

    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_utc_naive(value: datetime | None) -> datetime | None:
    """Normalize a datetime for UTC-naive database columns."""

    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)

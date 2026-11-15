"""Canonical timezone-aware UTC instants."""

from datetime import UTC, datetime
from typing import Annotated

from pydantic import AfterValidator, AwareDatetime


def utc_now() -> datetime:
    return datetime.now(UTC)


def require_utc(value: datetime) -> datetime:
    """Normalize an aware instant; a timezone-free wall clock is not an instant."""
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("An instant requires an explicit timezone")
    return value.astimezone(UTC)


Instant = Annotated[AwareDatetime, AfterValidator(require_utc)]

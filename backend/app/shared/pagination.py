"""Shared API pagination contracts."""

from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class CursorPage(BaseModel, Generic[T]):
    """Cursor-based page for stable timelines and append-only feeds."""

    items: list[T]
    next_cursor: int | str | None


class OffsetPage(BaseModel, Generic[T]):
    """Offset-based page for operational and admin search results."""

    items: list[T]
    limit: int
    offset: int
    has_more: bool

"""Shared API pagination contracts."""

from typing import Generic, TypeVar

from pydantic import BaseModel, computed_field
from app.shared.api_model import ApiModel

T = TypeVar("T")


class CursorPage(ApiModel, Generic[T]):
    """Cursor-based page for stable timelines and append-only feeds."""

    items: list[T]
    next_cursor: int | str | None


class OffsetPage(BaseModel, Generic[T]):
    """Offset-based page for operational and admin search results."""

    items: list[T]
    limit: int
    offset: int
    has_more: bool


class PageNumberPage(ApiModel, Generic[T]):
    """Page-number collection resource with an explicit item list and totals."""

    items: list[T]
    page: int
    page_size: int
    total: int

    @computed_field  # type: ignore[prop-decorator]
    @property
    def total_pages(self) -> int:
        return (self.total + self.page_size - 1) // self.page_size if self.total else 0

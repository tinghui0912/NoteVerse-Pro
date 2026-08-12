"""Filter contract for operator-facing async-operation queries."""

from dataclasses import dataclass
from datetime import datetime

from app.modules.ops.schemas import AsyncOperationErrorClass, AsyncOperationStatus


@dataclass(frozen=True)
class AsyncOperationFilters:
    status: AsyncOperationStatus | None = None
    error_class: AsyncOperationErrorClass | None = None
    resource_type: str | None = None
    created_after: datetime | None = None
    updated_before: datetime | None = None

    @property
    def has_filters(self) -> bool:
        return any(
            value is not None
            for value in (
                self.status,
                self.error_class,
                self.resource_type,
                self.created_after,
                self.updated_before,
            )
        )

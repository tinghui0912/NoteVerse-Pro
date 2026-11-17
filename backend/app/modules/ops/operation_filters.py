"""Filter contract for operator-facing async-operation queries."""

from dataclasses import dataclass
from datetime import datetime

from app.modules.ops.schemas import AsyncOperationStatus
from app.shared.durable_failure import DurableFailureClass


@dataclass(frozen=True)
class AsyncOperationFilters:
    status: AsyncOperationStatus | None = None
    failure_class: DurableFailureClass | None = None
    resource_type: str | None = None
    created_after: datetime | None = None
    updated_before: datetime | None = None

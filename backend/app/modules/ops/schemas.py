from __future__ import annotations

import enum
from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class AsyncOperationKind(str, enum.Enum):
    IMPORT = "import"
    RENDER = "render"
    PLAYBACK = "playback"
    MAIL = "mail"
    SCORE_DELETION = "score_deletion"


class AsyncOperationStatus(str, enum.Enum):
    QUEUED = "queued"
    DISPATCHED = "dispatched"
    PROCESSING = "processing"
    RETRYING = "retrying"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    PERMANENT_FAILED = "permanent_failed"
    EXPIRED = "expired"
    EXHAUSTED = "exhausted"
    BLOCKED = "blocked"


class AsyncOperationErrorClass(str, enum.Enum):
    TRANSIENT = "transient"
    PERMANENT = "permanent"
    USER_ERROR = "user_error"
    SYSTEM_ERROR = "system_error"
    UNKNOWN = "unknown"


class AsyncOperationRead(BaseModel):
    operation_id: str
    kind: AsyncOperationKind
    resource_type: str
    resource_id: str
    status: AsyncOperationStatus
    raw_status: str
    attempts: int
    max_attempts: int | None
    next_attempt_at: datetime | None
    last_error: str | None
    error_class: AsyncOperationErrorClass | None
    created_at: datetime | None
    updated_at: datetime | None


class AsyncOperationStatusCount(BaseModel):
    status: AsyncOperationStatus
    count: int


class AsyncOperationKindSummary(BaseModel):
    kind: AsyncOperationKind
    total: int
    statuses: list[AsyncOperationStatusCount]


class AsyncOperationsSummaryRead(BaseModel):
    total: int
    statuses: list[AsyncOperationStatusCount]
    kinds: list[AsyncOperationKindSummary]


class OpsOffsetPage(BaseModel, Generic[T]):
    items: list[T]
    limit: int
    offset: int
    has_more: bool


class OpsAuditOutcome(str, enum.Enum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class OpsAuditEventRead(BaseModel):
    event_id: str
    actor_user_id: int | None
    action: str
    operation_kind: AsyncOperationKind
    operation_id: str
    outcome: OpsAuditOutcome
    error_code: str | None
    error_detail: str | None
    created_at: datetime

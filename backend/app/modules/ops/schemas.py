from __future__ import annotations

import enum
from app.shared.time import Instant

from pydantic import BaseModel, Field, field_validator
from app.shared.api_model import ApiModel
from app.shared.durable_failure import DurableFailureClass


class AsyncOperationKind(str, enum.Enum):
    IMPORT = "import"
    REVISION_RENDER = "revision_render"
    PLAYBACK = "playback"
    MAIL = "mail"
    SCORE_DELETION = "score_deletion"
    ACCOUNT_DELETION = "account_deletion"
    STORED_OBJECT_RETIREMENT = "stored_object_retirement"


class AsyncOperationStatus(str, enum.Enum):
    QUEUED = "queued"
    DISPATCHED = "dispatched"
    PROCESSING = "processing"
    RETRYING = "retrying"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SUPERSEDED = "superseded"
    CANCELLED = "cancelled"


class AsyncOperationFailure(BaseModel):
    code: str
    stage: str
    classification: DurableFailureClass
    retryable: bool
    detail: str | None


class ReasonCommand(BaseModel):
    reason: str = Field(min_length=3, max_length=500)

    @field_validator("reason")
    @classmethod
    def meaningful_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("A meaningful recovery reason is required")
        return value


class RetryAsyncOperationCommand(ReasonCommand):
    pass


class AsyncOperationRead(ApiModel):
    operation_id: str
    kind: AsyncOperationKind
    resource_type: str
    resource_id: str
    originating_request_id: str | None = None
    status: AsyncOperationStatus
    attempts: int
    can_retry: bool = False
    execution_stage: str | None = None
    max_attempts: int | None
    next_attempt_at: Instant | None
    failure: AsyncOperationFailure | None = None
    created_at: Instant | None
    updated_at: Instant | None


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


class OpsAuditOutcome(str, enum.Enum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class OpsAuditEventRead(ApiModel):
    event_id: str
    actor_operator_id: int | None
    action: str
    target_type: str
    target_id: str
    outcome: OpsAuditOutcome
    error_code: str | None
    reason: str
    request_id: str | None
    user_agent: str | None
    ip_address: str | None
    previous_state: str | None
    new_state: str | None
    metadata_json: dict
    created_at: Instant

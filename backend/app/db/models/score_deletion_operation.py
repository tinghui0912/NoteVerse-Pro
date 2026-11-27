"""Durable asynchronous cleanup of one deleted Score."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlmodel import Field, SQLModel

from app.db.durable_delivery import (
    delivery_attempt_count_constraint,
    delivery_attempt_count_field,
    delivery_attempt_token_constraint,
    delivery_attempt_token_field,
    delivery_next_attempt_at_field,
    delivery_optional_timestamp_field,
    durable_failure_facts_constraint,
    failure_classification_field,
    failure_code_field,
    failure_detail_field,
    failure_retryable_field,
    failure_stage_field,
)
from app.shared.time import utc_now


class ScoreDeletionOperationStatus(str, enum.Enum):
    PENDING = "PENDING"
    DISPATCHED = "DISPATCHED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ScoreDeletionOperation(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_deletion_operations"
    __table_args__ = (
        durable_failure_facts_constraint(name="ck_score_deletion_operations_failure_facts"),
        delivery_attempt_count_constraint(name="ck_score_deletion_attempt_count"),
        delivery_attempt_token_constraint(
            name="ck_score_deletion_attempt_token",
            processing_status=ScoreDeletionOperationStatus.PROCESSING,
        ),
        Index("idx_score_deletion_due", "status", "next_attempt_at"),
    )
    id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
        ),
    )
    operation_uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
    score_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("scores.id", ondelete="SET NULL"), unique=True),
    )
    score_uuid: str = Field(sa_column=Column(String(36), unique=True, nullable=False))
    # Immutable admission snapshot; completed evidence outlives account erasure.
    owner_user_id: int = Field(sa_column=Column(BigInteger, nullable=False))
    originating_request_id: Optional[str] = Field(
        default=None, sa_column=Column(String(64), index=True)
    )
    traceparent: Optional[str] = Field(default=None, sa_column=Column(String(55)))
    tracestate: Optional[str] = Field(default=None, sa_column=Column(String(512)))
    status: ScoreDeletionOperationStatus = Field(
        default=ScoreDeletionOperationStatus.PENDING,
        sa_column=Column(
            SAEnum(ScoreDeletionOperationStatus, name="scoredeletionoperationstatus"),
            default=ScoreDeletionOperationStatus.PENDING,
            nullable=False,
        ),
    )
    attempt_count: int = delivery_attempt_count_field()
    next_attempt_at: datetime = delivery_next_attempt_at_field()
    dispatched_at: Optional[datetime] = delivery_optional_timestamp_field()
    started_at: Optional[datetime] = delivery_optional_timestamp_field()
    completed_at: Optional[datetime] = delivery_optional_timestamp_field()
    failure_detail: Optional[str] = failure_detail_field()
    attempt_token: Optional[str] = delivery_attempt_token_field()
    failure_code: Optional[str] = failure_code_field()
    failure_stage: Optional[str] = failure_stage_field()
    failure_classification: Optional[str] = failure_classification_field()
    failure_retryable: Optional[bool] = failure_retryable_field()
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), default=utc_now, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
        ),
    )

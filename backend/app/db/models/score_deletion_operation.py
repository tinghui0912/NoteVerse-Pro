"""Durable asynchronous cleanup of one deleted Score."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlmodel import Field, SQLModel
from app.utils.timezone import utc_now_naive


class ScoreDeletionOperationStatus(str, enum.Enum):
    PENDING = "PENDING"
    DISPATCHED = "DISPATCHED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ScoreDeletionOperation(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_deletion_operations"
    __table_args__ = (
        CheckConstraint(
            "((internal_error_code IS NULL AND internal_error_stage IS NULL AND internal_error_class IS NULL AND internal_error_retryable IS NULL) OR (internal_error_code IS NOT NULL AND internal_error_stage IS NOT NULL AND internal_error_class IS NOT NULL AND internal_error_retryable IS NOT NULL AND internal_error_class IN ('transient', 'permanent', 'user_error', 'system_error')))",
            name="ck_score_deletion_operations_failure_metadata",
        ),
        CheckConstraint("attempt_count >= 0", name="ck_score_deletion_attempt_count"),
        CheckConstraint(
            "(status = 'PROCESSING' AND attempt_token IS NOT NULL) OR (status <> 'PROCESSING' AND attempt_token IS NULL)",
            name="ck_score_deletion_attempt_token",
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
    owner_user_id: int = Field(sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=False))
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
    attempt_count: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
    next_attempt_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    dispatched_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    started_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    completed_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    last_error: Optional[str] = Field(default=None, sa_column=Column(Text))
    attempt_token: Optional[str] = Field(default=None, sa_column=Column(String(36)))
    internal_error_code: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    internal_error_stage: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    internal_error_class: Optional[str] = Field(default=None, sa_column=Column(String(32)))
    internal_error_retryable: Optional[bool] = Field(default=None, sa_column=Column(Boolean))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive, nullable=False),
    )

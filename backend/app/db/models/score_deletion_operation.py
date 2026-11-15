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
        CheckConstraint(
            "((failure_code IS NULL AND failure_stage IS NULL AND failure_classification IS NULL AND failure_retryable IS NULL) OR (failure_code IS NOT NULL AND failure_stage IS NOT NULL AND failure_classification IS NOT NULL AND failure_retryable IS NOT NULL AND failure_classification IN ('transient', 'permanent', 'user_error', 'system_error')))",
            name="ck_score_deletion_operations_failure_facts",
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
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), default=utc_now, nullable=False),
    )
    dispatched_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    started_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    completed_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    failure_detail: Optional[str] = Field(default=None, sa_column=Column(Text))
    attempt_token: Optional[str] = Field(default=None, sa_column=Column(String(36)))
    failure_code: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    failure_stage: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    failure_classification: Optional[str] = Field(default=None, sa_column=Column(String(32)))
    failure_retryable: Optional[bool] = Field(default=None, sa_column=Column(Boolean))
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

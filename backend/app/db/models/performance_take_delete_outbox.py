from __future__ import annotations

from datetime import datetime
import enum
from typing import Optional
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class PerformanceTakeDeleteOutboxStatus(str, enum.Enum):
    PENDING = "PENDING"
    DISPATCHED = "DISPATCHED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class PerformanceTakeDeleteOutbox(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "performance_take_delete_outbox"
    __table_args__ = (
        Index("ix_take_delete_outbox_status_next_attempt", "status", "next_attempt_at"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    outbox_uuid: str = Field(
        default_factory=lambda: str(uuid4()),
        sa_column=Column(String(36), unique=True, index=True, nullable=False),
    )
    take_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            bigint_pk_type,
            ForeignKey("performance_takes.id", ondelete="SET NULL"),
            index=True,
            nullable=True,
        ),
    )
    take_uuid: str = Field(
        sa_column=Column(String(36), unique=True, index=True, nullable=False)
    )
    user_id: int = Field(
        sa_column=Column(
            bigint_pk_type,
            ForeignKey("users.id", ondelete="CASCADE"),
            index=True,
            nullable=False,
        )
    )
    storage_backend: str = Field(
        sa_column=Column(String(32), nullable=False)
    )
    object_key: str = Field(
        sa_column=Column(String(768), nullable=False)
    )
    media_byte_size: int = Field(
        sa_column=Column(BigInteger, nullable=False)
    )
    status: str = Field(
        default=PerformanceTakeDeleteOutboxStatus.PENDING.value,
        sa_column=Column(
            String(24),
            nullable=False,
            default=PerformanceTakeDeleteOutboxStatus.PENDING.value,
        ),
    )
    attempt_count: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0),
    )
    max_attempts: int = Field(
        default=5,
        sa_column=Column(Integer, nullable=False, default=5),
    )
    next_attempt_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, nullable=False, default=utc_now_naive),
    )
    started_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime, nullable=True),
    )
    dispatched_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime, nullable=True),
    )
    completed_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime, nullable=True),
    )
    last_error: Optional[str] = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(
            DateTime,
            default=utc_now_naive,
            onupdate=utc_now_naive,
            nullable=False,
        ),
    )

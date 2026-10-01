from __future__ import annotations

from datetime import datetime
import enum
from typing import Optional
from uuid import uuid4

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class PracticeSourceSnapshotDeleteOutboxStatus(str, enum.Enum):
    PENDING = "PENDING"
    DISPATCHED = "DISPATCHED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class PracticeSourceSnapshotDeleteOutbox(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "practice_source_snapshot_delete_outbox"
    __table_args__ = (
        Index("ix_source_snapshot_delete_status_next", "status", "next_attempt_at"),
        Index("ix_source_snapshot_delete_snapshot_uuid", "snapshot_uuid"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    outbox_uuid: str = Field(
        default_factory=lambda: str(uuid4()),
        sa_column=Column(String(36), unique=True, index=True, nullable=False),
    )
    source_snapshot_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            bigint_pk_type,
            ForeignKey("practice_source_snapshots.id", ondelete="SET NULL"),
            index=True,
            nullable=True,
        ),
    )
    snapshot_uuid: str = Field(sa_column=Column(String(36), nullable=False))
    storage_backend: str = Field(sa_column=Column(String(32), nullable=False))
    prepared_musicxml_object_key: str = Field(sa_column=Column(String(768), nullable=False))
    artifact_object_key: str = Field(sa_column=Column(String(768), nullable=False))
    status: str = Field(
        default=PracticeSourceSnapshotDeleteOutboxStatus.PENDING.value,
        sa_column=Column(
            String(24),
            nullable=False,
            default=PracticeSourceSnapshotDeleteOutboxStatus.PENDING.value,
        ),
    )
    attempt_count: int = Field(default=0, sa_column=Column(Integer, nullable=False, default=0))
    max_attempts: int = Field(default=5, sa_column=Column(Integer, nullable=False, default=5))
    next_attempt_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, nullable=False, default=utc_now_naive),
    )
    started_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, nullable=True))
    dispatched_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, nullable=True))
    completed_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, nullable=True))
    last_error: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
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

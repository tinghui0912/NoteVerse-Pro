from __future__ import annotations

from datetime import datetime
import enum
from typing import Optional
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    UniqueConstraint,
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


class PracticeBundleDeleteOutboxStatus(str, enum.Enum):
    PENDING = "PENDING"
    DISPATCHED = "DISPATCHED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class PracticeBundleDeleteOutbox(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "practice_bundle_delete_outbox"
    __table_args__ = (
        UniqueConstraint("outbox_uuid", name="uq_practice_bundle_delete_outbox_uuid"),
        CheckConstraint(
            "status IN ('PENDING', 'DISPATCHED', 'PROCESSING', 'COMPLETED', 'FAILED')",
            name="ck_practice_bundle_delete_status",
        ),
        Index("ix_practice_bundle_delete_status_next", "status", "next_attempt_at"),
        Index("ix_practice_bundle_delete_bundle_id", "bundle_id"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    outbox_uuid: str = Field(
        default_factory=lambda: str(uuid4()),
        sa_column=Column(String(36), nullable=False),
    )
    practice_bundle_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            bigint_pk_type,
            ForeignKey(
                "practice_bundles.id", ondelete="SET NULL", name="fk_practice_bundle_delete_bundle"
            ),
            index=True,
            nullable=True,
        ),
    )
    bundle_id: str = Field(sa_column=Column(String(128), nullable=False))
    storage_backend: str = Field(sa_column=Column(String(32), nullable=False))
    prepared_musicxml_object_key: str = Field(sa_column=Column(String(768), nullable=False))
    artifact_object_key: str = Field(sa_column=Column(String(768), nullable=False))
    status: str = Field(
        default=PracticeBundleDeleteOutboxStatus.PENDING.value,
        sa_column=Column(
            String(24),
            nullable=False,
            default=PracticeBundleDeleteOutboxStatus.PENDING.value,
        ),
    )
    attempt_count: int = Field(default=0, sa_column=Column(Integer, nullable=False, default=0))
    max_attempts: int = Field(default=5, sa_column=Column(Integer, nullable=False, default=5))
    next_attempt_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, nullable=False, default=utc_now_naive),
    )
    started_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, nullable=True))
    dispatched_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime, nullable=True)
    )
    completed_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime, nullable=True)
    )
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

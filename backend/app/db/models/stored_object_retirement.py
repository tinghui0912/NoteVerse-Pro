"""Durable operation evidence for retirement of an unreferenced physical object."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel

from app.shared.time import utc_now


class StoredObjectRetirement(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "stored_object_retirements"
    __table_args__ = (
        CheckConstraint(
            "(status = 'PROCESSING' AND attempt_token IS NOT NULL) OR (status <> 'PROCESSING' AND attempt_token IS NULL)",
            name="ck_stored_object_retirements_attempt_token",
        ),
        UniqueConstraint("stored_object_id", name="uq_object_retirement_object"),
        CheckConstraint(
            "status IN ('PENDING','DISPATCHED','PROCESSING','FAILED','COMPLETED','CANCELLED')",
            name="ck_object_retirement_status",
        ),
        CheckConstraint("attempt_count >= 0", name="ck_object_retirement_attempts"),
        Index("ix_object_retirement_due", "status", "next_attempt_at"),
    )
    id: int | None = Field(
        default=None,
        sa_column=Column(
            BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
        ),
    )
    retirement_uuid: str = Field(
        default_factory=lambda: str(uuid4()),
        sa_column=Column(String(36), nullable=False, unique=True),
    )
    stored_object_id: int | None = Field(
        default=None,
        sa_column=Column(
            BigInteger, ForeignKey("stored_objects.id", ondelete="SET NULL"), nullable=True
        ),
    )
    object_key: str = Field(sa_column=Column(String(768), nullable=False))
    byte_size: int = Field(sa_column=Column(BigInteger, nullable=False))
    sha256: str = Field(sa_column=Column(String(64), nullable=False))
    content_type: str = Field(sa_column=Column(String(255), nullable=False))
    status: str = Field(
        default="PENDING", sa_column=Column(String(24), nullable=False, default="PENDING")
    )
    attempt_count: int = Field(default=0, sa_column=Column(Integer, nullable=False, default=0))
    attempt_token: str | None = Field(default=None, sa_column=Column(String(36)))
    next_attempt_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, default=utc_now),
    )
    dispatched_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    started_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    completed_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    failure_detail: str | None = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, default=utc_now),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, default=utc_now),
    )

"""Revision-owned durable metadata execution, separate from the read model."""

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
)
from sqlmodel import Field, SQLModel
from app.utils.timezone import utc_now_naive


class RevisionMetadataOutbox(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "revision_metadata_outbox"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING','DISPATCHED','PROCESSING','FAILED','COMPLETED')",
            name="ck_revision_metadata_status",
        ),
        CheckConstraint("attempt_count >= 0", name="ck_revision_metadata_attempts"),
        CheckConstraint(
            "(status = 'PROCESSING' AND attempt_token IS NOT NULL) OR (status <> 'PROCESSING' AND attempt_token IS NULL)",
            name="ck_revision_metadata_token",
        ),
        Index("ix_revision_metadata_due", "status", "next_attempt_at"),
    )
    id: int | None = Field(
        default=None,
        sa_column=Column(
            BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
        ),
    )
    outbox_uuid: str = Field(
        default_factory=lambda: str(uuid4()),
        sa_column=Column(String(36), nullable=False, unique=True),
    )
    revision_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("score_revisions.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        )
    )
    source_fingerprint: str = Field(sa_column=Column(String(64), nullable=False))
    originating_request_id: str | None = Field(default=None, sa_column=Column(String(64)))
    traceparent: str | None = Field(default=None, sa_column=Column(String(55)))
    tracestate: str | None = Field(default=None, sa_column=Column(String(512)))
    status: str = Field(default="PENDING", sa_column=Column(String(16), nullable=False))
    attempt_count: int = Field(default=0, sa_column=Column(Integer, nullable=False))
    attempt_token: str | None = Field(default=None, sa_column=Column(String(36)))
    next_attempt_at: datetime = Field(
        default_factory=utc_now_naive, sa_column=Column(DateTime, nullable=False)
    )
    dispatched_at: datetime | None = Field(default=None, sa_column=Column(DateTime))
    started_at: datetime | None = Field(default=None, sa_column=Column(DateTime))
    completed_at: datetime | None = Field(default=None, sa_column=Column(DateTime))
    last_error: str | None = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(
        default_factory=utc_now_naive, sa_column=Column(DateTime, nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=utc_now_naive, sa_column=Column(DateTime, nullable=False)
    )

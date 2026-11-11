"""Durable ownership of server-created bytes before semantic adoption."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive


class ObjectWriteIntent(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "object_write_intents"
    __table_args__ = (
        UniqueConstraint("object_key", name="uq_object_write_intent_key"),
        CheckConstraint(
            "status IN ('PREPARED','WRITTEN','ADOPTED','CLEANUP_PENDING','CLEANUP_DISPATCHED','CLEANUP_PROCESSING','CLEANUP_FAILED','CLEANED')",
            name="ck_object_write_intent_status",
        ),
        CheckConstraint("attempt_count >= 0", name="ck_object_write_intent_attempts"),
        Index("ix_object_write_intent_due", "status", "next_attempt_at"),
    )
    id: int | None = Field(
        default=None,
        sa_column=Column(
            BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
        ),
    )
    intent_uuid: str = Field(
        default_factory=lambda: str(uuid4()),
        sa_column=Column(String(36), nullable=False, unique=True),
    )
    object_key: str = Field(sa_column=Column(String(768), nullable=False))
    byte_size: int = Field(sa_column=Column(BigInteger, nullable=False))
    sha256: str = Field(sa_column=Column(String(64), nullable=False))
    content_type: str = Field(sa_column=Column(String(255), nullable=False))
    status: str = Field(
        default="PREPARED", sa_column=Column(String(24), nullable=False, default="PREPARED")
    )
    write_token: str = Field(sa_column=Column(String(36), nullable=False))
    write_expires_at: datetime = Field(sa_column=Column(DateTime, nullable=False))
    written_at: datetime | None = Field(default=None, sa_column=Column(DateTime))
    attempt_count: int = Field(default=0, sa_column=Column(Integer, nullable=False, default=0))
    attempt_token: str | None = Field(default=None, sa_column=Column(String(36)))
    next_attempt_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, nullable=False, default=utc_now_naive),
    )
    dispatched_at: datetime | None = Field(default=None, sa_column=Column(DateTime))
    started_at: datetime | None = Field(default=None, sa_column=Column(DateTime))
    completed_at: datetime | None = Field(default=None, sa_column=Column(DateTime))
    last_error: str | None = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, nullable=False, default=utc_now_naive),
    )
    updated_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, nullable=False, default=utc_now_naive),
    )

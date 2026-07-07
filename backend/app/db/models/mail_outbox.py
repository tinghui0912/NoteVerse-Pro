from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    Enum as SAEnum,
    Index,
    Integer,
    String,
    Text,
)
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive


bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class MailOutboxStatus(str, enum.Enum):
    PENDING = "PENDING"
    DISPATCHED = "DISPATCHED"
    PROCESSING = "PROCESSING"
    SENT = "SENT"
    FAILED = "FAILED"
    PERMANENT_FAILURE = "PERMANENT_FAILURE"
    EXPIRED = "EXPIRED"


class MailOutbox(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "mail_outbox"
    __table_args__ = (
        CheckConstraint("attempt_count >= 0", name="ck_mail_outbox_attempt_count"),
        Index("idx_mail_outbox_status_available", "status", "next_attempt_at"),
        Index("idx_mail_outbox_dispatched", "status", "dispatched_at"),
        Index("idx_mail_outbox_created", "created_at"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    outbox_uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
    category: str = Field(sa_column=Column(String(64), nullable=False))
    dedupe_key: str = Field(sa_column=Column(String(160), unique=True, nullable=False))
    recipient: str = Field(sa_column=Column(String(320), nullable=False))
    subject: str = Field(sa_column=Column(String(255), nullable=False))
    text_body: Optional[str] = Field(default=None, sa_column=Column(Text))
    html_body: Optional[str] = Field(default=None, sa_column=Column(Text))
    status: MailOutboxStatus = Field(
        default=MailOutboxStatus.PENDING,
        sa_column=Column(
            SAEnum(MailOutboxStatus, name="mailoutboxstatus"),
            default=MailOutboxStatus.PENDING,
            nullable=False,
        ),
    )
    attempt_count: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
    next_attempt_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    expires_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    dispatched_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    started_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    completed_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    provider_message_id: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    last_error: Optional[str] = Field(default=None, sa_column=Column(Text))
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

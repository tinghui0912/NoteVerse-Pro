from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Index,
    Integer,
    String,
    Text,
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
        durable_failure_facts_constraint(name="ck_mail_outbox_failure_facts"),
        delivery_attempt_token_constraint(
            name="ck_mail_outbox_attempt_token", processing_status=MailOutboxStatus.PROCESSING
        ),
        delivery_attempt_count_constraint(name="ck_mail_outbox_attempt_count"),
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
    originating_request_id: Optional[str] = Field(
        default=None,
        sa_column=Column(String(64), index=True),
    )
    traceparent: Optional[str] = Field(default=None, sa_column=Column(String(55)))
    tracestate: Optional[str] = Field(default=None, sa_column=Column(String(512)))
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
    attempt_token: str | None = delivery_attempt_token_field()
    attempt_count: int = delivery_attempt_count_field()
    next_attempt_at: datetime = delivery_next_attempt_at_field()
    expires_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    dispatched_at: Optional[datetime] = delivery_optional_timestamp_field()
    started_at: Optional[datetime] = delivery_optional_timestamp_field()
    completed_at: Optional[datetime] = delivery_optional_timestamp_field()
    provider_message_id: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    failure_detail: Optional[str] = failure_detail_field()
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
            DateTime(timezone=True),
            default=utc_now,
            onupdate=utc_now,
            nullable=False,
        ),
    )

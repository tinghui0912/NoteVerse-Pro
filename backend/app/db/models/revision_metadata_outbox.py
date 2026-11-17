"""Revision-owned durable metadata execution, separate from the read model."""

from enum import StrEnum
from datetime import datetime
from uuid import uuid4

from sqlalchemy import Enum as SAEnum
from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlmodel import Field, SQLModel

from app.db.durable_delivery import (
    delivery_attempt_count_constraint,
    delivery_attempt_count_field,
    delivery_attempt_token_constraint,
    delivery_attempt_token_field,
    delivery_next_attempt_at_field,
    delivery_optional_timestamp_field,
    failure_detail_field,
)
from app.shared.time import utc_now


class RevisionMetadataOutboxStatus(StrEnum):
    PENDING = "PENDING"
    DISPATCHED = "DISPATCHED"
    PROCESSING = "PROCESSING"
    FAILED = "FAILED"
    COMPLETED = "COMPLETED"


class RevisionMetadataOutbox(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "revision_metadata_outbox"
    __table_args__ = (
        delivery_attempt_count_constraint(name="ck_revision_metadata_attempts"),
        delivery_attempt_token_constraint(
            name="ck_revision_metadata_token",
            processing_status=RevisionMetadataOutboxStatus.PROCESSING,
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
    status: RevisionMetadataOutboxStatus = Field(
        default=RevisionMetadataOutboxStatus.PENDING,
        sa_column=Column(
            SAEnum(
                RevisionMetadataOutboxStatus,
                native_enum=False,
                create_constraint=True,
                validate_strings=True,
                values_callable=lambda cls: [value.value for value in cls],
                name="ck_revision_metadata_status",
                length=16,
            ),
            nullable=False,
        ),
    )
    attempt_count: int = delivery_attempt_count_field(sql_default=False)
    attempt_token: str | None = delivery_attempt_token_field()
    next_attempt_at: datetime = delivery_next_attempt_at_field(sql_default=False)
    dispatched_at: datetime | None = delivery_optional_timestamp_field()
    started_at: datetime | None = delivery_optional_timestamp_field()
    completed_at: datetime | None = delivery_optional_timestamp_field()
    failure_detail: str | None = failure_detail_field()
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )

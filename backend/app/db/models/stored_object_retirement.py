"""Durable operation evidence for retirement of an unreferenced physical object."""

from enum import StrEnum
from datetime import datetime
from uuid import uuid4

from sqlalchemy import Enum as SAEnum
from sqlalchemy import (
    BigInteger,
    Column,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
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
    failure_code_field,
    failure_stage_field,
    failure_classification_field,
    failure_retryable_field,
    durable_failure_facts_constraint,
)
from app.shared.time import utc_now


class StoredObjectRetirementStatus(StrEnum):
    PENDING = "PENDING"
    DISPATCHED = "DISPATCHED"
    PROCESSING = "PROCESSING"
    FAILED = "FAILED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class StoredObjectRetirement(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "stored_object_retirements"
    __table_args__ = (
        durable_failure_facts_constraint(name="ck_object_retirement_failure_facts"),
        CheckConstraint(
            "deletion_fenced_at IS NULL OR status <> 'CANCELLED'",
            name="ck_object_retirement_deletion_fence",
        ),
        delivery_attempt_token_constraint(
            name="ck_stored_object_retirements_attempt_token",
            processing_status=StoredObjectRetirementStatus.PROCESSING,
        ),
        UniqueConstraint("stored_object_id", name="uq_object_retirement_object"),
        delivery_attempt_count_constraint(name="ck_object_retirement_attempts"),
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
    status: StoredObjectRetirementStatus = Field(
        default=StoredObjectRetirementStatus.PENDING,
        sa_column=Column(
            SAEnum(
                StoredObjectRetirementStatus,
                native_enum=False,
                create_constraint=True,
                validate_strings=True,
                values_callable=lambda cls: [value.value for value in cls],
                name="ck_object_retirement_status",
                length=24,
            ),
            nullable=False,
            default=StoredObjectRetirementStatus.PENDING,
        ),
    )
    attempt_count: int = delivery_attempt_count_field()
    attempt_token: str | None = delivery_attempt_token_field()
    next_attempt_at: datetime = delivery_next_attempt_at_field()
    dispatched_at: datetime | None = delivery_optional_timestamp_field()
    started_at: datetime | None = delivery_optional_timestamp_field()
    completed_at: datetime | None = delivery_optional_timestamp_field()
    deletion_fenced_at: datetime | None = delivery_optional_timestamp_field()
    failure_code: str | None = failure_code_field()
    failure_stage: str | None = failure_stage_field()
    failure_classification: str | None = failure_classification_field()
    failure_retryable: bool | None = failure_retryable_field()
    failure_detail: str | None = failure_detail_field()
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, default=utc_now),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, default=utc_now),
    )

"""Take-owned durable media verification; delivery evidence follows Take erasure."""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import (
    BigInteger,
    Integer,
    Column,
    String,
    DateTime,
    ForeignKey,
    Index,
    Enum as SAEnum,
)
from sqlmodel import SQLModel, Field
from app.modules.performance_takes.processing_states import TakeProcessingStatus as Status
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


class TakeProcessingOutbox(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "take_processing_outbox"
    __table_args__ = (
        delivery_attempt_count_constraint(name="ck_take_processing_attempts"),
        delivery_attempt_token_constraint(
            name="ck_take_processing_token", processing_status=Status.PROCESSING
        ),
        durable_failure_facts_constraint(name="ck_take_processing_failure"),
        Index("ix_take_processing_due", "status", "next_attempt_at"),
    )
    id: int | None = Field(
        default=None,
        sa_column=Column(
            BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
        ),
    )
    operation_uuid: str = Field(
        default_factory=lambda: str(uuid4()),
        sa_column=Column(String(36), nullable=False, unique=True),
    )
    take_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("performance_takes.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        )
    )
    status: Status = Field(
        default=Status.PENDING,
        sa_column=Column(
            SAEnum(
                Status, native_enum=False, create_constraint=True, name="ck_take_processing_status"
            ),
            nullable=False,
        ),
    )
    attempt_token: str | None = delivery_attempt_token_field()
    attempt_count: int = delivery_attempt_count_field()
    next_attempt_at: datetime = delivery_next_attempt_at_field()
    dispatched_at: datetime | None = delivery_optional_timestamp_field()
    started_at: datetime | None = delivery_optional_timestamp_field()
    completed_at: datetime | None = delivery_optional_timestamp_field()
    failure_detail: str | None = failure_detail_field()
    failure_code: str | None = failure_code_field()
    failure_stage: str | None = failure_stage_field()
    failure_classification: str | None = failure_classification_field()
    failure_retryable: bool | None = failure_retryable_field()
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )

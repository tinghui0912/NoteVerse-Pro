"""Account-owned durable erasure intent; completed evidence survives User removal."""

from datetime import datetime
from enum import StrEnum
from uuid import uuid4
from sqlalchemy import (
    BigInteger,
    Column,
    Integer,
    String,
    DateTime,
    ForeignKey,
    Index,
    Enum as SAEnum,
)
from sqlmodel import SQLModel, Field
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


class AccountDeletionStatus(StrEnum):
    PENDING = "PENDING"
    DISPATCHED = "DISPATCHED"
    PROCESSING = "PROCESSING"
    FAILED = "FAILED"
    COMPLETED = "COMPLETED"


class AccountDeletionPhase(StrEnum):
    SCORES = "SCORES"
    IMPORTS = "IMPORTS"
    TAKES = "TAKES"
    UPLOADS = "UPLOADS"
    FINALIZE = "FINALIZE"


class AccountDeletionOperation(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "account_deletion_operations"
    __table_args__ = (
        durable_failure_facts_constraint(name="ck_account_deletion_failure_facts"),
        delivery_attempt_count_constraint(name="ck_account_deletion_attempts"),
        delivery_attempt_token_constraint(
            name="ck_account_deletion_attempt_token",
            processing_status=AccountDeletionStatus.PROCESSING,
        ),
        Index("ix_account_deletion_due", "status", "next_attempt_at"),
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
    user_id: int | None = Field(
        default=None,
        sa_column=Column(
            BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, unique=True
        ),
    )
    user_id_snapshot: int = Field(sa_column=Column(BigInteger, nullable=False, unique=True))
    status: AccountDeletionStatus = Field(
        default=AccountDeletionStatus.PENDING,
        sa_column=Column(
            SAEnum(
                AccountDeletionStatus,
                native_enum=False,
                create_constraint=True,
                name="ck_account_deletion_status",
                length=24,
            ),
            nullable=False,
        ),
    )
    phase: AccountDeletionPhase = Field(
        default=AccountDeletionPhase.SCORES,
        sa_column=Column(
            SAEnum(
                AccountDeletionPhase,
                native_enum=False,
                create_constraint=True,
                name="ck_account_deletion_phase",
                length=16,
            ),
            nullable=False,
        ),
    )
    attempt_count: int = delivery_attempt_count_field()
    attempt_token: str | None = delivery_attempt_token_field()
    next_attempt_at: datetime = delivery_next_attempt_at_field()
    dispatched_at: datetime | None = delivery_optional_timestamp_field()
    started_at: datetime | None = delivery_optional_timestamp_field()
    completed_at: datetime | None = delivery_optional_timestamp_field()
    failure_code: str | None = failure_code_field()
    failure_stage: str | None = failure_stage_field()
    failure_classification: str | None = failure_classification_field()
    failure_retryable: bool | None = failure_retryable_field()
    failure_detail: str | None = failure_detail_field()
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )

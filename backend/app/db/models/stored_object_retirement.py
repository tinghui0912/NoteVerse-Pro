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
)
from app.shared.time import utc_now


class StoredObjectRetirement(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "stored_object_retirements"
    __table_args__ = (
        delivery_attempt_token_constraint(
            name="ck_stored_object_retirements_attempt_token", processing_status="PROCESSING"
        ),
        UniqueConstraint("stored_object_id", name="uq_object_retirement_object"),
        CheckConstraint(
            "status IN ('PENDING','DISPATCHED','PROCESSING','FAILED','COMPLETED','CANCELLED')",
            name="ck_object_retirement_status",
        ),
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
    status: str = Field(
        default="PENDING", sa_column=Column(String(24), nullable=False, default="PENDING")
    )
    attempt_count: int = delivery_attempt_count_field()
    attempt_token: str | None = delivery_attempt_token_field()
    next_attempt_at: datetime = delivery_next_attempt_at_field()
    dispatched_at: datetime | None = delivery_optional_timestamp_field()
    started_at: datetime | None = delivery_optional_timestamp_field()
    completed_at: datetime | None = delivery_optional_timestamp_field()
    failure_detail: str | None = failure_detail_field()
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, default=utc_now),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, default=utc_now),
    )

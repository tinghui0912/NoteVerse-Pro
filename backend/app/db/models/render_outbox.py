from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

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


class RenderOutboxStatus(str, enum.Enum):
    PENDING = "PENDING"
    DISPATCHED = "DISPATCHED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    SUPERSEDED = "SUPERSEDED"


class RenderTargetType(str, enum.Enum):
    SCORE_REVISION = "SCORE_REVISION"
    REVIEW_THUMBNAIL = "REVIEW_THUMBNAIL"


class RenderOutbox(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "render_outbox"
    __table_args__ = (
        durable_failure_facts_constraint(name="ck_render_outbox_failure_facts"),
        delivery_attempt_token_constraint(
            name="ck_render_outbox_attempt_token", processing_status="PROCESSING"
        ),
        delivery_attempt_count_constraint(name="ck_render_outbox_attempt_count"),
        CheckConstraint(
            "(target_type = 'SCORE_REVISION' AND score_id IS NOT NULL AND revision_id IS NOT NULL AND import_job_id IS NULL) OR "
            "(target_type = 'REVIEW_THUMBNAIL' AND score_id IS NULL AND revision_id IS NULL AND import_job_id IS NOT NULL)",
            name="ck_render_outbox_target",
        ),
        UniqueConstraint(
            "revision_id",
            "render_profile",
            name="uq_render_outbox_revision_profile",
        ),
        UniqueConstraint(
            "import_job_id",
            "render_profile",
            "source_fingerprint",
            name="uq_render_outbox_review_source",
        ),
        Index("idx_render_outbox_status_available", "status", "next_attempt_at"),
        Index("idx_render_outbox_dispatched", "status", "dispatched_at"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    outbox_uuid: str = Field(sa_column=Column(String(36), unique=True, nullable=False))
    target_type: RenderTargetType = Field(
        sa_column=Column(
            SAEnum(RenderTargetType, name="rendertargettype"),
            nullable=False,
        )
    )
    score_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            BigInteger,
            ForeignKey("scores.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    revision_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            BigInteger,
            ForeignKey("score_revisions.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    import_job_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            BigInteger,
            ForeignKey("import_jobs.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    source_fingerprint: str = Field(sa_column=Column(String(64), nullable=False))
    requested_by_user_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL")),
    )
    originating_request_id: Optional[str] = Field(
        default=None,
        sa_column=Column(String(64), index=True),
    )
    traceparent: Optional[str] = Field(default=None, sa_column=Column(String(55)))
    tracestate: Optional[str] = Field(default=None, sa_column=Column(String(512)))
    render_profile: str = Field(
        default="default",
        sa_column=Column(String(128), default="default", nullable=False),
    )
    status: RenderOutboxStatus = Field(
        default=RenderOutboxStatus.PENDING,
        sa_column=Column(
            SAEnum(RenderOutboxStatus, name="renderoutboxstatus"),
            default=RenderOutboxStatus.PENDING,
            nullable=False,
        ),
    )
    attempt_token: str | None = delivery_attempt_token_field()
    attempt_count: int = delivery_attempt_count_field()
    next_attempt_at: datetime = delivery_next_attempt_at_field()
    dispatched_at: Optional[datetime] = delivery_optional_timestamp_field()
    started_at: Optional[datetime] = delivery_optional_timestamp_field()
    completed_at: Optional[datetime] = delivery_optional_timestamp_field()
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

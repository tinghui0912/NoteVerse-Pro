from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive


bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class RenderOutboxStatus(str, enum.Enum):
    PENDING = "PENDING"
    DISPATCHED = "DISPATCHED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class RenderTargetType(str, enum.Enum):
    SCORE_REVISION = "SCORE_REVISION"
    REVIEW_THUMBNAIL = "REVIEW_THUMBNAIL"


class RenderOutbox(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "render_outbox"
    __table_args__ = (
        CheckConstraint("attempt_count >= 0", name="ck_render_outbox_attempt_count"),
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
        )
    )
    revision_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            BigInteger,
            ForeignKey("score_revisions.id", ondelete="CASCADE"),
            nullable=True,
        )
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
    attempt_count: int = Field(
        default=0,
        sa_column=Column(Integer, default=0, nullable=False),
    )
    next_attempt_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    dispatched_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    started_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    completed_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    last_error: Optional[str] = Field(default=None, sa_column=Column(Text))
    internal_error_code: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    internal_error_stage: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    internal_error_class: Optional[str] = Field(default=None, sa_column=Column(String(32)))
    internal_error_retryable: Optional[bool] = Field(default=None, sa_column=Column(Boolean))
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

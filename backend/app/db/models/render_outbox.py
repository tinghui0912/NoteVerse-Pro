from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
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


class RevisionRenderOutbox(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "revision_render_outbox"
    __table_args__ = (
        CheckConstraint("attempt_count >= 0", name="ck_render_outbox_attempt_count"),
        UniqueConstraint(
            "revision_id",
            "render_profile",
            name="uq_render_outbox_revision_profile",
        ),
        Index("idx_render_outbox_status_available", "status", "next_attempt_at"),
        Index("idx_render_outbox_dispatched", "status", "dispatched_at"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    outbox_uuid: str = Field(sa_column=Column(String(36), unique=True, nullable=False))
    score_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("scores.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    revision_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("score_revisions.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    requested_by_user_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL")),
    )
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

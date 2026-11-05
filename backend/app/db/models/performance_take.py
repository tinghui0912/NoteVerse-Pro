from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Column,
    CheckConstraint,
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


class PerformanceTakeMediaKind(str, enum.Enum):
    AUDIO = "AUDIO"
    VIDEO = "VIDEO"


class PerformanceTakeDeletionStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    DELETING = "DELETING"


class PerformanceTake(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "performance_takes"
    __table_args__ = (
        CheckConstraint(
            "ticks_per_quarter > 0 AND ticks_per_quarter <= 9007199254740991 "
            "AND scope_start_tick >= 0 AND scope_start_tick <= 9007199254740991 "
            "AND scope_terminal_tick > 0 AND scope_terminal_tick <= 9007199254740991 "
            "AND scope_terminal_tick >= scope_start_tick",
            name="ck_performance_takes_score_coordinates",
        ),
        CheckConstraint(
            "deletion_status IN ('ACTIVE','DELETING')", name="ck_performance_takes_deletion_status"
        ),
        CheckConstraint("scope_type IN ('FULL','RANGE')", name="ck_performance_takes_scope_type"),
        CheckConstraint("media_kind IN ('AUDIO','VIDEO')", name="ck_performance_takes_media_kind"),
        UniqueConstraint("upload_reservation_id", name="uq_performance_takes_upload_reservation"),
        Index("ix_performance_takes_user_created", "user_id", "created_at"),
        Index("ix_performance_takes_user_deletion_status", "user_id", "deletion_status"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    take_uuid: str = Field(sa_column=Column(String(36), unique=True, index=True, nullable=False))
    user_id: int = Field(
        sa_column=Column(
            bigint_pk_type,
            ForeignKey("users.id", ondelete="CASCADE"),
            index=True,
            nullable=False,
        )
    )
    source_id: str = Field(sa_column=Column(String(128), nullable=False))
    source_score_uuid: str = Field(sa_column=Column(String(36), nullable=False))
    source_revision_uuid: str = Field(sa_column=Column(String(36), nullable=False))
    source_artifact_id: str = Field(sa_column=Column(String(128), nullable=False))
    linked_score_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            bigint_pk_type,
            ForeignKey("scores.id", ondelete="SET NULL"),
            index=True,
            nullable=True,
        ),
    )
    score_title_snapshot: str = Field(
        sa_column=Column(String(255), nullable=False),
    )
    upload_reservation_id: int = Field(
        sa_column=Column(
            bigint_pk_type,
            ForeignKey("performance_take_upload_reservations.id", ondelete="RESTRICT"),
            nullable=False,
        )
    )
    media_kind: PerformanceTakeMediaKind = Field(
        sa_column=Column(
            SAEnum(PerformanceTakeMediaKind, name="performancetakemediakind"),
            nullable=False,
        ),
    )
    media_mime_type: str = Field(sa_column=Column(String(64), nullable=False))
    media_byte_size: int = Field(sa_column=Column(BigInteger, nullable=False))
    media_object_key: str = Field(
        sa_column=Column(String(768), unique=True, index=True, nullable=False)
    )
    storage_backend: str = Field(sa_column=Column(String(32), nullable=False))
    duration_ms: int = Field(sa_column=Column(Integer, nullable=False))
    scope_type: str = Field(
        sa_column=Column(String(16), nullable=False),
    )
    ticks_per_quarter: int = Field(sa_column=Column(BigInteger, nullable=False))
    scope_start_tick: int = Field(sa_column=Column(BigInteger, nullable=False))
    scope_terminal_tick: int = Field(sa_column=Column(BigInteger, nullable=False))
    scope_start_group_id: Optional[str] = Field(
        default=None,
        sa_column=Column(String(128), nullable=True),
    )
    scope_end_group_id: Optional[str] = Field(
        default=None,
        sa_column=Column(String(128), nullable=True),
    )
    tempo_plan: str = Field(
        sa_column=Column(Text, nullable=False),
    )
    recording_timebase: str = Field(
        sa_column=Column(Text, nullable=False),
    )
    deletion_status: str = Field(
        default=PerformanceTakeDeletionStatus.ACTIVE.value,
        sa_column=Column(
            String(16),
            nullable=False,
            default=PerformanceTakeDeletionStatus.ACTIVE.value,
        ),
    )
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

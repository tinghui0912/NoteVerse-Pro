from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlmodel import Field, Relationship, SQLModel

from app.utils.timezone import utc_now_naive

if TYPE_CHECKING:
    from .user import User
    from .score import Score, ScoreRevision

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class PerformanceTakeMediaKind(str, enum.Enum):
    AUDIO = "AUDIO"


class PerformanceTakeDeletionStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    DELETING = "DELETING"


class PerformanceTake(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "performance_takes"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "client_request_id",
            name="uq_performance_takes_user_client_request_id",
        ),
        Index("ix_performance_takes_user_created", "user_id", "created_at"),
        Index("ix_performance_takes_user_deletion_status", "user_id", "deletion_status"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    take_uuid: str = Field(
        sa_column=Column(String(36), unique=True, index=True, nullable=False)
    )
    user_id: int = Field(
        sa_column=Column(
            bigint_pk_type,
            ForeignKey("users.id", ondelete="CASCADE"),
            index=True,
            nullable=False,
        )
    )
    score_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            bigint_pk_type,
            ForeignKey("scores.id", ondelete="SET NULL"),
            index=True,
            nullable=True,
        ),
    )
    score_title: Optional[str] = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )
    revision_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            bigint_pk_type,
            ForeignKey("score_revisions.id", ondelete="SET NULL"),
            index=True,
            nullable=True,
        ),
    )
    artifact_id: Optional[str] = Field(
        default=None,
        sa_column=Column(String(128), nullable=True),
    )
    client_request_id: str = Field(
        sa_column=Column(String(128), index=True, nullable=False)
    )
    media_kind: PerformanceTakeMediaKind = Field(
        default=PerformanceTakeMediaKind.AUDIO,
        sa_column=Column(
            SAEnum(PerformanceTakeMediaKind, name="performancetakemediakind"),
            nullable=False,
            default=PerformanceTakeMediaKind.AUDIO,
        ),
    )
    media_mime_type: str = Field(
        sa_column=Column(String(64), nullable=False)
    )
    media_byte_size: int = Field(
        sa_column=Column(BigInteger, nullable=False)
    )
    media_object_key: str = Field(
        sa_column=Column(String(768), unique=True, index=True, nullable=False)
    )
    storage_backend: str = Field(
        sa_column=Column(String(32), nullable=False)
    )
    duration_ms: int = Field(
        sa_column=Column(Integer, nullable=False)
    )
    scope_type: str = Field(
        default="FULL",
        sa_column=Column(String(16), nullable=False, default="FULL"),
    )
    scope_start_beat: float = Field(
        sa_column=Column(Float, nullable=False)
    )
    scope_terminal_beat: float = Field(
        sa_column=Column(Float, nullable=False)
    )
    tempo_selection: Optional[str] = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    resolved_tempo_plan: Optional[str] = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    sync_metadata: Optional[str] = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    deletion_status: PerformanceTakeDeletionStatus = Field(
        default=PerformanceTakeDeletionStatus.ACTIVE,
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

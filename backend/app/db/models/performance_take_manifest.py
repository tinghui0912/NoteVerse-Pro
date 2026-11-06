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


class PerformanceTakeManifest(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "performance_take_manifests"
    __table_args__ = (
        UniqueConstraint("id", "user_id", name="uq_take_manifest_id_owner"),
        CheckConstraint(
            "ticks_per_quarter > 0 AND ticks_per_quarter <= 9007199254740991 AND scope_start_tick >= 0 AND scope_start_tick <= 9007199254740991 AND scope_terminal_tick > 0 AND scope_terminal_tick <= 9007199254740991 AND scope_terminal_tick >= scope_start_tick",
            name="ck_take_manifest_score_coordinates",
        ),
        CheckConstraint("scope_type IN ('FULL','RANGE')", name="ck_take_manifest_scope_type"),
        CheckConstraint("media_kind IN ('AUDIO','VIDEO')", name="ck_take_manifest_media_kind"),
        CheckConstraint("media_byte_size > 0", name="ck_take_manifest_media_size"),
        Index("ix_take_manifest_user_created", "user_id", "created_at"),
    )
    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    user_id: int = Field(
        sa_column=Column(
            bigint_pk_type,
            ForeignKey("users.id", ondelete="CASCADE"),
            index=True,
            nullable=False,
        )
    )
    take_uuid: str = Field(sa_column=Column(String(36), unique=True, index=True, nullable=False))
    practice_bundle_id: str = Field(sa_column=Column(String(128), nullable=False))
    practice_score_uuid: str = Field(sa_column=Column(String(36), nullable=False))
    practice_revision_uuid: str = Field(sa_column=Column(String(36), nullable=False))
    practice_artifact_id: str = Field(sa_column=Column(String(128), nullable=False))
    score_title_snapshot: str = Field(
        sa_column=Column(String(255), nullable=False),
    )
    media_kind: PerformanceTakeMediaKind = Field(
        sa_column=Column(
            SAEnum(PerformanceTakeMediaKind, name="performancetakemediakind"),
            nullable=False,
        ),
    )
    media_mime_type: str = Field(sa_column=Column(String(64), nullable=False))
    media_byte_size: int = Field(sa_column=Column(BigInteger, nullable=False))
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
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )

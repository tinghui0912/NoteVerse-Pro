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


class PlaybackAssetKind(str, enum.Enum):
    AUDIO = "AUDIO"


class PlaybackOutboxStatus(str, enum.Enum):
    PENDING = "PENDING"
    DISPATCHED = "DISPATCHED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ScorePlaybackAsset(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_playback_assets"
    __table_args__ = (
        UniqueConstraint("storage_key", name="uq_score_playback_assets_storage_key"),
        UniqueConstraint(
            "revision_id",
            "kind",
            name="uq_score_playback_assets_revision_kind",
        ),
        Index("idx_score_playback_assets_revision_kind", "revision_id", "kind"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    asset_uuid: str = Field(sa_column=Column(String(36), unique=True, nullable=False))
    revision_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("score_revisions.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    kind: PlaybackAssetKind = Field(
        sa_column=Column(SAEnum(PlaybackAssetKind, name="playbackassetkind"), nullable=False)
    )
    storage_backend: str = Field(sa_column=Column(String(32), nullable=False))
    storage_key: str = Field(sa_column=Column(String(768), nullable=False))
    filename: str = Field(sa_column=Column(String(255), nullable=False))
    mime_type: str = Field(sa_column=Column(String(128), nullable=False))
    size_bytes: int = Field(sa_column=Column(BigInteger, nullable=False))
    sha256: str = Field(sa_column=Column(String(64), nullable=False))
    duration_ms: Optional[int] = Field(default=None, sa_column=Column(BigInteger))
    source_fingerprint: str = Field(sa_column=Column(String(64), nullable=False))
    generator: str = Field(sa_column=Column(String(64), nullable=False))
    generator_version: str = Field(sa_column=Column(String(64), nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )


class PlaybackOutbox(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "playback_outbox"
    __table_args__ = (
        CheckConstraint("attempt_count >= 0", name="ck_playback_outbox_attempt_count"),
        UniqueConstraint(
            "revision_id",
            "asset_kind",
            name="uq_playback_outbox_revision_kind",
        ),
        Index("idx_playback_outbox_status_available", "status", "next_attempt_at"),
        Index("idx_playback_outbox_dispatched", "status", "dispatched_at"),
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
    source_fingerprint: str = Field(sa_column=Column(String(64), nullable=False))
    asset_kind: PlaybackAssetKind = Field(
        default=PlaybackAssetKind.AUDIO,
        sa_column=Column(
            SAEnum(PlaybackAssetKind, name="playbackassetkind"),
            default=PlaybackAssetKind.AUDIO,
            nullable=False,
        ),
    )
    status: PlaybackOutboxStatus = Field(
        default=PlaybackOutboxStatus.PENDING,
        sa_column=Column(
            SAEnum(PlaybackOutboxStatus, name="playbackoutboxstatus"),
            default=PlaybackOutboxStatus.PENDING,
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

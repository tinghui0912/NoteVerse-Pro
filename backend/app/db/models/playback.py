from __future__ import annotations

import app.modules.playback.domain as playback_states

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
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
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship, SQLModel

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

from .stored_object import StoredObject

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class ScorePlaybackAsset(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_playback_assets"
    __table_args__ = (
        UniqueConstraint("stored_object_id", name="uq_score_playback_assets_stored_object"),
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
    kind: playback_states.PlaybackAssetKind = Field(
        sa_column=Column(
            SAEnum(playback_states.PlaybackAssetKind, name="playbackassetkind"),
            nullable=False,
        )
    )

    stored_object_id: int = Field(
        sa_column=Column(
            bigint_pk_type, ForeignKey("stored_objects.id", ondelete="RESTRICT"), nullable=False
        )
    )
    stored_object: StoredObject = Relationship(
        sa_relationship=relationship(StoredObject, lazy="selectin")
    )
    filename: str = Field(sa_column=Column(String(255), nullable=False))
    execution_manifest_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            BigInteger,
            ForeignKey("execution_manifests.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )
    duration_ms: Optional[int] = Field(default=None, sa_column=Column(BigInteger))
    source_fingerprint: str = Field(sa_column=Column(String(64), nullable=False))
    generator: str = Field(sa_column=Column(String(64), nullable=False))
    generator_version: str = Field(sa_column=Column(String(64), nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), default=utc_now, nullable=False),
    )


class PlaybackOutbox(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "playback_outbox"
    __table_args__ = (
        durable_failure_facts_constraint(name="ck_playback_outbox_failure_facts"),
        delivery_attempt_token_constraint(
            name="ck_playback_outbox_attempt_token",
            processing_status=playback_states.PlaybackOutboxStatus.PROCESSING,
        ),
        delivery_attempt_count_constraint(name="ck_playback_outbox_attempt_count"),
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
    originating_request_id: Optional[str] = Field(
        default=None,
        sa_column=Column(String(64), index=True),
    )
    traceparent: Optional[str] = Field(default=None, sa_column=Column(String(55)))
    tracestate: Optional[str] = Field(default=None, sa_column=Column(String(512)))
    source_fingerprint: str = Field(sa_column=Column(String(64), nullable=False))
    asset_kind: playback_states.PlaybackAssetKind = Field(
        default=playback_states.PlaybackAssetKind.AUDIO,
        sa_column=Column(
            SAEnum(playback_states.PlaybackAssetKind, name="playbackassetkind"),
            default=playback_states.PlaybackAssetKind.AUDIO,
            nullable=False,
        ),
    )
    status: playback_states.PlaybackOutboxStatus = Field(
        default=playback_states.PlaybackOutboxStatus.PENDING,
        sa_column=Column(
            SAEnum(playback_states.PlaybackOutboxStatus, name="playbackoutboxstatus"),
            default=playback_states.PlaybackOutboxStatus.PENDING,
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

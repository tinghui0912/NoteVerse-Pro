from __future__ import annotations

import uuid
from datetime import datetime
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel
from app.shared.time import utc_now
from app.modules.realtime.generated.transport import RealtimeChangeKind


class RealtimeChange(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "realtime_changes"
    __table_args__ = (
        UniqueConstraint(
            "recipient_user_id", "sequence", name="uq_realtime_changes_recipient_sequence"
        ),
        Index("idx_realtime_changes_created", "created_at"),
        CheckConstraint(
            """
          (kind = 'notifications.changed' AND score_id IS NULL AND revision_id IS NULL AND import_job_id IS NULL)
          OR (kind IN ('score.revisions.changed', 'score.derived_assets.changed', 'score.metadata.changed')
              AND score_id IS NOT NULL AND revision_id IS NOT NULL AND notification_id IS NULL AND import_job_id IS NULL)
          OR (kind = 'import_jobs.changed' AND import_job_id IS NOT NULL
              AND notification_id IS NULL AND score_id IS NULL AND revision_id IS NULL)
        """,
            name="ck_realtime_changes_identity",
        ),
    )
    id: int | None = Field(
        default=None,
        sa_column=Column(
            BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
        ),
    )
    sequence: int = Field(sa_column=Column(BigInteger, nullable=False))
    change_uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
    recipient_user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    )
    kind: RealtimeChangeKind = Field(
        sa_column=Column(
            Enum(
                RealtimeChangeKind,
                values_callable=lambda cls: [kind.value for kind in cls],
                native_enum=False,
                create_constraint=True,
                name="realtimechangekind",
            ),
            nullable=False,
        )
    )
    notification_id: str | None = Field(default=None, sa_column=Column(String(36)))
    score_id: str | None = Field(default=None, sa_column=Column(String(36)))
    revision_id: str | None = Field(default=None, sa_column=Column(String(36)))
    import_job_id: str | None = Field(default=None, sa_column=Column(String(36)))
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), default=utc_now, nullable=False),
    )


class RealtimeStreamState(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "realtime_stream_state"
    __table_args__ = (
        CheckConstraint("high_watermark_sequence >= 0", name="ck_realtime_stream_high_watermark"),
        CheckConstraint("replay_floor_sequence >= 0", name="ck_realtime_stream_floor"),
        CheckConstraint(
            "replay_floor_sequence <= high_watermark_sequence",
            name="ck_realtime_stream_replay_range",
        ),
    )
    recipient_user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    )
    high_watermark_sequence: int = Field(default=0, sa_column=Column(BigInteger, nullable=False))
    replay_floor_sequence: int = Field(default=0, sa_column=Column(BigInteger, nullable=False))
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )

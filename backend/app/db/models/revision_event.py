from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Index, Integer, String
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class ScoreRevisionEvent(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_revision_events"
    __table_args__ = (
        Index("idx_score_revision_events_score_created", "score_id", "created_at"),
        Index("idx_score_revision_events_revision", "revision_id"),
        Index("idx_score_revision_events_target_revision", "target_revision_id"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    event_uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
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
    target_revision_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            BigInteger,
            ForeignKey("score_revisions.id", ondelete="SET NULL"),
        ),
    )
    actor_user_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL")),
    )
    type: str = Field(sa_column=Column(String(40), nullable=False))
    note: Optional[str] = Field(default=None, sa_column=Column(String(500)))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )

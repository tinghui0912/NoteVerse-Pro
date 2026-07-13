from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class ScoreRevisionNote(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_revision_notes"
    __table_args__ = (
        UniqueConstraint("revision_id", name="uq_score_revision_notes_revision"),
        Index("idx_score_revision_notes_score_updated", "score_id", "updated_at"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
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
    author_user_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL")),
    )
    note: str = Field(sa_column=Column(String(500), nullable=False))
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

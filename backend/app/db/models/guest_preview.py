"""Active hash-only bearer authority for a Score's anonymous presentation."""

from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, Column, DateTime, ForeignKey, Integer, String
from sqlmodel import Field, SQLModel

from app.shared.time import utc_now


class GuestPreviewCredential(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "guest_preview_credentials"
    __table_args__ = (
        CheckConstraint("length(token_hash) = 64", name="ck_guest_preview_credentials_hash_length"),
    )

    id: int | None = Field(
        default=None,
        sa_column=Column(
            BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
        ),
    )
    score_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("scores.id", ondelete="CASCADE"), nullable=False, unique=True
        )
    )
    token_hash: str = Field(sa_column=Column(String(64), nullable=False, unique=True))
    issued_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, default=utc_now),
    )

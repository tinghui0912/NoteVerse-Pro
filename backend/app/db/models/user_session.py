"""Authoritative Consumer session ledger; raw credentials are never persisted."""

from datetime import datetime
from uuid import UUID, uuid4
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    String,
    Uuid,
)
from sqlmodel import Field, SQLModel
from app.modules.auth.session_states import SessionRevocationReason
from app.shared.time import utc_now


class UserSession(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "user_sessions"
    __table_args__ = (
        Index("idx_user_sessions_user_created", "user_id", "created_at"),
        Index("idx_user_sessions_expiration", "idle_expires_at", "absolute_expires_at"),
        CheckConstraint(
            "length(token_hash)=64 AND token_hash ~ '^[0-9a-f]+$'", name="ck_user_sessions_digest"
        ),
        CheckConstraint(
            "created_at <= last_seen_at AND last_seen_at < absolute_expires_at AND idle_expires_at <= absolute_expires_at",
            name="ck_user_sessions_lifetime",
        ),
        CheckConstraint(
            "(revoked_at IS NULL AND revoked_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_reason IS NOT NULL)",
            name="ck_user_sessions_revocation",
        ),
    )
    id: UUID = Field(default_factory=uuid4, sa_column=Column(Uuid, primary_key=True))
    user_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    token_hash: str = Field(sa_column=Column(String(64), nullable=False, unique=True, index=True))
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    last_seen_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    idle_expires_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    absolute_expires_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    revoked_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    revoked_reason: SessionRevocationReason | None = Field(
        default=None,
        sa_column=Column(SAEnum(SessionRevocationReason, name="sessionrevocationreason")),
    )
    ip_address: str | None = Field(default=None, sa_column=Column(String(64)))
    user_agent: str | None = Field(default=None, sa_column=Column(String(512)))

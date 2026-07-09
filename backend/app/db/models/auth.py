from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Index, Integer, String
from sqlmodel import Field, Relationship, SQLModel

from app.utils.timezone import utc_now_naive

if TYPE_CHECKING:
    from .user import User


class RefreshToken(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "refresh_tokens"
    __table_args__ = (
        Index("idx_refresh_tokens_user_created", "user_id", "created_at"),
        Index("idx_refresh_tokens_expires", "expires_at"),
        Index("idx_refresh_tokens_revoked", "revoked_at"),
    )

    id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    )
    token_hash: str = Field(sa_column=Column(String(64), unique=True, nullable=False))
    device_id: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    user_agent: Optional[str] = Field(default=None, sa_column=Column(String(512), nullable=True))
    ip_address: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    expires_at: datetime = Field(sa_column=Column(DateTime, nullable=False))
    revoked_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, nullable=True))
    replaced_by_token_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("refresh_tokens.id"), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    last_used_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, nullable=True))

    user: "User" = Relationship(back_populates="refresh_tokens")


class AuthToken(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "auth_tokens"
    __table_args__ = (
        Index("idx_auth_tokens_user_purpose", "user_id", "purpose"),
        Index("idx_auth_tokens_expires", "expires_at"),
        Index("idx_auth_tokens_used", "used_at"),
    )

    id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    )
    purpose: str = Field(sa_column=Column(String(64), nullable=False))
    token_hash: str = Field(sa_column=Column(String(64), unique=True, nullable=False))
    user_agent: Optional[str] = Field(default=None, sa_column=Column(String(512), nullable=True))
    ip_address: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    expires_at: datetime = Field(sa_column=Column(DateTime, nullable=False))
    used_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, nullable=True))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )


class PendingRegistration(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "pending_registrations"
    __table_args__ = (
        Index("idx_pending_registrations_email", "email", unique=True),
        Index("idx_pending_registrations_token_hash", "token_hash", unique=True),
        Index("idx_pending_registrations_expires", "expires_at"),
        Index("idx_pending_registrations_consumed", "consumed_at"),
    )

    id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    email: str = Field(sa_column=Column(String(255), nullable=False))
    display_name: str = Field(sa_column=Column(String(128), nullable=False))
    password_hash: str = Field(sa_column=Column(String(255), nullable=False))
    token_hash: str = Field(sa_column=Column(String(64), nullable=False))
    resend_count: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
    attempt_count: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
    user_agent: Optional[str] = Field(default=None, sa_column=Column(String(512), nullable=True))
    ip_address: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    expires_at: datetime = Field(sa_column=Column(DateTime, nullable=False))
    consumed_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, nullable=True))
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


class EmailChangeRequest(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "email_change_requests"
    __table_args__ = (
        Index("idx_email_change_requests_user_created", "user_id", "created_at"),
        Index("idx_email_change_requests_new_email", "new_email"),
        Index("idx_email_change_requests_token_hash", "token_hash", unique=True),
        Index("idx_email_change_requests_expires", "expires_at"),
        Index("idx_email_change_requests_consumed", "consumed_at"),
    )

    id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    )
    new_email: str = Field(sa_column=Column(String(255), nullable=False))
    token_hash: str = Field(sa_column=Column(String(64), nullable=False))
    locale: str = Field(default="zh", sa_column=Column(String(8), default="zh", nullable=False))
    user_agent: Optional[str] = Field(default=None, sa_column=Column(String(512), nullable=True))
    ip_address: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    expires_at: datetime = Field(sa_column=Column(DateTime, nullable=False))
    consumed_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime, nullable=True))
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

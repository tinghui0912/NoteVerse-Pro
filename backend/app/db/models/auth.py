from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Index, String
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

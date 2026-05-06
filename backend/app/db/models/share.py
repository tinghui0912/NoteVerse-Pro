from datetime import datetime
from typing import Optional, List, TYPE_CHECKING

from sqlalchemy import Column, String, Boolean, DateTime, BigInteger, ForeignKey, Index, UniqueConstraint
from sqlmodel import SQLModel, Field, Relationship

from app.utils.timezone import utc_now_naive

if TYPE_CHECKING:
    from .task import Task
    from .user import User


class Share(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "shares"
    __table_args__ = (
        Index("idx_shares_owner_created", "owner_user_id", "created_at"),
        Index("idx_shares_task", "task_id"),
    )

    id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    task_id: int = Field(sa_column=Column(BigInteger, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False))
    owner_user_id: int = Field(sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=False))
    token: str = Field(sa_column=Column(String(64), unique=True, nullable=False))

    can_download: bool = Field(default=False, sa_column=Column(Boolean, default=False, nullable=False))
    can_edit: bool = Field(default=False, sa_column=Column(Boolean, default=False, nullable=False))
    expires_at: Optional[datetime] = Field(sa_column=Column(DateTime))
    revoked_at: Optional[datetime] = Field(sa_column=Column(DateTime))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )

    task: "Task" = Relationship(back_populates="shares")
    owner: "User" = Relationship(back_populates="shares")
    saved_shares: List["SavedShare"] = Relationship(back_populates="share")


class SavedShare(SQLModel, table=True):  # type: ignore[call-arg]
    """
    Record of a user saving a shared task link.

    Note:
        `task_id` was removed from this table. Resolve the related task
        through `share.task_id`.
    """

    __tablename__ = "saved_shares"
    __table_args__ = (
        UniqueConstraint("user_id", "share_id", name="uq_savedshare_user_share"),
        Index("idx_savedshare_user_created", "user_id", "created_at"),
    )

    id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    user_id: int = Field(sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=False))
    share_id: int = Field(sa_column=Column(BigInteger, ForeignKey("shares.id", ondelete="CASCADE"), nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )

    user: "User" = Relationship(back_populates="saved_shares")
    share: "Share" = Relationship(back_populates="saved_shares")

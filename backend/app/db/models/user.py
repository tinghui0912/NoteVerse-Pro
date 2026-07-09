from datetime import datetime
from typing import Optional, List, TYPE_CHECKING
from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, String, Boolean, DateTime, BigInteger, Enum as SAEnum
import enum

from app.utils.timezone import utc_now_naive

if TYPE_CHECKING:
    from .auth import RefreshToken
    from .file import Upload
    from .practice import PracticeSession

class UserRole(str, enum.Enum):
    user = "user"
    admin = "admin"

class User(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "users"

    id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    display_name: Optional[str] = Field(sa_column=Column(String(128), unique=True))
    email: str = Field(sa_column=Column(String(255), unique=True, nullable=False))
    password_hash: str = Field(sa_column=Column(String(255), nullable=False))
    role: UserRole = Field(
        default=UserRole.user,
        sa_column=Column(
            SAEnum(UserRole, name="userrole"),
            default=UserRole.user,
            nullable=False,
        ),
    )
    is_active: bool = Field(default=True, sa_column=Column(Boolean, default=True, nullable=False))
    email_verified_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    last_login: Optional[datetime] = Field(sa_column=Column(DateTime))
    password_changed_at: Optional[datetime] = Field(sa_column=Column(DateTime))
    avatar_url: Optional[str] = Field(sa_column=Column(String(512)))
    created_at: datetime = Field(default_factory=utc_now_naive, sa_column=Column(DateTime, default=utc_now_naive, nullable=False))
    updated_at: datetime = Field(default_factory=utc_now_naive, sa_column=Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive, nullable=False))

    uploads: List["Upload"] = Relationship(back_populates="uploader")
    practice_sessions: List["PracticeSession"] = Relationship(back_populates="user")
    refresh_tokens: List["RefreshToken"] = Relationship(back_populates="user")

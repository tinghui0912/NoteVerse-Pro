from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, String
from sqlmodel import Field, Relationship, SQLModel

from app.utils.timezone import utc_now_naive

if TYPE_CHECKING:
    from .user import User


class Upload(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "uploads"

    id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    sha256: str = Field(sa_column=Column(String(64), unique=True, nullable=False))
    storage_backend: str = Field(sa_column=Column(String(32), nullable=False))
    storage_key: str = Field(sa_column=Column(String(768), unique=True, nullable=False))
    filename: str = Field(sa_column=Column(String(255), nullable=False))
    original_filename: Optional[str] = Field(default=None, sa_column=Column(String(255)))
    size_bytes: Optional[int] = Field(default=None, sa_column=Column(BigInteger))
    mime_type: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    uploader_user_id: Optional[int] = Field(
        default=None, sa_column=Column(BigInteger, ForeignKey("users.id"))
    )
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive, nullable=False),
    )

    uploader: Optional["User"] = Relationship(back_populates="uploads")

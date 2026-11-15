import uuid
from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlmodel import Field, Relationship, SQLModel
from sqlalchemy.orm import relationship
from .stored_object import StoredObject

from app.shared.time import utc_now

if TYPE_CHECKING:
    from .user import User

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class Upload(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "uploads"
    __table_args__ = (
        UniqueConstraint("upload_uuid", name="uq_uploads_upload_uuid"),
        Index("idx_uploads_user_created", "uploader_user_id", "created_at"),
        Index("idx_uploads_stored_object", "stored_object_id"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    upload_uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String(36), nullable=False),
    )
    stored_object_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("stored_objects.id", ondelete="RESTRICT"),
            nullable=False,
        )
    )
    stored_object: StoredObject = Relationship(
        sa_relationship=relationship(StoredObject, lazy="selectin")
    )
    original_filename: str = Field(sa_column=Column(String(255), nullable=False))
    uploader_user_id: Optional[int] = Field(
        default=None, sa_column=Column(BigInteger, ForeignKey("users.id"))
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), default=utc_now, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
        ),
    )

    uploader: Optional["User"] = Relationship(back_populates="uploads")

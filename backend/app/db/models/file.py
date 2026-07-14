import uuid
from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlmodel import Field, Relationship, SQLModel

from app.utils.timezone import utc_now_naive

if TYPE_CHECKING:
    from .user import User

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class StorageBlob(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "storage_blobs"
    __table_args__ = (
        UniqueConstraint("sha256", name="uq_storage_blobs_sha256"),
        UniqueConstraint("storage_key", name="uq_storage_blobs_storage_key"),
        Index("idx_storage_blobs_sha256", "sha256"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    blob_uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
    sha256: str = Field(sa_column=Column(String(64), nullable=False))
    storage_backend: str = Field(sa_column=Column(String(32), nullable=False))
    storage_key: str = Field(sa_column=Column(String(768), nullable=False))
    filename: str = Field(sa_column=Column(String(255), nullable=False))
    size_bytes: int = Field(sa_column=Column(BigInteger, nullable=False))
    mime_type: str = Field(sa_column=Column(String(128), nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )


class Upload(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "uploads"
    __table_args__ = (
        UniqueConstraint("upload_uuid", name="uq_uploads_upload_uuid"),
        Index("idx_uploads_user_created", "uploader_user_id", "created_at"),
        Index("idx_uploads_blob", "blob_id"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    upload_uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String(36), nullable=False),
    )
    blob_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("storage_blobs.id", ondelete="RESTRICT"),
            nullable=False,
        )
    )
    original_filename: Optional[str] = Field(default=None, sa_column=Column(String(255)))
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

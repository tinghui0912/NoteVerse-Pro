"""Physical authority for one private, immutable durable media object."""

from datetime import datetime
from typing import Optional
from sqlalchemy import (
    BigInteger,
    Column,
    CheckConstraint,
    DateTime,
    Integer,
    String,
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel
from app.utils.timezone import utc_now_naive

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class MediaBlob(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "media_blobs"
    __table_args__ = (
        UniqueConstraint("object_key", name="uq_media_blob_locator"),
        CheckConstraint("byte_size > 0", name="ck_media_blob_positive_size"),
        CheckConstraint(
            "length(trim(object_key)) > 0 AND length(trim(content_type)) > 0",
            name="ck_media_blob_locator_type",
        ),
        CheckConstraint(
            "length(sha256) = 64 AND replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(sha256, '0', ''), '1', ''), '2', ''), '3', ''), '4', ''), '5', ''), '6', ''), '7', ''), '8', ''), '9', ''), 'a', ''), 'b', ''), 'c', ''), 'd', ''), 'e', ''), 'f', '') = ''",
            name="ck_media_blob_digest",
        ),
    )
    id: Optional[int] = Field(
        default=None, sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True)
    )

    object_key: str = Field(sa_column=Column(String(768), nullable=False))
    byte_size: int = Field(sa_column=Column(BigInteger, nullable=False))
    sha256: str = Field(sa_column=Column(String(64), nullable=False))
    content_type: str = Field(sa_column=Column(String(64), nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )

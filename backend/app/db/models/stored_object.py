"""Physical authority for one private, immutable durable object."""

from datetime import datetime
from typing import Optional
from sqlalchemy import (
    BigInteger,
    Column,
    CheckConstraint,
    DateTime,
    Integer,
    Index,
    String,
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel
from app.shared.time import utc_now

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class StoredObject(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "stored_objects"
    __table_args__ = (
        UniqueConstraint("object_key", name="uq_stored_object_locator"),
        Index("ix_stored_objects_sha256", "sha256"),
        CheckConstraint("byte_size >= 0", name="ck_stored_object_nonnegative_size"),
        CheckConstraint(
            "length(trim(object_key)) > 0 AND length(trim(content_type)) > 0",
            name="ck_stored_object_locator_type",
        ),
        CheckConstraint(
            "length(sha256) = 64 AND replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(sha256, '0', ''), '1', ''), '2', ''), '3', ''), '4', ''), '5', ''), '6', ''), '7', ''), '8', ''), '9', ''), 'a', ''), 'b', ''), 'c', ''), 'd', ''), 'e', ''), 'f', '') = ''",
            name="ck_stored_object_digest",
        ),
    )
    id: Optional[int] = Field(
        default=None, sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True)
    )

    object_key: str = Field(sa_column=Column(String(768), nullable=False))
    byte_size: int = Field(sa_column=Column(BigInteger, nullable=False))
    sha256: str = Field(sa_column=Column(String(64), nullable=False))
    content_type: str = Field(sa_column=Column(String(255), nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), default=utc_now, nullable=False),
    )

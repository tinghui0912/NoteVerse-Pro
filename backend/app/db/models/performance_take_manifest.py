from __future__ import annotations

from datetime import datetime
from typing import Optional
from sqlalchemy import (
    BigInteger,
    Column,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel
from app.utils.timezone import utc_now_naive

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class PerformanceTakeManifest(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "performance_take_manifests"
    __table_args__ = (
        UniqueConstraint("id", "user_id", name="uq_take_manifest_id_owner"),
        CheckConstraint("length(manifest_sha256) = 64", name="ck_take_manifest_digest_length"),
        Index("ix_take_manifest_user_created", "user_id", "created_at"),
    )
    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    user_id: int = Field(
        sa_column=Column(
            bigint_pk_type,
            ForeignKey("users.id", ondelete="CASCADE"),
            index=True,
            nullable=False,
        )
    )
    take_uuid: str = Field(sa_column=Column(String(36), unique=True, index=True, nullable=False))
    manifest_json: str = Field(sa_column=Column(Text, nullable=False))
    manifest_sha256: str = Field(sa_column=Column(String(64), nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )

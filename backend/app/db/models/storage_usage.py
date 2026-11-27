from __future__ import annotations

import app.modules.storage_governance.usage.domain as usage_types

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel

from app.shared.time import utc_now


bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class StorageUsageAccount(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "storage_usage_accounts"
    __table_args__ = (
        CheckConstraint("used_bytes >= 0", name="ck_storage_usage_accounts_used_non_negative"),
    )

    user_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        )
    )
    used_bytes: int = Field(default=0, sa_column=Column(BigInteger, default=0, nullable=False))
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


class StorageUsageCounter(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "storage_usage_counters"
    __table_args__ = (
        UniqueConstraint("user_id", "category", name="uq_storage_usage_counters_user_category"),
        CheckConstraint("used_bytes >= 0", name="ck_storage_usage_counters_used_non_negative"),
        Index("idx_storage_usage_counters_user", "user_id"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    )
    category: usage_types.StorageUsageCategory = Field(
        sa_column=Column(
            SAEnum(usage_types.StorageUsageCategory, name="storageusagecategory"),
            nullable=False,
        )
    )
    used_bytes: int = Field(default=0, sa_column=Column(BigInteger, default=0, nullable=False))
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
        ),
    )


class StorageUsageEvent(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "storage_usage_events"
    __table_args__ = (
        Index("idx_storage_usage_events_user_created", "user_id", "created_at"),
        Index("idx_storage_usage_events_object", "object_type", "object_id"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    )
    category: usage_types.StorageUsageCategory = Field(
        sa_column=Column(
            SAEnum(usage_types.StorageUsageCategory, name="storageusagecategory"),
            nullable=False,
        )
    )
    delta_bytes: int = Field(sa_column=Column(BigInteger, nullable=False))
    counts_toward_quota_snapshot: bool = Field(sa_column=Column(Boolean, nullable=False))
    reason: str = Field(sa_column=Column(String(64), nullable=False))
    object_type: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    object_id: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    storage_key: Optional[str] = Field(default=None, sa_column=Column(String(768)))
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), default=utc_now, nullable=False),
    )

from __future__ import annotations

import enum
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

from app.utils.timezone import utc_now_naive


bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class StorageUsageCategory(str, enum.Enum):
    SOURCE = "SOURCE"
    UPLOAD = "UPLOAD"
    DERIVED_RENDER = "DERIVED_RENDER"
    DERIVED_AUDIO = "DERIVED_AUDIO"
    TEMP_IMPORT = "TEMP_IMPORT"


class StorageUsageReservationStatus(str, enum.Enum):
    RESERVED = "RESERVED"
    COMMITTED = "COMMITTED"
    RELEASED = "RELEASED"


class StorageQuotaPolicy(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "storage_quota_policies"

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    plan_code: str = Field(sa_column=Column(String(64), unique=True, nullable=False))
    quota_limit_bytes: int = Field(sa_column=Column(BigInteger, nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive, nullable=False),
    )


class StorageUsageAccount(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "storage_usage_accounts"
    __table_args__ = (
        CheckConstraint("used_bytes >= 0", name="ck_storage_usage_accounts_used_non_negative"),
        CheckConstraint("reserved_bytes >= 0", name="ck_storage_usage_accounts_reserved_non_negative"),
        CheckConstraint("quota_limit_bytes >= 0", name="ck_storage_usage_accounts_limit_non_negative"),
    )

    user_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        )
    )
    plan_code: str = Field(sa_column=Column(String(64), nullable=False))
    used_bytes: int = Field(default=0, sa_column=Column(BigInteger, default=0, nullable=False))
    reserved_bytes: int = Field(default=0, sa_column=Column(BigInteger, default=0, nullable=False))
    quota_limit_bytes: int = Field(sa_column=Column(BigInteger, nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive, nullable=False),
    )


class StorageUsageCounter(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "storage_usage_counters"
    __table_args__ = (
        UniqueConstraint("user_id", "category", name="uq_storage_usage_counters_user_category"),
        CheckConstraint("used_bytes >= 0", name="ck_storage_usage_counters_used_non_negative"),
        CheckConstraint("reserved_bytes >= 0", name="ck_storage_usage_counters_reserved_non_negative"),
        Index("idx_storage_usage_counters_user", "user_id"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    )
    category: StorageUsageCategory = Field(
        sa_column=Column(SAEnum(StorageUsageCategory, name="storageusagecategory"), nullable=False)
    )
    used_bytes: int = Field(default=0, sa_column=Column(BigInteger, default=0, nullable=False))
    reserved_bytes: int = Field(default=0, sa_column=Column(BigInteger, default=0, nullable=False))
    updated_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive, nullable=False),
    )


class StorageUsageReservation(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "storage_usage_reservations"
    __table_args__ = (
        CheckConstraint("bytes_reserved >= 0", name="ck_storage_usage_reservations_bytes_non_negative"),
        Index("idx_storage_usage_reservations_user_status", "user_id", "status"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    reservation_uuid: str = Field(sa_column=Column(String(36), unique=True, nullable=False))
    user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    )
    category: StorageUsageCategory = Field(
        sa_column=Column(SAEnum(StorageUsageCategory, name="storageusagecategory"), nullable=False)
    )
    bytes_reserved: int = Field(sa_column=Column(BigInteger, nullable=False))
    counts_toward_quota: bool = Field(sa_column=Column(Boolean, nullable=False))
    status: StorageUsageReservationStatus = Field(
        sa_column=Column(
            SAEnum(StorageUsageReservationStatus, name="storageusagereservationstatus"),
            nullable=False,
        )
    )
    reason: str = Field(sa_column=Column(String(64), nullable=False))
    object_type: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    object_id: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    storage_key: Optional[str] = Field(default=None, sa_column=Column(String(768)))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive, nullable=False),
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
    category: StorageUsageCategory = Field(
        sa_column=Column(SAEnum(StorageUsageCategory, name="storageusagecategory"), nullable=False)
    )
    delta_bytes: int = Field(sa_column=Column(BigInteger, nullable=False))
    counts_toward_quota: bool = Field(sa_column=Column(Boolean, nullable=False))
    reason: str = Field(sa_column=Column(String(64), nullable=False))
    object_type: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    object_id: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    storage_key: Optional[str] = Field(default=None, sa_column=Column(String(768)))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )

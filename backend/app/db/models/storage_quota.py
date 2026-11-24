"""Durable user capacity entitlement and hold facts."""

from datetime import datetime
from enum import Enum
from uuid import uuid4
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Enum as SAEnum,
)
from sqlmodel import Field, SQLModel
from app.db.models.storage_usage import StorageUsageCategory
from app.shared.time import utc_now


class StoragePlanCode(str, Enum):
    FREE = "FREE"
    PLUS = "PLUS"
    PRO = "PRO"


class StorageQuotaHoldStatus(str, Enum):
    HELD = "HELD"
    CONSUMED = "CONSUMED"
    RELEASED = "RELEASED"
    EXPIRED = "EXPIRED"


class StoragePlanPolicy(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "storage_plan_policies"
    __table_args__ = (
        CheckConstraint(
            "default_limit_bytes >= 0",
            name="ck_storage_plan_policies_limit_nonnegative",
        ),
    )
    plan_code: StoragePlanCode = Field(
        sa_column=Column(
            SAEnum(
                StoragePlanCode,
                native_enum=False,
                length=64,
                create_constraint=True,
                name="ck_storage_plan_policy_code",
            ),
            primary_key=True,
        )
    )
    default_limit_bytes: int = Field(sa_column=Column(BigInteger, nullable=False))
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


class UserStorageEntitlement(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "user_storage_entitlements"
    user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    )
    plan_code: StoragePlanCode = Field(
        sa_column=Column(
            SAEnum(StoragePlanCode, native_enum=False, length=64),
            ForeignKey("storage_plan_policies.plan_code"),
            nullable=False,
        )
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


class StorageQuotaHold(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "storage_quota_holds"
    __table_args__ = (
        UniqueConstraint("user_id", "command_key", name="uq_storage_quota_holds_user_command"),
        CheckConstraint("bytes_held > 0", name="ck_storage_quota_holds_positive_bytes"),
        CheckConstraint(
            "category IN ('SOURCE', 'UPLOAD', 'INPUT_ASSET')",
            name="ck_storage_quota_holds_category",
        ),
        CheckConstraint("expires_at > created_at", name="ck_storage_quota_holds_expiry"),
        CheckConstraint(
            "(status = 'HELD' AND consumed_at IS NULL AND released_at IS NULL AND expired_at IS NULL) OR (status = 'CONSUMED' AND consumed_at IS NOT NULL AND consumed_at < expires_at AND released_at IS NULL AND expired_at IS NULL) OR (status = 'RELEASED' AND released_at IS NOT NULL AND consumed_at IS NULL AND expired_at IS NULL) OR (status = 'EXPIRED' AND expired_at IS NOT NULL AND expired_at >= expires_at AND consumed_at IS NULL AND released_at IS NULL)",
            name="ck_storage_quota_holds_lifecycle",
        ),
        Index("idx_storage_quota_holds_user_status_expiry", "user_id", "status", "expires_at"),
        Index("idx_storage_quota_holds_status_expiry", "status", "expires_at", "id"),
    )
    id: int | None = Field(
        default=None,
        sa_column=Column(
            BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
        ),
    )
    hold_uuid: str = Field(
        default_factory=lambda: str(uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
    user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    )
    command_key: str = Field(sa_column=Column(String(160), nullable=False))
    category: StorageUsageCategory = Field(
        sa_column=Column(SAEnum(StorageUsageCategory, name="storageusagecategory"), nullable=False)
    )
    bytes_held: int = Field(sa_column=Column(BigInteger, nullable=False))
    status: StorageQuotaHoldStatus = Field(
        default=StorageQuotaHoldStatus.HELD,
        sa_column=Column(
            SAEnum(StorageQuotaHoldStatus, native_enum=False, length=16), nullable=False
        ),
    )
    expires_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
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
    consumed_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    released_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    expired_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))

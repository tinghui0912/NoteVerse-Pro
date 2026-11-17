from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import uuid4

from sqlalchemy import Enum as SAEnum
from sqlalchemy import (
    BigInteger,
    Column,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlmodel import Field, Relationship, SQLModel
from sqlalchemy.orm import relationship
from .performance_take_manifest import PerformanceTakeManifest

from app.shared.time import utc_now
from app.shared.performance_take_upload import UploadReservationStatus

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class PerformanceTakeUploadReservation(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "performance_take_upload_reservations"
    __table_args__ = (
        ForeignKeyConstraint(
            ["manifest_id", "user_id"],
            ["performance_take_manifests.id", "performance_take_manifests.user_id"],
            ondelete="CASCADE",
            name="fk_take_reservation_manifest_owner",
        ),
        CheckConstraint(
            f"(status = '{UploadReservationStatus.FINALIZING.value}' AND finalizing_token IS NOT NULL AND finalizing_object_key IS NOT NULL AND finalizing_expires_at IS NOT NULL) OR (status != '{UploadReservationStatus.FINALIZING.value}' AND finalizing_token IS NULL AND finalizing_object_key IS NULL AND finalizing_expires_at IS NULL)",
            name="ck_take_reservation_finalize_lease",
        ),
        UniqueConstraint(
            "user_id",
            "client_request_id",
            name="uq_take_upload_reservation_user_client_request_id",
        ),
        Index("ix_take_upload_reservation_status_expires", "status", "expires_at"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    reservation_uuid: str = Field(
        default_factory=lambda: str(uuid4()),
        sa_column=Column(String(36), unique=True, index=True, nullable=False),
    )
    user_id: int = Field(
        sa_column=Column(
            bigint_pk_type,
            ForeignKey("users.id", ondelete="CASCADE"),
            index=True,
            nullable=False,
        )
    )
    manifest_id: int = Field(sa_column=Column(bigint_pk_type, nullable=False, index=True))
    manifest: PerformanceTakeManifest = Relationship(
        sa_relationship=relationship(PerformanceTakeManifest, lazy="selectin")
    )
    client_request_id: str = Field(sa_column=Column(String(128), index=True, nullable=False))

    staging_object_key: str = Field(sa_column=Column(String(768), nullable=False))

    storage_reservation_id: str = Field(sa_column=Column(String(36), index=True, nullable=False))
    expires_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    last_put_url_expires_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    staging_cleanup_after: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    staging_cleanup_completed_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    finalizing_object_key: Optional[str] = Field(
        default=None,
        sa_column=Column(String(768), nullable=True),
    )
    orphan_final_object_keys: str = Field(
        default="[]",
        sa_column=Column(Text, nullable=False, default="[]"),
    )
    finalizing_token: Optional[str] = Field(
        default=None,
        sa_column=Column(String(36), nullable=True),
    )
    finalizing_expires_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    status: UploadReservationStatus = Field(
        default=UploadReservationStatus.RESERVED,
        sa_column=Column(
            SAEnum(
                UploadReservationStatus,
                native_enum=False,
                create_constraint=True,
                validate_strings=True,
                values_callable=lambda cls: [value.value for value in cls],
                name="ck_take_reservation_status",
                length=24,
            ),
            nullable=False,
            default=UploadReservationStatus.RESERVED,
        ),
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), default=utc_now, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            default=utc_now,
            onupdate=utc_now,
            nullable=False,
        ),
    )

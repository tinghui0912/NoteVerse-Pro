from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import uuid4

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
from app.modules.performance_takes.upload_reservation.domain import UploadReservationStatus

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class PerformanceTakeUploadReservation(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "performance_take_upload_reservations"
    __table_args__ = (
        CheckConstraint(
            "ticks_per_quarter > 0 AND ticks_per_quarter <= 9007199254740991 "
            "AND scope_start_tick >= 0 AND scope_start_tick <= 9007199254740991 "
            "AND scope_terminal_tick > 0 AND scope_terminal_tick <= 9007199254740991 "
            "AND scope_terminal_tick >= scope_start_tick",
            name="ck_take_reservation_score_coordinates",
        ),
        CheckConstraint(
            "status IN ('RESERVED','FINALIZING','COMPLETED','CANCELLED','EXPIRED')",
            name="ck_take_reservation_status",
        ),
        CheckConstraint(
            "(status = 'FINALIZING' AND finalizing_token IS NOT NULL AND finalizing_object_key IS NOT NULL AND finalizing_expires_at IS NOT NULL) OR (status != 'FINALIZING' AND finalizing_token IS NULL AND finalizing_object_key IS NULL AND finalizing_expires_at IS NULL)",
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
    source_id: str = Field(sa_column=Column(String(128), nullable=False))
    source_score_uuid: str = Field(sa_column=Column(String(36), nullable=False))
    source_revision_uuid: str = Field(sa_column=Column(String(36), nullable=False))
    source_artifact_id: str = Field(sa_column=Column(String(128), nullable=False))
    client_request_id: str = Field(sa_column=Column(String(128), index=True, nullable=False))
    take_uuid: str = Field(sa_column=Column(String(36), index=True, nullable=False))
    linked_score_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            bigint_pk_type,
            ForeignKey(
                "scores.id", ondelete="SET NULL", name="fk_take_upload_reservation_linked_score"
            ),
            index=True,
            nullable=True,
        ),
    )
    score_title_snapshot: str = Field(sa_column=Column(String(255), nullable=False))
    scope_type: str = Field(
        sa_column=Column(String(16), nullable=False),
    )
    ticks_per_quarter: int = Field(sa_column=Column(BigInteger, nullable=False))
    scope_start_tick: int = Field(sa_column=Column(BigInteger, nullable=False))
    scope_terminal_tick: int = Field(sa_column=Column(BigInteger, nullable=False))
    scope_start_group_id: Optional[str] = Field(
        default=None,
        sa_column=Column(String(128), nullable=True),
    )
    scope_end_group_id: Optional[str] = Field(
        default=None,
        sa_column=Column(String(128), nullable=True),
    )
    tempo_plan: str = Field(
        sa_column=Column(Text, nullable=False),
    )
    recording_timebase: str = Field(
        sa_column=Column(Text, nullable=False),
    )
    media_kind: str = Field(
        sa_column=Column(String(16), nullable=False),
    )
    media_mime_type: str = Field(sa_column=Column(String(64), nullable=False))
    media_byte_size: int = Field(sa_column=Column(BigInteger, nullable=False))
    storage_backend: str = Field(sa_column=Column(String(32), nullable=False))
    staging_object_key: str = Field(sa_column=Column(String(768), nullable=False))

    storage_reservation_id: str = Field(sa_column=Column(String(36), index=True, nullable=False))
    expires_at: datetime = Field(sa_column=Column(DateTime, nullable=False))
    last_put_url_expires_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime, nullable=True),
    )
    staging_cleanup_after: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime, nullable=True),
    )
    staging_cleanup_completed_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime, nullable=True),
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
        sa_column=Column(DateTime, nullable=True),
    )
    status: str = Field(
        default=UploadReservationStatus.RESERVED.value,
        sa_column=Column(
            String(24),
            nullable=False,
            default=UploadReservationStatus.RESERVED.value,
        ),
    )
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(
            DateTime,
            default=utc_now_naive,
            onupdate=utc_now_naive,
            nullable=False,
        ),
    )

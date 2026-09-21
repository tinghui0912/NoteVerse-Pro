from __future__ import annotations

from datetime import datetime
import enum
from typing import Optional
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Enum as SAEnum,
    Float,
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


class PerformanceTakeUploadAuthorizationStatus(str, enum.Enum):
    AUTHORIZED = "AUTHORIZED"
    FINALIZING = "FINALIZING"
    ARCHIVED = "ARCHIVED"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"


class PerformanceTakeUploadAuthorization(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "performance_take_upload_authorizations"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "client_request_id",
            name="uq_take_upload_auth_user_client_request_id",
        ),
        Index("ix_take_upload_auth_status_expires", "status", "expires_at"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    auth_uuid: str = Field(
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
    client_request_id: str = Field(
        sa_column=Column(String(128), index=True, nullable=False)
    )
    take_uuid: str = Field(
        sa_column=Column(String(36), index=True, nullable=False)
    )
    score_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            bigint_pk_type,
            ForeignKey("scores.id", ondelete="SET NULL"),
            index=True,
            nullable=True,
        ),
    )
    score_uuid: Optional[str] = Field(
        default=None,
        sa_column=Column(String(36), nullable=True),
    )
    score_title: Optional[str] = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )
    revision_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            bigint_pk_type,
            ForeignKey("score_revisions.id", ondelete="SET NULL"),
            index=True,
            nullable=True,
        ),
    )
    revision_uuid: Optional[str] = Field(
        default=None,
        sa_column=Column(String(36), nullable=True),
    )
    artifact_id: Optional[str] = Field(
        default=None,
        sa_column=Column(String(128), nullable=True),
    )
    scope_type: str = Field(
        default="FULL",
        sa_column=Column(String(16), nullable=False, default="FULL"),
    )
    scope_start_beat: float = Field(
        sa_column=Column(Float, nullable=False)
    )
    scope_terminal_beat: float = Field(
        sa_column=Column(Float, nullable=False)
    )
    tempo_selection: Optional[str] = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    resolved_tempo_plan: Optional[str] = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    sync_metadata: Optional[str] = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    duration_ms: int = Field(
        sa_column=Column(Integer, nullable=False)
    )
    media_kind: str = Field(
        default="AUDIO",
        sa_column=Column(String(16), nullable=False, default="AUDIO"),
    )
    media_mime_type: str = Field(
        sa_column=Column(String(64), nullable=False)
    )
    media_byte_size: int = Field(
        sa_column=Column(BigInteger, nullable=False)
    )
    storage_backend: str = Field(
        sa_column=Column(String(32), nullable=False)
    )
    staging_object_key: str = Field(
        sa_column=Column(String(768), nullable=False)
    )
    final_object_key: str = Field(
        sa_column=Column(String(768), nullable=False)
    )
    reservation_id: str = Field(
        sa_column=Column(String(36), index=True, nullable=False)
    )
    expires_at: datetime = Field(
        sa_column=Column(DateTime, nullable=False)
    )
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
    final_cleanup_completed_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime, nullable=True),
    )
    finalizing_token: Optional[str] = Field(
        default=None,
        sa_column=Column(String(36), nullable=True),
    )
    finalizing_expires_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime, nullable=True),
    )
    status: PerformanceTakeUploadAuthorizationStatus = Field(
        default=PerformanceTakeUploadAuthorizationStatus.AUTHORIZED,
        sa_column=Column(
            SAEnum(
                PerformanceTakeUploadAuthorizationStatus,
                name="performancetakeuploadauthorizationstatus",
                values_callable=lambda obj: [e.value for e in obj],
            ),
            nullable=False,
            default=PerformanceTakeUploadAuthorizationStatus.AUTHORIZED,
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

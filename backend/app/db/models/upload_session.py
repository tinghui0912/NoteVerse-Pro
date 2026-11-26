"""One user-bound physical upload generation and its durable cleanup responsibility."""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import (
    BigInteger,
    Integer,
    Column,
    String,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    CheckConstraint,
    Index,
    Enum as SAEnum,
)
from sqlmodel import SQLModel, Field
from app.shared.time import utc_now
from app.modules.media_storage.upload_sessions.domain import UploadPurpose, UploadMode, UploadStatus


class UploadSession(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "upload_sessions"
    __table_args__ = (
        UniqueConstraint("session_uuid", name="uq_upload_session_uuid"),
        UniqueConstraint("object_key", name="uq_upload_session_key"),
        UniqueConstraint("final_object_key", name="uq_upload_session_final_key"),
        CheckConstraint(
            "expected_byte_size > 0 AND generation > 0 AND part_bytes > 0",
            name="ck_upload_session_plan",
        ),
        CheckConstraint(
            "mode <> 'SINGLE_PUT' OR provider_upload_id IS NULL",
            name="ck_upload_session_handle_mode",
        ),
        CheckConstraint(
            "status <> 'CONSUMED' OR consumed_at IS NOT NULL", name="ck_upload_session_consumed"
        ),
        CheckConstraint(
            "(transport_checksum_algorithm IS NULL) = (transport_checksum IS NULL)",
            name="ck_upload_session_checksum",
        ),
        Index("ix_upload_session_user_status", "user_id", "status"),
        Index("ix_upload_session_expiry", "status", "expires_at"),
        Index("ix_upload_session_cleanup", "status", "cleanup_completed_at"),
    )
    id: int | None = Field(
        default=None,
        sa_column=Column(
            BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
        ),
    )
    session_uuid: str = Field(
        default_factory=lambda: str(uuid4()), sa_column=Column(String(36), nullable=False)
    )
    user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    )
    purpose: UploadPurpose = Field(
        sa_column=Column(
            SAEnum(
                UploadPurpose,
                native_enum=False,
                create_constraint=True,
                name="ck_upload_session_purpose",
            ),
            nullable=False,
        )
    )
    mode: UploadMode = Field(
        sa_column=Column(
            SAEnum(
                UploadMode, native_enum=False, create_constraint=True, name="ck_upload_session_mode"
            ),
            nullable=False,
        )
    )
    status: UploadStatus = Field(
        default=UploadStatus.CREATING,
        sa_column=Column(
            SAEnum(
                UploadStatus,
                native_enum=False,
                create_constraint=True,
                name="ck_upload_session_status",
            ),
            nullable=False,
        ),
    )
    generation: int = Field(default=1, sa_column=Column(Integer, nullable=False))
    object_key: str = Field(sa_column=Column(String(768), nullable=False))
    final_object_key: str = Field(sa_column=Column(String(768), nullable=False))
    expected_byte_size: int = Field(sa_column=Column(BigInteger, nullable=False))
    expected_content_type: str = Field(sa_column=Column(String(255), nullable=False))
    part_bytes: int = Field(sa_column=Column(Integer, nullable=False))
    provider_upload_id: str | None = Field(
        default=None, sa_column=Column(String(1024), nullable=True)
    )
    provider_etag: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    transport_checksum_algorithm: str | None = Field(
        default=None, sa_column=Column(String(32), nullable=True)
    )
    transport_checksum: str | None = Field(
        default=None, sa_column=Column(String(255), nullable=True)
    )
    sha256: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    write_intent_uuid: str | None = Field(
        default=None,
        sa_column=Column(
            String(36),
            ForeignKey("object_write_intents.intent_uuid", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    operation_token: str | None = Field(default=None, sa_column=Column(String(36), nullable=True))
    operation_kind: str | None = Field(default=None, sa_column=Column(String(16), nullable=True))
    operation_unknown: bool = Field(default=False, nullable=False)
    failure_code: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    expires_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    capability_expires_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    completed_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    consumed_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    cleanup_completed_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )

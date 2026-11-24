"""Upload-owned retry lineage; capacity remains owned by the linked Quota hold."""

from datetime import datetime
from sqlalchemy import (
    BigInteger,
    Column,
    Integer,
    String,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    CheckConstraint,
)
from sqlmodel import SQLModel, Field
from app.shared.time import utc_now


class UploadCreationRequest(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "upload_creation_requests"
    __table_args__ = (
        UniqueConstraint("user_id", "client_request_id", name="uq_upload_creation_user_request"),
        CheckConstraint("generation > 0", name="ck_upload_creation_generation"),
        CheckConstraint(
            "upload_id IS NULL OR completed_at IS NOT NULL", name="ck_upload_creation_completion"
        ),
    )
    id: int | None = Field(
        default=None,
        sa_column=Column(
            BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
        ),
    )
    user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    )
    client_request_id: str = Field(sa_column=Column(String(128), nullable=False))
    request_fingerprint: str = Field(sa_column=Column(String(64), nullable=False))
    generation: int = Field(default=1, sa_column=Column(Integer, nullable=False))
    quota_hold_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("storage_quota_holds.id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,
        )
    )
    upload_id: int | None = Field(
        default=None,
        sa_column=Column(
            BigInteger, ForeignKey("uploads.id", ondelete="SET NULL"), nullable=True, unique=True
        ),
    )
    completed_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )

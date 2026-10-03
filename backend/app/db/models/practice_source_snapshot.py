from __future__ import annotations

from datetime import datetime
import enum
from typing import Optional
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class PracticeSourceSnapshotStatus(str, enum.Enum):
    CREATING = "CREATING"
    READY = "READY"
    DELETING = "DELETING"


class PracticeSourceSnapshot(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "practice_source_snapshots"
    __table_args__ = (
        UniqueConstraint("source_fingerprint", name="uq_practice_source_snapshots_fingerprint"),
        Index("ix_practice_source_snapshots_source_score_revision", "source_score_uuid", "source_revision_uuid"),
        Index("ix_practice_source_snapshots_status_creation", "status", "creation_expires_at"),
        CheckConstraint(
            "("
            "status = 'CREATING' AND creation_expires_at IS NOT NULL"
            ") OR ("
            "status IN ('READY', 'DELETING') AND creation_expires_at IS NULL"
            ")",
            name="ck_practice_source_snapshots_creation_lease",
        ),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    snapshot_uuid: str = Field(
        default_factory=lambda: str(uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
    source_fingerprint: str = Field(sa_column=Column(String(128), nullable=False))
    source_score_uuid: str = Field(sa_column=Column(String(36), nullable=False))
    source_revision_uuid: str = Field(sa_column=Column(String(36), nullable=False))
    artifact_id: str = Field(sa_column=Column(String(128), nullable=False))
    artifact_schema_version: int = Field(sa_column=Column(Integer, nullable=False))
    prepared_musicxml_object_key: str = Field(
        sa_column=Column(String(768), unique=True, nullable=False)
    )
    prepared_musicxml_sha256: str = Field(sa_column=Column(String(64), nullable=False))
    prepared_musicxml_byte_size: int = Field(sa_column=Column(BigInteger, nullable=False))
    artifact_object_key: str = Field(sa_column=Column(String(768), unique=True, nullable=False))
    artifact_sha256: str = Field(sa_column=Column(String(64), nullable=False))
    artifact_byte_size: int = Field(sa_column=Column(BigInteger, nullable=False))
    status: str = Field(
        default=PracticeSourceSnapshotStatus.CREATING.value,
        sa_column=Column(
            String(16),
            nullable=False,
            default=PracticeSourceSnapshotStatus.CREATING.value,
        ),
    )
    creation_expires_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )

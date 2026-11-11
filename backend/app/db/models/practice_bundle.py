from __future__ import annotations

from datetime import datetime
import enum
from typing import Optional

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
)
from sqlmodel import Field, Relationship, SQLModel
from sqlalchemy.orm import relationship
from .stored_object import StoredObject

from app.utils.timezone import utc_now_naive

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class PracticeBundleStatus(str, enum.Enum):
    CREATING = "CREATING"
    READY = "READY"


class PracticeBundleRecord(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "practice_bundles"
    __table_args__ = (
        UniqueConstraint("bundle_id", name="uq_practice_bundles_bundle_id"),
        UniqueConstraint("prepared_musicxml_object_id", name="uq_practice_bundles_musicxml_object"),
        UniqueConstraint("artifact_object_id", name="uq_practice_bundles_artifact_object"),
        CheckConstraint("status IN ('CREATING', 'READY')", name="ck_practice_bundles_status"),
        Index("ix_practice_bundles_status_creation", "status", "creation_expires_at"),
        CheckConstraint(
            "("
            "status = 'CREATING' AND creation_expires_at IS NOT NULL AND prepared_musicxml_object_id IS NULL AND artifact_object_id IS NULL"
            ") OR ("
            "status = 'READY' AND creation_expires_at IS NULL AND prepared_musicxml_object_id IS NOT NULL AND artifact_object_id IS NOT NULL"
            ")",
            name="ck_practice_bundles_creation_lease",
        ),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    bundle_id: str = Field(sa_column=Column(String(128), nullable=False))
    artifact_id: str = Field(sa_column=Column(String(128), nullable=False))
    artifact_schema_version: int = Field(sa_column=Column(Integer, nullable=False))
    prepared_musicxml_object_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            bigint_pk_type, ForeignKey("stored_objects.id", ondelete="RESTRICT"), nullable=True
        ),
    )
    prepared_musicxml_object: Optional[StoredObject] = Relationship(
        sa_relationship=relationship(
            StoredObject,
            foreign_keys="PracticeBundleRecord.prepared_musicxml_object_id",
            lazy="selectin",
        )
    )
    artifact_object_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            bigint_pk_type, ForeignKey("stored_objects.id", ondelete="RESTRICT"), nullable=True
        ),
    )
    artifact_object: Optional[StoredObject] = Relationship(
        sa_relationship=relationship(
            StoredObject, foreign_keys="PracticeBundleRecord.artifact_object_id", lazy="selectin"
        )
    )
    status: str = Field(sa_column=Column(String(16), nullable=False))
    creation_expires_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )


class ScoreRevisionPracticeBinding(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_revision_practice_bindings"

    revision_id: int = Field(
        sa_column=Column(
            bigint_pk_type, ForeignKey("score_revisions.id", ondelete="CASCADE"), primary_key=True
        )
    )
    bundle_id: int = Field(
        sa_column=Column(
            bigint_pk_type,
            ForeignKey("practice_bundles.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        )
    )
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )

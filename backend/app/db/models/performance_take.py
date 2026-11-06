from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Column,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlmodel import Field, Relationship, SQLModel
from sqlalchemy.orm import relationship
from .performance_take_manifest import PerformanceTakeManifest
from .stored_object import StoredObject

from app.utils.timezone import utc_now_naive

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class PerformanceTakeDeletionStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    DELETING = "DELETING"


class PerformanceTake(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "performance_takes"
    __table_args__ = (
        CheckConstraint(
            "deletion_status IN ('ACTIVE','DELETING')", name="ck_performance_takes_deletion_status"
        ),
        UniqueConstraint("manifest_id", name="uq_performance_takes_manifest"),
        UniqueConstraint("recording_object_id", name="uq_performance_takes_recording_object"),
    )
    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    manifest_id: int = Field(
        sa_column=Column(
            bigint_pk_type,
            ForeignKey("performance_take_manifests.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    manifest: PerformanceTakeManifest = Relationship(
        sa_relationship=relationship(PerformanceTakeManifest, lazy="selectin")
    )
    linked_score_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            bigint_pk_type,
            ForeignKey("scores.id", ondelete="SET NULL"),
            index=True,
            nullable=True,
        ),
    )
    recording_object_id: int = Field(
        sa_column=Column(
            bigint_pk_type, ForeignKey("stored_objects.id", ondelete="RESTRICT"), nullable=False
        )
    )
    recording_object: StoredObject = Relationship(
        sa_relationship=relationship(StoredObject, lazy="selectin")
    )
    deletion_status: str = Field(
        default=PerformanceTakeDeletionStatus.ACTIVE.value,
        sa_column=Column(
            String(16),
            nullable=False,
            default=PerformanceTakeDeletionStatus.ACTIVE.value,
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

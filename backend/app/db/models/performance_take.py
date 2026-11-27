from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Enum as SAEnum,
    Column,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    Index,
    UniqueConstraint,
)
from sqlmodel import Field, Relationship, SQLModel
from sqlalchemy.orm import relationship
from .performance_take_manifest import PerformanceTakeManifest
from .stored_object import StoredObject
from app.modules.performance_takes.processing_states import TakeMediaStatus

from app.shared.time import utc_now

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class PerformanceTake(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "performance_takes"
    __table_args__ = (
        ForeignKeyConstraint(
            ["manifest_id", "owner_user_id"],
            ["performance_take_manifests.id", "performance_take_manifests.user_id"],
            name="fk_performance_takes_manifest_owner",
            ondelete="CASCADE",
        ),
        Index("idx_performance_takes_owner_created", "owner_user_id", "created_at", "id"),
        Index(
            "idx_performance_takes_owner_score_created",
            "owner_user_id",
            "linked_score_id",
            "created_at",
            "id",
        ),
        UniqueConstraint("manifest_id", name="uq_performance_takes_manifest"),
        UniqueConstraint("recording_object_id", name="uq_performance_takes_recording_object"),
    )
    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    media_status: TakeMediaStatus = Field(
        default=TakeMediaStatus.UPLOADED,
        sa_column=Column(
            SAEnum(
                TakeMediaStatus,
                native_enum=False,
                create_constraint=True,
                name="ck_take_media_status",
            ),
            nullable=False,
        ),
    )
    manifest_id: int = Field(sa_column=Column(bigint_pk_type, nullable=False))
    owner_user_id: int = Field(sa_column=Column(bigint_pk_type, nullable=False))
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

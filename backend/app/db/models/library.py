from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel

from app.shared.time import utc_now

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class ScoreLibraryFolder(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_library_folders"
    __table_args__ = (
        CheckConstraint("position >= 0", name="ck_score_library_folders_position"),
        UniqueConstraint("user_id", "name", name="uq_score_library_folders_user_name"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    folder_uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
    user_id: int = Field(sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=False))
    name: str = Field(sa_column=Column(String(255), nullable=False))
    position: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
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


class ScoreLibraryOrganization(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_library_organizations"
    __table_args__ = (
        UniqueConstraint("user_id", "score_id", name="uq_score_library_organizations_user_score"),
        Index("idx_score_library_organizations_user_folder", "user_id", "folder_id"),
        Index("idx_score_library_organizations_user_favorite", "user_id", "is_favorite"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    user_id: int = Field(sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=False))
    score_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("scores.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    folder_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("score_library_folders.id", ondelete="SET NULL")),
    )
    is_favorite: bool = Field(
        default=False,
        sa_column=Column(Boolean, default=False, nullable=False),
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

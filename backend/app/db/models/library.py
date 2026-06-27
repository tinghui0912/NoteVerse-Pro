from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class LibraryEntrySourceType(str, enum.Enum):
    SELF_ADDED = "SELF_ADDED"
    BOOKMARK = "BOOKMARK"
    SHARED = "SHARED"
    OFFICIAL = "OFFICIAL"
    AI_RECOMMENDED = "AI_RECOMMENDED"


class LibraryPracticeState(str, enum.Enum):
    TO_PRACTICE = "TO_PRACTICE"
    IN_PROGRESS = "IN_PROGRESS"
    MASTERED = "MASTERED"


class ScoreLibraryFolder(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_library_folders"
    __table_args__ = (
        CheckConstraint("position >= 0", name="ck_score_library_folders_position"),
        UniqueConstraint("user_id", "id", name="uq_score_library_folders_user_id_id"),
        Index("idx_score_library_folders_user_parent", "user_id", "parent_folder_id"),
        Index(
            "uq_score_library_folders_active_name",
            "user_id",
            "parent_folder_id",
            "name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
            sqlite_where=text("deleted_at IS NULL"),
        ),
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
    parent_folder_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("score_library_folders.id")),
    )
    name: str = Field(sa_column=Column(String(255), nullable=False))
    position: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
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
    deleted_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))


class ScoreLibraryEntry(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_library_entries"
    __table_args__ = (
        Index("idx_score_library_entries_user_folder", "user_id", "folder_id"),
        Index("idx_score_library_entries_user_updated", "user_id", "updated_at"),
        Index("idx_score_library_entries_user_favorite", "user_id", "is_favorite"),
        Index("idx_score_library_entries_user_practice_state", "user_id", "practice_state"),
        Index("idx_score_library_entries_user_practiced", "user_id", "last_practiced_at"),
        Index(
            "uq_score_library_entries_active_source",
            "user_id",
            "score_id",
            "source_type",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
            sqlite_where=text("deleted_at IS NULL"),
        ),
        Index(
            "uq_score_library_entries_active_uuid",
            "entry_uuid",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
            sqlite_where=text("deleted_at IS NULL"),
        ),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    entry_uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String(36), nullable=False),
    )
    user_id: int = Field(sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=False))
    score_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("scores.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    source_type: LibraryEntrySourceType = Field(
        sa_column=Column(
            SAEnum(LibraryEntrySourceType, name="libraryentrysourcetype"),
            nullable=False,
        )
    )
    folder_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("score_library_folders.id")),
    )
    is_favorite: bool = Field(
        default=False,
        sa_column=Column(Boolean, default=False, nullable=False),
    )
    practice_state: LibraryPracticeState = Field(
        default=LibraryPracticeState.TO_PRACTICE,
        sa_column=Column(
            SAEnum(LibraryPracticeState, name="librarypracticestate"),
            default=LibraryPracticeState.TO_PRACTICE,
            nullable=False,
        ),
    )
    pinned_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    last_opened_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    last_practiced_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
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
    deleted_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))

"""Personal lightweight natural-completion facts, independent of results and recordings."""

from datetime import datetime
from enum import StrEnum
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel

from app.shared.time import utc_now


class PracticeActivityMode(StrEnum):
    STEP_BY_STEP = "STEP_BY_STEP"
    CONTINUOUS_PLAY = "CONTINUOUS_PLAY"


class PracticeActivityInputSource(StrEnum):
    MICROPHONE = "MICROPHONE"
    MIDI = "MIDI"


class PracticeActivityScopeKind(StrEnum):
    FULL = "FULL"
    RANGE = "RANGE"


class PracticeActivity(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "practice_activities"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "client_session_id", name="uq_practice_activities_user_session"
        ),
        CheckConstraint("scope_start_tick >= 0", name="ck_practice_activities_scope_start"),
        CheckConstraint(
            "scope_terminal_tick > scope_start_tick", name="ck_practice_activities_scope_terminal"
        ),
        Index("idx_practice_activities_user_completed", "user_id", "completed_at"),
        Index("idx_practice_activities_revision_completed", "revision_id", "completed_at"),
    )

    id: int | None = Field(
        default=None,
        sa_column=Column(
            BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
        ),
    )
    activity_uuid: str = Field(
        default_factory=lambda: str(uuid4()),
        sa_column=Column(String(36), nullable=False, unique=True),
    )
    user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    )
    revision_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("score_revisions.id", ondelete="CASCADE"), nullable=False
        )
    )
    client_session_id: str = Field(sa_column=Column(String(128), nullable=False))
    bundle_id: str = Field(sa_column=Column(String(128), nullable=False))
    mode: PracticeActivityMode = Field(
        sa_column=Column(
            SAEnum(
                PracticeActivityMode,
                values_callable=lambda cls: [value.value for value in cls],
                native_enum=False,
                create_constraint=True,
                validate_strings=True,
                name="ck_practice_activities_mode",
                length=32,
            ),
            nullable=False,
        )
    )
    input_source: PracticeActivityInputSource = Field(
        sa_column=Column(
            SAEnum(
                PracticeActivityInputSource,
                values_callable=lambda cls: [value.value for value in cls],
                native_enum=False,
                create_constraint=True,
                validate_strings=True,
                name="ck_practice_activities_input_source",
                length=16,
            ),
            nullable=False,
        )
    )
    scope_kind: PracticeActivityScopeKind = Field(
        sa_column=Column(
            SAEnum(
                PracticeActivityScopeKind,
                values_callable=lambda cls: [value.value for value in cls],
                native_enum=False,
                create_constraint=True,
                validate_strings=True,
                name="ck_practice_activities_scope_kind",
                length=16,
            ),
            nullable=False,
        )
    )
    scope_start_tick: int = Field(sa_column=Column(BigInteger, nullable=False))
    scope_terminal_tick: int = Field(sa_column=Column(BigInteger, nullable=False))
    completed_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, default=utc_now),
    )

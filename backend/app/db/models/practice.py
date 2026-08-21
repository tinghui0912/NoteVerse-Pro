import enum
from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import BigInteger, Column, DateTime, Enum as SAEnum, Float, ForeignKey, Index, String, Text
from sqlmodel import Field, Relationship, SQLModel

from app.db.models.score_access import AccessOrigin
from app.utils.timezone import utc_now_naive

if TYPE_CHECKING:
    from .user import User


class PracticeSessionState(str, enum.Enum):
    CREATED = "CREATED"
    STREAMING = "STREAMING"
    PAUSED = "PAUSED"
    FINISHED = "FINISHED"
    FAILED = "FAILED"


class PracticeReportStatus(str, enum.Enum):
    NOT_REQUESTED = "NOT_REQUESTED"
    PENDING = "PENDING"
    READY = "READY"
    FAILED = "FAILED"


class PracticeMode(str, enum.Enum):
    FREE_FOLLOW = "FREE_FOLLOW"
    WAIT_FOR_NOTE = "WAIT_FOR_NOTE"
    ASSESSMENT = "ASSESSMENT"
    PERFORMANCE = "PERFORMANCE"


class PracticeInputSource(str, enum.Enum):
    MICROPHONE = "MICROPHONE"
    MIDI = "MIDI"
    REPLAY_AUDIO = "REPLAY_AUDIO"


class PracticeSession(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "practice_sessions"
    __table_args__ = (
        Index("idx_practice_sessions_user_created", "user_id", "created_at"),
        Index("idx_practice_sessions_revision_created", "revision_id", "created_at"),
        Index("idx_practice_sessions_state", "state"),
    )

    id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    session_uuid: str = Field(sa_column=Column(String(36), unique=True, nullable=False))
    score_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("scores.id", ondelete="CASCADE"), nullable=False)
    )
    revision_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("score_revisions.id", ondelete="CASCADE"), nullable=False)
    )
    access_origin: AccessOrigin = Field(sa_column=Column(SAEnum(AccessOrigin, name="accessorigin"), nullable=False))
    share_grant_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("score_share_grants.id", ondelete="SET NULL")),
    )
    user_id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, ForeignKey("users.id")))
    state: PracticeSessionState = Field(sa_column=Column(SAEnum(PracticeSessionState, name="practicesessionstate"), nullable=False))
    practice_mode: PracticeMode = Field(
        default=PracticeMode.FREE_FOLLOW,
        sa_column=Column(
            SAEnum(PracticeMode, name="practicemode"),
            nullable=False,
            default=PracticeMode.FREE_FOLLOW,
        ),
    )
    input_source: PracticeInputSource = Field(
        default=PracticeInputSource.MICROPHONE,
        sa_column=Column(
            SAEnum(PracticeInputSource, name="practiceinputsource"),
            nullable=False,
            default=PracticeInputSource.MICROPHONE,
        ),
    )
    sample_rate: int = Field(sa_column=Column(BigInteger, nullable=False))
    channels: int = Field(sa_column=Column(BigInteger, nullable=False))
    frame_format: str = Field(sa_column=Column(String(32), nullable=False))
    started_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    finished_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    last_beat_position: Optional[float] = Field(default=None, sa_column=Column(Float))
    last_confidence: Optional[float] = Field(default=None, sa_column=Column(Float))
    audio_path: Optional[str] = Field(default=None, sa_column=Column(String(512)))
    report_status: PracticeReportStatus = Field(sa_column=Column(SAEnum(PracticeReportStatus, name="practicereportstatus"), nullable=False))
    report_payload: Optional[str] = Field(default=None, sa_column=Column(Text))
    error: Optional[str] = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(default_factory=utc_now_naive, sa_column=Column(DateTime, default=utc_now_naive, nullable=False))
    updated_at: datetime = Field(default_factory=utc_now_naive, sa_column=Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive, nullable=False))

    user: Optional["User"] = Relationship(back_populates="practice_sessions")

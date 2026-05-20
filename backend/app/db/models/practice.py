import enum
from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import BigInteger, Column, DateTime, Float, ForeignKey, Index, String, Text, Enum as SAEnum
from sqlmodel import SQLModel, Field, Relationship

from app.utils.timezone import utc_now_naive

if TYPE_CHECKING:
    from .task import Task
    from .user import User


class PracticeSourceType(str, enum.Enum):
    final = "final"
    current = "current"


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


class PracticeSession(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "practice_sessions"
    __table_args__ = (
        Index("idx_practice_sessions_user_created", "user_id", "created_at"),
        Index("idx_practice_sessions_task_created", "task_id", "created_at"),
        Index("idx_practice_sessions_state", "state"),
    )

    id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    session_uuid: str = Field(sa_column=Column(String(36), unique=True, nullable=False))
    task_id: int = Field(sa_column=Column(BigInteger, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False))
    user_id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=True))
    share_token: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    source_type: PracticeSourceType = Field(
        sa_column=Column(SAEnum(PracticeSourceType, name="practicesourcetype"), nullable=False)
    )
    state: PracticeSessionState = Field(
        sa_column=Column(SAEnum(PracticeSessionState, name="practicesessionstate"), nullable=False)
    )
    sample_rate: int = Field(sa_column=Column(BigInteger, nullable=False))
    channels: int = Field(sa_column=Column(BigInteger, nullable=False))
    frame_format: str = Field(sa_column=Column(String(32), nullable=False))
    started_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    finished_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    last_beat_position: Optional[float] = Field(default=None, sa_column=Column(Float))
    last_confidence: Optional[float] = Field(default=None, sa_column=Column(Float))
    audio_path: Optional[str] = Field(default=None, sa_column=Column(String(512)))
    report_status: PracticeReportStatus = Field(
        sa_column=Column(SAEnum(PracticeReportStatus, name="practicereportstatus"), nullable=False)
    )
    report_payload: Optional[str] = Field(default=None, sa_column=Column(Text))
    error: Optional[str] = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive, nullable=False),
    )

    task: "Task" = Relationship(back_populates="practice_sessions")
    user: Optional["User"] = Relationship(back_populates="practice_sessions")

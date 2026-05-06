import enum
from datetime import datetime
from typing import Optional, List, TYPE_CHECKING

from sqlalchemy import Column, String, Text, Integer, DateTime, BigInteger, ForeignKey, Index, UniqueConstraint, Enum as SAEnum
from sqlmodel import SQLModel, Field, Relationship

from app.utils.timezone import utc_now_naive

if TYPE_CHECKING:
    from .user import User
    from .file import File, TaskUpload
    from .share import Share
    from .practice import PracticeSession


class TaskState(str, enum.Enum):
    PENDING = "PENDING"
    PROGRESS = "PROGRESS"
    PENDING_REVIEW = "PENDING_REVIEW"  # Processing is complete and awaiting user review.
    SUCCESS = "SUCCESS"
    FAILURE = "FAILURE"


class TaskStepStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class Task(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "tasks"
    __table_args__ = (
        Index("idx_tasks_user_created", "user_id", "created_at"),
        Index("idx_tasks_state", "state"),
    )

    id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    task_uuid: str = Field(sa_column=Column(String(36), unique=True, nullable=False))
    user_id: int = Field(sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=False))

    state: TaskState = Field(
        sa_column=Column(SAEnum(TaskState, name="taskstate"), nullable=False)
    )
    title: Optional[str] = Field(sa_column=Column(String(255)))  # Music score title.
    difficulty: Optional[str] = Field(sa_column=Column(String(32)))  # Difficulty level.
    code: Optional[str] = Field(sa_column=Column(String(64)))
    error: Optional[str] = Field(sa_column=Column(Text))
    error_type: Optional[str] = Field(sa_column=Column(String(64)))
    progress: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
    current_step: Optional[str] = Field(sa_column=Column(String(64)))

    total_time_seconds: Optional[int] = Field(sa_column=Column(Integer))
    requested_at: Optional[datetime] = Field(sa_column=Column(DateTime))
    started_at: Optional[datetime] = Field(sa_column=Column(DateTime))
    finished_at: Optional[datetime] = Field(sa_column=Column(DateTime))

    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive, nullable=False),
    )

    user: "User" = Relationship(back_populates="tasks")
    steps: List["TaskStep"] = Relationship(back_populates="task", sa_relationship_kwargs={"cascade": "all, delete-orphan"})
    files: List["File"] = Relationship(back_populates="task", sa_relationship_kwargs={"cascade": "all, delete-orphan"})
    task_uploads: List["TaskUpload"] = Relationship(
        back_populates="task",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    shares: List["Share"] = Relationship(back_populates="task")
    practice_sessions: List["PracticeSession"] = Relationship(back_populates="task")


class TaskStep(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "task_steps"
    __table_args__ = (
        UniqueConstraint("task_id", "name", name="uq_task_step_name"),
        Index("idx_task_steps_task", "task_id"),
    )

    id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    task_id: int = Field(sa_column=Column(BigInteger, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False))

    name: str = Field(sa_column=Column(String(64), nullable=False))
    status: TaskStepStatus = Field(
        sa_column=Column(SAEnum(TaskStepStatus, name="taskstepstatus"), nullable=False)
    )
    start_time: Optional[datetime] = Field(sa_column=Column(DateTime))
    end_time: Optional[datetime] = Field(sa_column=Column(DateTime))
    step_order: Optional[int] = Field(sa_column=Column(Integer))

    task: "Task" = Relationship(back_populates="steps")

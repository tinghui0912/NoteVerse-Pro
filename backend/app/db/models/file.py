from datetime import datetime
from typing import Optional, List, TYPE_CHECKING
from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, String, Integer, DateTime, BigInteger, ForeignKey, Index, UniqueConstraint, Enum as SAEnum

from app.shared.file_kinds import FileKind
from app.utils.timezone import utc_now_naive

if TYPE_CHECKING:
    from .task import Task
    from .user import User


class File(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "files"
    __table_args__ = (
        UniqueConstraint('task_id', 'kind', 'page_number', name='uq_file_task_kind_page'),
        Index('idx_files_task_kind', 'task_id', 'kind'),
        Index('idx_files_created', 'created_at'),
    )

    id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    task_id: int = Field(sa_column=Column(BigInteger, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False))
    
    kind: FileKind = Field(sa_column=Column(
        SAEnum(FileKind, values_callable=lambda e: [m.value for m in e]),
        nullable=False
    ))
    storage_backend: str = Field(sa_column=Column(String(32), nullable=False))
    storage_key: str = Field(sa_column=Column(String(768), nullable=False))
    filename: str = Field(sa_column=Column(String(255), nullable=False))
    page_number: Optional[int] = Field(sa_column=Column(Integer))
    size_bytes: Optional[int] = Field(sa_column=Column(BigInteger))
    mime_type: Optional[str] = Field(sa_column=Column(String(64)))
    
    created_at: datetime = Field(default_factory=utc_now_naive, sa_column=Column(DateTime, default=utc_now_naive, nullable=False))

    task: "Task" = Relationship(back_populates="files")


class Upload(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "uploads"

    id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    sha256: str = Field(sa_column=Column(String(64), unique=True, nullable=False))
    storage_backend: str = Field(sa_column=Column(String(32), nullable=False))
    storage_key: str = Field(sa_column=Column(String(768), unique=True, nullable=False))
    filename: str = Field(sa_column=Column(String(255), nullable=False))
    original_filename: Optional[str] = Field(sa_column=Column(String(255)))
    size_bytes: Optional[int] = Field(sa_column=Column(BigInteger))
    mime_type: Optional[str] = Field(sa_column=Column(String(64)))
    uploader_user_id: Optional[int] = Field(sa_column=Column(BigInteger, ForeignKey("users.id")))
    
    created_at: datetime = Field(default_factory=utc_now_naive, sa_column=Column(DateTime, default=utc_now_naive, nullable=False))
    updated_at: datetime = Field(default_factory=utc_now_naive, sa_column=Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive, nullable=False))

    uploader: Optional["User"] = Relationship(back_populates="uploads")
    task_uploads: List["TaskUpload"] = Relationship(back_populates="upload")


class TaskUpload(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "task_uploads"
    __table_args__ = (
        UniqueConstraint('task_id', 'upload_id', name='uq_task_upload'),
        Index('idx_task_uploads_task', 'task_id'),
    )

    id: Optional[int] = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    task_id: int = Field(sa_column=Column(BigInteger, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False))
    upload_id: int = Field(sa_column=Column(BigInteger, ForeignKey("uploads.id"), nullable=False))

    task: "Task" = Relationship(back_populates="task_uploads")
    upload: "Upload" = Relationship(back_populates="task_uploads")

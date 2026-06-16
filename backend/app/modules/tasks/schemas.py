"""Canonical Pydantic schemas for the tasks module."""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Protocol

from typing_extensions import TypedDict

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db.models.task import TaskState


class TaskStatusUpdate(TypedDict, total=False):
    """Typed kwargs for synchronous task status updates."""

    current_step: Optional[str]
    error: Optional[str]
    error_type: Optional[str]
    code: Optional[str]
    options: Optional["TaskProcessingOptions"]
    started_at: Optional[datetime]
    result: Optional[dict[str, object]]
    finished_at: Optional[datetime]


class TaskProcessingOptions(TypedDict, total=False):
    """Supported processing options for batch task submission and pipeline execution."""

    title: str
    difficulty: str


class TaskFileReplaceItem(TypedDict):
    """Worker-side file payload used when replacing task file records."""

    storage_backend: str
    storage_key: str
    filename: str
    page_number: Optional[int]
    size: Optional[int]
    mime_type: Optional[str]


class BatchSubmitRequestLike(Protocol):
    file_ids: List[str]
    options: Optional[TaskProcessingOptions]
    idempotency_key: Optional[str]


class BatchArchiveRequestLike(Protocol):
    task_ids: List[str]
    include_types: List[str]


class TaskListItem(TypedDict):
    task_id: str
    state: TaskState | str
    progress: int
    current_step: Optional[str]
    title: Optional[str]
    difficulty: Optional[str]
    thumbnail_type: Optional[str]
    created_at: Optional[str]
    started_at: Optional[str]
    finished_at: Optional[str]
    error: Optional[str]
    code: Optional[str]


class TaskListResponse(TypedDict):
    tasks: List[TaskListItem]
    total: int


class TaskUpdateResult(TypedDict):
    title: Optional[str]
    difficulty: Optional[str]


class BatchDeleteResult(TypedDict):
    deleted_count: int
    skipped_running: int
    not_found: int


class BatchStatusEntry(TypedDict):
    state: TaskState | str
    progress: int
    error: Optional[str]


class BatchStatusResponse(TypedDict):
    tasks: dict[str, BatchStatusEntry]


class BatchSubmitResult(TypedDict):
    task_id: str
    count: int


class PipelineExecutionSuccessResult(TypedDict):
    success: bool
    task_id: str


class PipelineExecutionFailureResult(TypedDict):
    success: bool
    error: str


class TaskStatusFileItem(TypedDict):
    storage_key: str
    filename: str
    page_number: Optional[int]
    size: Optional[int]
    mime_type: Optional[str]


class TaskStatusStepItem(TypedDict):
    name: str
    status: str
    start_time: Optional[str]
    end_time: Optional[str]


class TaskStatusUploadItem(TypedDict):
    upload_id: Optional[int]
    sha256: str
    original_filename: Optional[str]


class TaskStatusResult(TypedDict, total=False):
    error: Optional[str]
    task_id: str
    state: TaskState | str
    progress: int
    current_step: Optional[str]
    title: Optional[str]
    difficulty: Optional[str]
    created_at: Optional[str]
    started_at: Optional[str]
    finished_at: Optional[str]
    error_message: Optional[str]
    code: Optional[str]
    steps: List[TaskStatusStepItem]
    files: dict[str, List[TaskStatusFileItem]]
    upload_ids: List[TaskStatusUploadItem]


class BatchSubmitRequest(BaseModel):
    file_ids: List[str] = Field(..., min_length=1, description="Uploaded file ID list")
    idempotency_key: Optional[str] = Field(
        default=None,
        min_length=8,
        max_length=128,
        description="Client-generated key used to make submission retries idempotent",
    )
    options: Optional[TaskProcessingOptions] = Field(
        default=None,
        description="Processing options",
    )

    @field_validator("idempotency_key")
    @classmethod
    def normalize_idempotency_key(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class TaskUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200, description="Task title")
    difficulty: Optional[str] = Field(default=None, max_length=50, description="Task difficulty")


class BatchDeleteTasksRequest(BaseModel):
    task_ids: List[str] = Field(..., min_length=1, description="Task UUID list to delete")


class BatchTaskStatusRequest(BaseModel):
    task_ids: List[str] = Field(..., min_length=1, description="Task UUID list to query")


class BatchArchiveRequest(BaseModel):
    task_ids: List[str] = Field(..., min_length=1, description="Task UUID list to archive")
    include_types: List[str] = Field(
        default_factory=lambda: ["image", "xml"],
        description="Included file types",
    )

    @field_validator("include_types")
    @classmethod
    def validate_include_types(cls, value: List[str]) -> List[str]:
        allowed = {"image", "xml"}
        normalized = [item.strip().lower() for item in value]
        invalid = sorted(set(normalized) - allowed)
        if invalid:
            raise ValueError(f"include_types must contain only: {', '.join(sorted(allowed))}")
        return normalized


class TaskBase(BaseModel):
    note: Optional[str] = None
    options: Optional[TaskProcessingOptions] = None


class TaskCreate(TaskBase):
    file_ids: Optional[List[str]] = None
    file_id: Optional[str] = None


class TaskUpdate(TaskBase):
    state: Optional[TaskState] = None


class TaskInDBBase(TaskBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_uuid: str
    user_id: int
    state: TaskState
    created_at: datetime
    updated_at: datetime


class Task(TaskInDBBase):
    pass


class TaskInDB(TaskInDBBase):
    pass


__all__ = [
    "BatchArchiveRequest",
    "BatchArchiveRequestLike",
    "BatchDeleteResult",
    "PipelineExecutionFailureResult",
    "PipelineExecutionSuccessResult",
    "BatchDeleteTasksRequest",
    "BatchStatusEntry",
    "BatchStatusResponse",
    "BatchSubmitRequestLike",
    "BatchSubmitResult",
    "BatchSubmitRequest",
    "BatchTaskStatusRequest",
    "TaskFileReplaceItem",
    "TaskListItem",
    "TaskListResponse",
    "TaskProcessingOptions",
    "TaskStatusFileItem",
    "TaskStatusResult",
    "TaskStatusStepItem",
    "Task",
    "TaskBase",
    "TaskCreate",
    "TaskInDB",
    "TaskInDBBase",
    "TaskStatusUpdate",
    "TaskUpdateResult",
    "TaskUpdate",
    "TaskUpdateRequest",
]

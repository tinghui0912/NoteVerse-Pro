"""Canonical Pydantic schemas for the files module."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict
from typing_extensions import TypedDict

from app.shared.file_kinds import FileKind


class FileBase(BaseModel):
    path: str
    kind: FileKind
    page: Optional[int] = None
    mime_type: Optional[str] = None


class FileCreate(FileBase):
    task_id: int
    size_bytes: Optional[int] = None


class File(FileBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int
    created_at: datetime


class UploadBase(BaseModel):
    sha256: str
    stored_filename: str
    original_filename: Optional[str] = None
    size_bytes: Optional[int] = None
    mime_type: Optional[str] = None


class UploadCreate(UploadBase):
    uploader_user_id: Optional[int] = None


class Upload(UploadBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class ExportTasksExcelRequest(BaseModel):
    task_ids: list[str]


class UploadFileResult(TypedDict):
    file_id: str
    filename: str
    stored_filename: str
    size: int


class TaskFileListItem(TypedDict):
    path: str
    page: Optional[int]
    size: Optional[int]
    mime_type: Optional[str]
    created_at: Optional[str]


class TaskFilesResult(TypedDict):
    task_id: str
    files: dict[str, list[TaskFileListItem]]


class DeleteUploadedFileResult(TypedDict):
    filename: str


__all__ = [
    "File",
    "FileBase",
    "FileCreate",
    "ExportTasksExcelRequest",
    "Upload",
    "UploadBase",
    "UploadCreate",
    "UploadFileResult",
    "TaskFileListItem",
    "TaskFilesResult",
    "DeleteUploadedFileResult",
]

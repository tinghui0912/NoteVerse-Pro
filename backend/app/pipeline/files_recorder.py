"""
Files recorder service for task outputs.

This module records task-related file paths into the database after worker-side
pipeline steps complete.
"""

import mimetypes
import os
from enum import Enum
from typing import List

from app.modules.tasks.schemas import TaskFileReplaceItem
from app.storage import file_storage


def _kind_value(kind: object) -> str:
    """Normalize FileKind enum values before using them in keys or DB writes."""

    if isinstance(kind, Enum):
        return str(kind.value)
    return str(kind)


def _guess_mime_type(path: str) -> str:
    """Guess the MIME type from the file extension."""
    ext = os.path.splitext(path)[1].lower()

    # Prefer explicit mappings first so MIME types stay stable across systems.
    custom_types = {
        ".xml": "application/xml",
        ".musicxml": "application/vnd.recordare.musicxml+xml",
        ".mxl": "application/vnd.recordare.musicxml",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
    }
    if ext in custom_types:
        return custom_types[ext]

    # Fall back to the system MIME type guess.
    mime_type, _ = mimetypes.guess_type(path)
    return mime_type or "application/octet-stream"


def replace_files(
    task_id: str,
    kind: object,
    abs_paths: List[str],
) -> None:
    """
    Write file records to the unified files table for a worker task.

    Args:
        task_id: Task UUID.
        kind: File kind, for example `original_image` or `final_xml`.
        abs_paths: Absolute file paths to record.

    Storage format:
        Files are uploaded to the configured storage adapter and recorded as
        object keys under `tasks/{task_id}/{kind}/`.
    """
    from app.db.worker_session import get_worker_db
    from app.modules.tasks.worker_service import sync_task_service

    normalized_kind = _kind_value(kind)
    items: List[TaskFileReplaceItem] = [
        _build_file_item(task_id, normalized_kind, p, i + 1)
        for i, p in enumerate(abs_paths)
    ]

    with get_worker_db() as db:
        sync_task_service.replace_files(db, task_id, normalized_kind, items)


def _build_file_item(
    task_id: str,
    kind: object,
    abs_path: str,
    page: int,
) -> TaskFileReplaceItem:
    normalized_kind = _kind_value(kind)
    mime_type = _guess_mime_type(abs_path)
    size = os.path.getsize(abs_path) if os.path.exists(abs_path) else None
    storage_key = _store_task_output(task_id, normalized_kind, abs_path, page, mime_type)

    return {
        "storage_backend": file_storage.backend_name,
        "storage_key": storage_key,
        "filename": os.path.basename(storage_key),
        "page_number": page,
        "mime_type": mime_type,
        "size": size,
    }


def _store_task_output(
    task_id: str,
    kind: str,
    abs_path: str,
    page: int,
    mime_type: str,
) -> str:
    filename = os.path.basename(abs_path)
    key = f"tasks/{task_id}/{kind}/{page:03d}-{filename}"

    with open(abs_path, "rb") as file_handle:
        stored = file_storage.put_bytes(
            key=key,
            content=file_handle.read(),
            content_type=mime_type,
        )

    return stored.storage_key

"""
Files recorder service for task outputs.

This module records task-related file paths into the database after worker-side
pipeline steps complete.
"""

import mimetypes
import os
from typing import List

from app.core.logger import logger
from app.modules.tasks.schemas import TaskFileReplaceItem
from app.utils.paths import to_rel_storage


def _guess_mime_type(path: str) -> str:
    """Guess the MIME type from the file extension."""
    ext = os.path.splitext(path)[1].lower()

    # Prefer explicit mappings first so MIME types stay stable across systems.
    custom_types = {
        ".xml": "application/xml",
        ".musicxml": "application/vnd.recordare.musicxml+xml",
        ".mxl": "application/vnd.recordare.musicxml",
        ".png": "image/png",
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
    kind: str,
    abs_paths: List[str],
    dpi: int | None = None,
) -> None:
    """
    Write file records to the unified files table for a worker task.

    Args:
        task_id: Task UUID.
        kind: File kind, for example `original_image` or `final_xml`.
        abs_paths: Absolute file paths to record.
        dpi: Optional DPI value for image files.

    Storage format:
        Paths are converted to storage-relative paths rooted at `uploads/`,
        `output/`, or `temp/`.
    """
    try:
        from app.db.worker_session import get_worker_db
        from app.modules.tasks.worker_service import sync_task_service

        items: List[TaskFileReplaceItem] = [
            {
                "path": to_rel_storage(p),
                "page": i + 1,
                "mime_type": _guess_mime_type(p),
                "size": os.path.getsize(p) if os.path.exists(p) else None,
                "dpi": dpi,
            }
            for i, p in enumerate(abs_paths)
        ]

        with get_worker_db() as db:
            sync_task_service.replace_files(db, task_id, kind, items)

    except Exception as e:
        logger.warning(f"[{task_id}] Failed to record files for kind={kind}: {e}")

"""
Files recorder service for import-job outputs.

This module records job-related file paths into the database after worker-side
pipeline steps complete.
"""

import hashlib
import mimetypes
import os
from enum import Enum
from typing import List

from app.modules.import_jobs.schemas import ImportJobArtifactItem
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
    job_id: str,
    kind: object,
    abs_paths: List[str],
) -> None:
    """
    Write file records to the unified files table for a worker task.

    Args:
        job_id: Job UUID.
        kind: Import artifact kind, for example `original_image`.
        abs_paths: Absolute file paths to record.

    Storage format:
        Files are uploaded to the configured storage adapter and recorded as
        object keys under `jobs/{job_id}/{kind}/`.
    """
    from app.db.worker_session import get_worker_db
    from app.modules.import_jobs.worker_service import sync_import_job_service

    normalized_kind = _kind_value(kind)
    items: List[ImportJobArtifactItem] = [
        _build_file_item(job_id, normalized_kind, p, i + 1)
        for i, p in enumerate(abs_paths)
    ]

    with get_worker_db() as db:
        sync_import_job_service.replace_artifacts(db, job_id, normalized_kind, items)


def _build_file_item(
    job_id: str,
    kind: object,
    abs_path: str,
    page: int,
) -> ImportJobArtifactItem:
    normalized_kind = _kind_value(kind)
    mime_type = _guess_mime_type(abs_path)
    size = os.path.getsize(abs_path) if os.path.exists(abs_path) else None
    storage_key = _store_job_output(job_id, normalized_kind, abs_path, page, mime_type)
    sha256 = None
    if os.path.exists(abs_path):
        with open(abs_path, "rb") as file_handle:
            sha256 = hashlib.sha256(file_handle.read()).hexdigest()

    return {
        "storage_backend": file_storage.backend_name,
        "storage_key": storage_key,
        "filename": os.path.basename(storage_key),
        "page_number": page,
        "mime_type": mime_type,
        "size": size,
        "sha256": sha256,
    }


def _store_job_output(
    job_id: str,
    kind: str,
    abs_path: str,
    page: int,
    mime_type: str,
) -> str:
    filename = os.path.basename(abs_path)
    key = f"jobs/{job_id}/{kind}/{page:03d}-{filename}"

    with open(abs_path, "rb") as file_handle:
        stored = file_storage.put_bytes(
            key=key,
            content=file_handle.read(),
            content_type=mime_type,
        )

    return stored.storage_key

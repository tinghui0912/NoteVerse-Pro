"""
Import artifact recorder for processing outputs.

This module records ImportArtifact ownership in the database after worker-side
pipeline steps complete.
"""

import hashlib
import mimetypes
import os
from typing import List

from app.db.models.import_job import ImportArtifactKind

from app.modules.import_jobs.artifact_records import ImportJobStoredArtifactItem
from app.modules.import_jobs.dispatch_service import ImportExecutionLease, require_current_attempt
from app.storage import object_storage
from app.modules.storage_objects.writes import write_object
from app.db.session import SessionLocal


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
    lease: ImportExecutionLease,
    kind: ImportArtifactKind,
    abs_paths: List[str],
) -> None:
    """
    Write and adopt Import artifacts for the current execution lease.

    Args:
        lease: Current authorized Import execution attempt.
        kind: Typed Import temporary-artifact identity.
        abs_paths: Absolute file paths to record.

    Storage format:
        Files are uploaded to the configured storage adapter and recorded as
        object keys under `jobs/{job_id}/{kind}/`.
    """
    from app.db.session import SessionLocal
    from app.modules.import_jobs.execution_recorder import import_execution_recorder

    if not isinstance(kind, ImportArtifactKind):
        raise TypeError("Import artifact mutation requires ImportArtifactKind")
    with SessionLocal() as db:
        require_current_attempt(db, lease)
        db.commit()
    items: List[ImportJobStoredArtifactItem] = [
        _build_file_item(lease.job_uuid, kind, p, i + 1) for i, p in enumerate(abs_paths)
    ]

    with SessionLocal() as db:
        import_execution_recorder.replace_artifacts(db, lease, kind, items)
        db.commit()


def _build_file_item(
    job_id: str,
    kind: ImportArtifactKind,
    abs_path: str,
    page: int,
) -> ImportJobStoredArtifactItem:
    if not isinstance(kind, ImportArtifactKind):
        raise TypeError("Import artifact mutation requires ImportArtifactKind")
    mime_type = _guess_mime_type(abs_path)
    with open(abs_path, "rb") as file_handle:
        content = file_handle.read()
    sha256 = hashlib.sha256(content).hexdigest()
    filename = f"{page:03d}-{os.path.basename(abs_path)}"
    storage_key = f"jobs/{job_id}/{kind.value}/{sha256}/{filename}"
    with SessionLocal() as db:
        written = write_object(
            db, object_storage, key=storage_key, content=content, content_type=mime_type
        )
        db.commit()
    return {
        "write_intent_uuid": written.intent_uuid,
        "write_token": written.write_token,
        "filename": os.path.basename(storage_key),
        "page_number": page,
    }

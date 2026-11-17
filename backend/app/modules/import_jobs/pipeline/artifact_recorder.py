"""
Import artifact recorder for processing outputs.

This module records ImportArtifact ownership in the database after worker-side
pipeline steps complete.
"""

import hashlib
from typing import List

from app.db.models.import_job import ImportArtifactKind

from app.modules.import_jobs.artifact_records import (
    ImportJobStoredArtifactItem,
    REVIEW_MUSICXML_MIME_TYPE,
)
from app.modules.import_jobs.object_keys import review_musicxml_object_key
from app.modules.import_jobs.dispatch_service import ImportExecutionLease, require_current_attempt
from app.storage import object_storage
from app.modules.storage_objects.writes import write_object
from app.db.session import SessionLocal


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

    Review MusicXML uses its Import-owned content-addressed identity.
    """
    from app.modules.import_jobs.execution_recorder import import_execution_recorder

    if not isinstance(kind, ImportArtifactKind):
        raise TypeError("Import artifact mutation requires ImportArtifactKind")
    if len(abs_paths) != 1:
        raise ValueError("Review MusicXML recording requires exactly one file")
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
    with open(abs_path, "rb") as file_handle:
        content = file_handle.read()
    sha256 = hashlib.sha256(content).hexdigest()
    storage_key = review_musicxml_object_key(job_uuid=job_id, content_sha256=sha256)
    with SessionLocal() as db:
        written = write_object(
            db,
            object_storage,
            key=storage_key,
            content=content,
            content_type=REVIEW_MUSICXML_MIME_TYPE,
        )
        db.commit()
    return {
        "write_intent_uuid": written.intent_uuid,
        "write_token": written.write_token,
        "filename": storage_key.rsplit("/", 1)[-1],
        "page_number": page,
    }

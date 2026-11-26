"""Durable review-artifact writes and execution-lease-bound semantic adoption."""

import hashlib
from pathlib import Path
from app.modules.import_jobs.domain import ImportArtifactKind
from app.modules.import_jobs.artifact_records import (
    ImportJobStoredArtifactItem,
    REVIEW_MUSICXML_MIME_TYPE,
)
from app.modules.import_jobs.object_keys import review_musicxml_object_key
from app.modules.import_jobs.dispatch_service import ImportExecutionLease, require_current_attempt
from app.modules.import_jobs.execution_recorder import ImportExecutionRecorder
from app.modules.media_storage.write_coordinator import ObjectWriteCoordinator, SessionFactory


class ImportArtifactRecorder:
    def __init__(
        self,
        writes: ObjectWriteCoordinator,
        sessions: SessionFactory,
        recorder: ImportExecutionRecorder,
    ) -> None:
        self.writes, self.sessions, self.recorder = writes, sessions, recorder

    def replace_files(
        self, lease: ImportExecutionLease, kind: ImportArtifactKind, abs_paths: list[str]
    ) -> None:
        if not isinstance(kind, ImportArtifactKind):
            raise TypeError("Import artifact mutation requires ImportArtifactKind")
        if len(abs_paths) != 1:
            raise ValueError("Review MusicXML recording requires exactly one file")
        with self.sessions() as db:
            require_current_attempt(db, lease)
        items = [
            self.prepare_file_item(lease.job_uuid, kind, path, i + 1)
            for i, path in enumerate(abs_paths)
        ]
        with self.sessions() as db:
            self.recorder.replace_artifacts(db, lease, kind, items)
            db.commit()

    def prepare_file_item(
        self, job_id: str, kind: ImportArtifactKind, abs_path: str, page: int
    ) -> ImportJobStoredArtifactItem:
        if not isinstance(kind, ImportArtifactKind):
            raise TypeError("Import artifact mutation requires ImportArtifactKind")
        content = Path(abs_path).read_bytes()
        key = review_musicxml_object_key(
            job_uuid=job_id, content_sha256=hashlib.sha256(content).hexdigest()
        )
        receipt = self.writes.write_bytes(
            key=key, content=content, content_type=REVIEW_MUSICXML_MIME_TYPE
        )
        return {
            "write_intent_uuid": receipt.intent_uuid,
            "write_token": receipt.write_token,
            "filename": key.rsplit("/", 1)[-1],
            "page_number": page,
        }

from __future__ import annotations

import hashlib
import os
import tempfile
import uuid

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.model_utils import require_persisted_id
from app.db.models import ImportArtifact, StorageUsageCategory
from app.modules.import_jobs.repository import SyncImportJobRepository
from app.modules.storage_usage.service import storage_usage_service
from app.processing.engines.render import create_score_render_engine
from app.shared.file_kinds import FileKind
from app.storage import FileStorage, file_storage


class ReviewThumbnailService:
    def __init__(
        self,
        repository: SyncImportJobRepository | None = None,
        storage: FileStorage | None = None,
    ) -> None:
        self.repository = repository or SyncImportJobRepository()
        self.storage = storage or file_storage

    def render(
        self,
        db: Session,
        job_uuid: str,
        *,
        expected_source_fingerprint: str | None = None,
    ) -> str | None:
        job = self.repository.get_by_uuid(db, job_uuid)
        if not job:
            raise RuntimeError(f"Import job {job_uuid} no longer exists")
        job_id = require_persisted_id(job.id, entity="import job")
        review_xml = (
            db.query(ImportArtifact)
            .filter_by(job_id=job_id, kind=FileKind.REVIEW_MUSICXML.value)
            .one_or_none()
        )
        if review_xml is None:
            raise RuntimeError(f"Review MusicXML for {job_uuid} is unavailable")
        if (
            expected_source_fingerprint is not None
            and review_xml.sha256 != expected_source_fingerprint
        ):
            return None

        previous = (
            db.query(ImportArtifact)
            .filter_by(job_id=job_id, kind=FileKind.RESULT_THUMBNAIL.value)
            .all()
        )
        previous_usage = [
            (item.artifact_uuid, item.storage_key, item.size_bytes or 0)
            for item in previous
        ]
        uploaded_key: str | None = None
        os.makedirs(settings.WORK_ROOT, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=settings.WORK_ROOT) as work_dir:
            xml_path = os.path.join(work_dir, "score.musicxml")
            with open(xml_path, "wb") as target:
                target.write(self.storage.read_bytes(review_xml.storage_key))
            engine = create_score_render_engine(output_folder=work_dir)
            result = engine.render_score(xml_path=xml_path, output_name="thumbnail")
            if not result["success"] or not result.get("files"):
                raise RuntimeError(f"Review thumbnail renderer produced no output for {job_uuid}")

            output = result["files"][0]
            path = output["path"]
            with open(path, "rb") as source:
                content = source.read()
            extension = os.path.splitext(path)[1] or ".svg"
            artifact_uuid = str(uuid.uuid4())
            key = (
                f"jobs/{job_uuid}/{FileKind.RESULT_THUMBNAIL.value}/"
                f"001-{artifact_uuid}{extension}"
            )
            stored = self.storage.put_bytes(
                key=key,
                content=content,
                content_type=output["mime_type"],
            )
            uploaded_key = stored.storage_key
            thumbnail = ImportArtifact(
                artifact_uuid=artifact_uuid,
                job_id=job_id,
                kind=FileKind.RESULT_THUMBNAIL.value,
                storage_backend=self.storage.backend_name,
                storage_key=stored.storage_key,
                filename=stored.filename,
                page_number=1,
                size_bytes=stored.size_bytes,
                mime_type=output["mime_type"],
                sha256=hashlib.sha256(content).hexdigest(),
            )

        try:
            for item in previous:
                db.delete(item)
            db.flush()
            db.add(thumbnail)
            db.commit()
        except Exception:
            db.rollback()
            if uploaded_key:
                try:
                    self.storage.delete(uploaded_key)
                except Exception:
                    pass
            raise

        for artifact_uuid, storage_key, size_bytes in previous_usage:
            storage_usage_service.record_release_sync(
                db,
                user_id=job.user_id,
                category=StorageUsageCategory.TEMP_IMPORT,
                bytes_count=size_bytes,
                reason="review_thumbnail_replaced",
                object_type="import_artifact",
                object_id=artifact_uuid,
                storage_key=storage_key,
            )
        storage_usage_service.record_allocation_sync(
            db,
            user_id=job.user_id,
            category=StorageUsageCategory.TEMP_IMPORT,
            bytes_count=thumbnail.size_bytes or 0,
            reason="review_thumbnail_created",
            object_type="import_artifact",
            object_id=thumbnail.artifact_uuid,
            storage_key=thumbnail.storage_key,
        )

        for item in previous:
            try:
                self.storage.delete(item.storage_key)
            except Exception:
                pass
        return thumbnail.artifact_uuid


review_thumbnail_service = ReviewThumbnailService()

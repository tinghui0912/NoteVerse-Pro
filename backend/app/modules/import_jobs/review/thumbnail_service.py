from __future__ import annotations
from app.modules.storage_objects.reads import StoredObjectReadTarget, read_admitted_bytes
from app.modules.storage_objects.retirement import retire_after_release
from app.modules.storage_objects.writes import write_object, adopt_written_object

import os
import tempfile
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.model_utils import require_persisted_id
from app.db.models import ImportArtifact, StorageUsageCategory, StoredObject
from app.modules.import_jobs.repository import ImportJobRepository
from app.modules.storage_usage.service import storage_usage_service
from app.processing.engines.render import create_score_render_engine
from app.modules.import_jobs.artifact_kinds import ImportArtifactKind
from app.db.models.import_job import ImportJobState
from app.modules.durable_work.delivery import DeliveryAttemptLease, StaleDeliveryAttempt
from app.modules.score_assets.render_outbox_service import render_outbox_service
from app.modules.revisions.presentation_demand import RevisionPresentationSuperseded
from app.storage import ObjectStorage, object_storage


class ImportReviewThumbnailService:
    def __init__(
        self,
        repository: ImportJobRepository | None = None,
        storage: ObjectStorage | None = None,
    ) -> None:
        self.repository = repository or ImportJobRepository()
        self.storage = storage or object_storage

    def render(
        self,
        db: Session,
        job_uuid: str,
        *,
        expected_source_fingerprint: str,
        outbox_uuid: str,
        lease: DeliveryAttemptLease,
        profile: str,
    ) -> str | None:
        job = self.repository.get_by_uuid(db, job_uuid)
        if not job:
            raise RuntimeError(f"Import job {job_uuid} no longer exists")
        job_id = require_persisted_id(job.id, entity="import job")
        review_xml = db.execute(
            select(ImportArtifact).where(
                ImportArtifact.job_id == job_id,
                ImportArtifact.kind == ImportArtifactKind.REVIEW_MUSICXML.value,
            )
        ).scalar_one_or_none()
        if review_xml is None:
            raise RuntimeError(f"Review MusicXML for {job_uuid} is unavailable")
        if review_xml.stored_object.sha256 != expected_source_fingerprint:
            raise RevisionPresentationSuperseded()

        os.makedirs(settings.WORK_ROOT, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=settings.WORK_ROOT) as work_dir:
            xml_path = os.path.join(work_dir, "score.musicxml")
            with open(xml_path, "wb") as target:
                target.write(
                    read_admitted_bytes(
                        self.storage, StoredObjectReadTarget.from_object(review_xml.stored_object)
                    )
                )
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
                f"jobs/{job_uuid}/{ImportArtifactKind.REVIEW_PREVIEW_IMAGE.value}/"
                f"001-{artifact_uuid}{extension}"
            )
            stored = write_object(
                db,
                self.storage,
                key=key,
                content=content,
                content_type=output["mime_type"],
            )
        job = db.execute(
            select(type(job))
            .where(type(job).id == job_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one()
        render_outbox_service.require_thumbnail_attempt(
            db,
            outbox_uuid=outbox_uuid,
            lease=lease,
            job_id=job_id,
            source_fingerprint=expected_source_fingerprint,
            profile=profile,
        )
        current_xml = db.execute(
            select(ImportArtifact)
            .join(StoredObject, ImportArtifact.stored_object_id == StoredObject.id)
            .where(
                ImportArtifact.job_id == job_id,
                ImportArtifact.kind == ImportArtifactKind.REVIEW_MUSICXML.value,
                StoredObject.sha256 == expected_source_fingerprint,
            )
        ).scalar_one_or_none()
        if job.state != ImportJobState.PENDING_REVIEW or current_xml is None:
            raise RevisionPresentationSuperseded()
        thumbnail = ImportArtifact(
            artifact_uuid=artifact_uuid,
            job_id=job_id,
            kind=ImportArtifactKind.REVIEW_PREVIEW_IMAGE.value,
            stored_object=adopt_written_object(db, stored),
            filename=stored.object_key.rsplit("/", 1)[-1],
            page_number=1,
        )

        previous = list(
            db.execute(
                select(ImportArtifact).where(
                    ImportArtifact.job_id == job_id,
                    ImportArtifact.kind == ImportArtifactKind.REVIEW_PREVIEW_IMAGE.value,
                )
            ).scalars()
        )
        previous_usage = [
            (item.artifact_uuid, item.stored_object.object_key, item.stored_object.byte_size or 0)
            for item in previous
        ]
        try:
            for item in previous:
                db.delete(item)
                retire_after_release(db, item.stored_object_id)
            db.flush()
            db.add(thumbnail)
            for artifact_uuid, storage_key, size_bytes in previous_usage:
                storage_usage_service.record_release(
                    db,
                    user_id=job.user_id,
                    category=StorageUsageCategory.TEMP_IMPORT,
                    bytes_count=size_bytes,
                    reason="review_thumbnail_replaced",
                    object_type="import_artifact",
                    object_id=artifact_uuid,
                    storage_key=storage_key,
                )
            storage_usage_service.record_allocation(
                db,
                user_id=job.user_id,
                category=StorageUsageCategory.TEMP_IMPORT,
                bytes_count=thumbnail.stored_object.byte_size or 0,
                reason="review_thumbnail_created",
                object_type="import_artifact",
                object_id=thumbnail.artifact_uuid,
                storage_key=thumbnail.stored_object.object_key,
            )
            if not render_outbox_service.complete(db, outbox_uuid, lease=lease):
                raise StaleDeliveryAttempt("Thumbnail completion lost execution ownership")
            db.flush()
        except Exception:
            db.rollback()
            raise

        return thumbnail.artifact_uuid


import_review_thumbnail_service = ImportReviewThumbnailService()

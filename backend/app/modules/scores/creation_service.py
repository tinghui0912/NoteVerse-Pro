from __future__ import annotations
from app.modules.storage_objects.writes import write_object, adopt_written_object

import hashlib
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.model_utils import require_persisted_id
from app.db.models import (
    ImportJob,
    Score,
    ScoreRevision,
    ScoreRevisionMetadata,
    ScoreRevisionSource,
    StorageUsageCategory,
)
from app.db.models.score import MetadataStatus, RevisionOrigin, RevisionSourceFormat
from app.storage import ObjectStorage, object_storage
from app.modules.metadata.service import rebuild_metadata_sync
from app.modules.revisions.derivatives import revision_derivative_service
from app.modules.scores.genres import ordered_unique_genres
from app.modules.storage_usage.service import storage_usage_service
from app.processing.musicxml.admission import admit_musicxml_document
from app.utils.timezone import utc_now_naive


class SyncConfirmedScoreCreationService:
    """Create the stable score aggregate exactly once after review is confirmed."""

    def __init__(self, storage: ObjectStorage | None = None) -> None:
        self.storage = storage or object_storage

    def create_confirmed_from_job(
        self,
        db: Session,
        job_uuid: str,
        musicxml_path: str,
        *,
        title: str | None = None,
        genres: list[str] | None = None,
    ) -> str:
        job = db.execute(
            select(ImportJob).where(ImportJob.job_uuid == job_uuid).with_for_update()
        ).scalar_one_or_none()
        if not job:
            raise ValueError(f"Import job {job_uuid} not found")
        if job.score_id is not None:
            existing = db.get(Score, job.score_id)
            if existing:
                return existing.score_uuid

        with open(musicxml_path, "rb") as source:
            content = source.read()
        content = admit_musicxml_document(content)
        score_uuid = str(uuid.uuid4())
        revision_uuid = str(uuid.uuid4())
        storage_key = f"scores/{score_uuid}/revisions/{revision_uuid}/score.musicxml"
        content_hash = hashlib.sha256(content).hexdigest()
        reservation = storage_usage_service.reserve_sync(
            db,
            user_id=job.user_id,
            category=StorageUsageCategory.SOURCE,
            bytes_count=len(content),
            reason="review_confirm_worker",
            object_type="score_revision_source",
        )
        try:
            stored = write_object(
                db,
                self.storage,
                key=storage_key,
                content=content,
                content_type="application/vnd.recordare.musicxml+xml",
            )
        except Exception:
            storage_usage_service.release_reservation_sync(db, reservation.reservation_id)
            raise

        job = db.execute(
            select(ImportJob)
            .where(ImportJob.job_uuid == job_uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one()
        if job.score_id is not None:
            existing = db.get(Score, job.score_id)
            if existing is not None:
                return existing.score_uuid
        business_committed = False
        try:
            now = utc_now_naive()
            score = Score(
                score_uuid=score_uuid,
                owner_user_id=job.user_id,
                title=(title or "Untitled score").strip(),
                genres=ordered_unique_genres(genres or []),
                originating_job_id=require_persisted_id(job.id, entity="import job"),
                created_at=now,
                updated_at=now,
            )
            db.add(score)
            db.flush()
            score_id = require_persisted_id(score.id, entity="score")
            revision = ScoreRevision(
                revision_uuid=revision_uuid,
                score_id=score_id,
                revision_number=1,
                content_hash=content_hash,
                idempotency_key=f"job:{job_uuid}",
                origin=RevisionOrigin.OMR,
                created_by_user_id=job.user_id,
                created_by_job_id=require_persisted_id(job.id, entity="import job"),
                created_at=now,
            )
            db.add(revision)
            db.flush()
            revision_id = require_persisted_id(revision.id, entity="score revision")
            source_uuid = str(uuid.uuid4())
            db.add(
                ScoreRevisionSource(
                    source_uuid=source_uuid,
                    revision_id=revision_id,
                    format=RevisionSourceFormat.MUSICXML,
                    stored_object=adopt_written_object(db, stored),
                    filename=stored.object_key.rsplit("/", 1)[-1],
                    generator="omr-pipeline",
                    generator_version="1",
                    created_at=now,
                )
            )
            db.add(
                ScoreRevisionMetadata(
                    revision_id=revision_id,
                    status=MetadataStatus.PENDING,
                    extractor_version="pending",
                )
            )
            derivative_work = revision_derivative_service.enqueue_sync(
                db,
                score_id=score_id,
                revision_id=revision_id,
                requested_by_user_id=job.user_id,
                source_fingerprint=content_hash,
            )
            score.head_revision_id = revision_id
            job.score_id = score_id
            job.updated_at = now
            storage_usage_service.commit_reservation_sync(
                db,
                reservation.reservation_id,
                object_type="score_revision_source",
                object_id=source_uuid,
                storage_key=stored.object_key,
                auto_commit=False,
            )
            db.commit()
            business_committed = True
            revision_derivative_service.dispatch_after_commit_sync(derivative_work)

            try:
                rebuild_metadata_sync(db, revision_id, self.storage)
            except Exception:
                # Projection failures never invalidate the immutable revision.
                db.rollback()
            return score_uuid
        except Exception:
            db.rollback()
            if not business_committed:
                storage_usage_service.release_reservation_sync(db, reservation.reservation_id)
            raise


sync_confirmed_score_creation_service = SyncConfirmedScoreCreationService()

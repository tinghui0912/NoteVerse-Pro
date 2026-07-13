from __future__ import annotations

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
    ScoreTaxonomyTag,
    TaxonomyCategory,
    TaxonomyTag,
)
from app.db.models.score import MetadataStatus, RevisionOrigin, RevisionSourceFormat
from app.storage import FileStorage, file_storage
from app.modules.metadata.service import rebuild_metadata_sync
from app.modules.scores.taxonomy import TAXONOMY_SORT_ORDER, ordered_unique_pairs
from app.modules.storage_usage.service import storage_usage_service
from app.utils.timezone import utc_now_naive


class SyncConfirmedScoreCreationService:
    """Create the stable score aggregate exactly once after review is confirmed."""

    def __init__(self, storage: FileStorage | None = None) -> None:
        self.storage = storage or file_storage

    def create_confirmed_from_job(
        self,
        db: Session,
        job_uuid: str,
        musicxml_path: str,
        *,
        title: str | None = None,
        taxonomy_tags: list[tuple[str, str]] | None = None,
    ) -> str:
        job = db.execute(
            select(ImportJob)
            .where(ImportJob.job_uuid == job_uuid)
            .with_for_update()
        ).scalar_one_or_none()
        if not job:
            raise ValueError(f"Import job {job_uuid} not found")
        if job.score_id is not None:
            existing = db.get(Score, job.score_id)
            if existing:
                return existing.score_uuid

        with open(musicxml_path, "rb") as source:
            content = source.read()
        if not content.strip():
            raise ValueError("Canonical MusicXML is empty")

        score_uuid = str(uuid.uuid4())
        revision_uuid = str(uuid.uuid4())
        storage_key = (
            f"scores/{score_uuid}/revisions/{revision_uuid}/score.musicxml"
        )
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
            stored = self.storage.put_bytes(
                key=storage_key,
                content=content,
                content_type="application/vnd.recordare.musicxml+xml",
            )
        except Exception:
            storage_usage_service.release_reservation_sync(db, reservation.reservation_id)
            raise

        business_committed = False
        try:
            now = utc_now_naive()
            score = Score(
                score_uuid=score_uuid,
                owner_user_id=job.user_id,
                title=(title or "Untitled score").strip(),
                originating_job_id=require_persisted_id(job.id, entity="import job"),
                created_at=now,
                updated_at=now,
            )
            db.add(score)
            db.flush()
            score_id = require_persisted_id(score.id, entity="score")
            normalized_tags = ordered_unique_pairs(taxonomy_tags or [])
            if normalized_tags:
                tag_rows = (
                    db.query(TaxonomyCategory.code, TaxonomyTag.code, TaxonomyTag.id)
                    .join(TaxonomyCategory, TaxonomyTag.category_id == TaxonomyCategory.id)
                    .filter(TaxonomyCategory.is_active.is_(True), TaxonomyTag.is_active.is_(True))
                    .all()
                )
                tag_ids = {
                    (category, code): tag_id
                    for category, code, tag_id in tag_rows
                }
                missing = [
                    f"{category}:{code}"
                    for category, code in normalized_tags
                    if (category, code) not in tag_ids
                ]
                if missing:
                    raise ValueError(f"Taxonomy tags are not seeded: {', '.join(missing)}")
                for category, code in sorted(
                    normalized_tags, key=lambda item: TAXONOMY_SORT_ORDER[item]
                ):
                    db.add(
                        ScoreTaxonomyTag(
                            score_id=score_id,
                            tag_id=tag_ids[(category, code)],
                            source="USER",
                        )
                    )
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
                    storage_backend=self.storage.backend_name,
                    storage_key=stored.storage_key,
                    filename=stored.filename,
                    mime_type="application/vnd.recordare.musicxml+xml",
                    size_bytes=stored.size_bytes,
                    sha256=content_hash,
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
            score.head_revision_id = revision_id
            job.score_id = score_id
            job.updated_at = now
            db.commit()
            business_committed = True
            storage_usage_service.commit_reservation_sync(
                db,
                reservation.reservation_id,
                object_type="score_revision_source",
                object_id=source_uuid,
                storage_key=stored.storage_key,
            )
            try:
                rebuild_metadata_sync(db, revision_id, self.storage)
            except Exception:
                # Projection failures never invalidate the immutable revision.
                db.rollback()
            return score_uuid
        except Exception:
            db.rollback()
            if not business_committed:
                try:
                    self.storage.delete(stored.storage_key)
                except Exception:
                    pass
                storage_usage_service.release_reservation_sync(db, reservation.reservation_id)
            raise


sync_confirmed_score_creation_service = SyncConfirmedScoreCreationService()

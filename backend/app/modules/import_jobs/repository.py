from __future__ import annotations
from app.modules.storage_objects.retirement import retire_after_release

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.engine import RowMapping

from app.db.models.import_job import ImportArtifactKind

from app.db.models import (
    ExecutionManifest,
    ImportArtifact,
    ImportJob,
    ImportJobStep,
    ImportJobUpload,
    Score,
    ScoreInputAsset,
    StoredObject,
    Upload,
)

job_uuid_col = ImportJob.__table__.c.job_uuid
job_created_col = ImportJob.__table__.c.created_at


class ImportJobRepository:
    def list_for_user(
        self,
        db: Session,
        user_id: int,
        *,
        page: int,
        page_size: int,
    ) -> tuple[list[ImportJob], int]:
        total = int(
            (
                db.execute(select(func.count(ImportJob.id)).where(ImportJob.user_id == user_id))
            ).scalar_one()
        )
        rows = db.execute(
            select(ImportJob)
            .where(ImportJob.user_id == user_id)
            .order_by(job_created_col.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(rows.scalars().all()), total

    def get_by_uuid(self, db: Session, job_uuid: str) -> ImportJob | None:
        result = db.execute(select(ImportJob).where(ImportJob.job_uuid == job_uuid))
        return result.scalars().first()

    def batch_status(
        self,
        db: Session,
        job_uuids: list[str],
        user_id: int,
    ) -> list[ImportJob]:
        result = db.execute(
            select(ImportJob).where(
                ImportJob.user_id == user_id,
                job_uuid_col.in_(job_uuids),
            )
        )
        return list(result.scalars().all())

    def artifact_by_uuid(self, db: Session, artifact_uuid: str) -> ImportArtifact | None:
        return (
            db.execute(select(ImportArtifact).where(ImportArtifact.artifact_uuid == artifact_uuid))
        ).scalar_one_or_none()

    def get_by_idempotency_key(self, db: Session, user_id: int, key: str) -> ImportJob | None:
        return (
            db.execute(
                select(ImportJob).where(
                    ImportJob.user_id == user_id,
                    ImportJob.idempotency_key == key,
                )
            )
        ).scalar_one_or_none()

    def submission_uploads(self, db: Session, upload_ids: list[str]) -> list[RowMapping]:
        return list(
            (
                db.execute(
                    select(Upload.id, Upload.upload_uuid, Upload.uploader_user_id)
                    .join(StoredObject, Upload.stored_object_id == StoredObject.id)
                    .where(Upload.__table__.c.upload_uuid.in_(upload_ids))
                )
            )
            .mappings()
            .all()
        )

    def live_scores_for_import_jobs(self, db: Session, job_ids: set[int]) -> dict[int, Score]:
        if not job_ids:
            return {}
        return {
            score.created_from_import_job_id: score
            for score in db.scalars(
                select(Score).where(
                    Score.created_from_import_job_id.in_(job_ids), Score.deleted_at.is_(None)
                )
            )
            if score.created_from_import_job_id is not None
        }

    def execution_manifest_digests(self, db: Session, manifest_ids: set[int]) -> dict[int, str]:
        if not manifest_ids:
            return {}
        return dict(
            (
                db.execute(
                    select(ExecutionManifest.id, ExecutionManifest.sha256).where(
                        ExecutionManifest.__table__.c.id.in_(manifest_ids)
                    )
                )
            ).all()
        )

    def uploads_for_jobs(self, db: Session, job_ids: list[int]) -> list[RowMapping]:
        return list(
            (
                db.execute(
                    select(
                        ImportJobUpload.job_id,
                        ImportJobUpload.page_number,
                        Upload.__table__.c.id.label("upload_row_id"),
                        Upload.upload_uuid,
                        Upload.original_filename,
                        StoredObject.byte_size,
                        StoredObject.content_type,
                    )
                    .join(Upload, ImportJobUpload.upload_id == Upload.id)
                    .join(StoredObject, Upload.stored_object_id == StoredObject.id)
                    .where(ImportJobUpload.__table__.c.job_id.in_(job_ids))
                    .order_by(
                        ImportJobUpload.__table__.c.sort_order.asc(),
                        ImportJobUpload.__table__.c.id.asc(),
                    )
                )
            )
            .mappings()
            .all()
        )

    @staticmethod
    def get_step(db: Session, job_id: int, name: str) -> ImportJobStep | None:
        return db.execute(
            select(ImportJobStep).where(
                ImportJobStep.job_id == job_id,
                ImportJobStep.name == name,
            )
        ).scalar_one_or_none()

    @staticmethod
    def list_artifacts(db: Session, job_id: int) -> list[ImportArtifact]:
        return list(
            db.execute(select(ImportArtifact).where(ImportArtifact.job_id == job_id)).scalars()
        )

    @staticmethod
    def delete_artifacts_by_kind(db: Session, job_id: int, kind: ImportArtifactKind) -> None:
        rows = list(
            db.scalars(
                select(ImportArtifact).where(
                    ImportArtifact.job_id == job_id, ImportArtifact.kind == kind
                )
            )
        )
        for row in rows:
            db.delete(row)
            retire_after_release(db, row.stored_object_id)
        db.flush()

    @staticmethod
    def list_orphan_uploads(db: Session, cutoff: datetime) -> list[Upload]:
        job_link_id = ImportJobUpload.__table__.c.id
        input_asset_id = ScoreInputAsset.__table__.c.id
        return list(
            db.execute(
                select(Upload)
                .outerjoin(ImportJobUpload, Upload.id == ImportJobUpload.upload_id)
                .outerjoin(ScoreInputAsset, Upload.id == ScoreInputAsset.upload_id)
                .where(
                    job_link_id.is_(None),
                    input_asset_id.is_(None),
                    Upload.created_at < cutoff,
                )
            ).scalars()
        )

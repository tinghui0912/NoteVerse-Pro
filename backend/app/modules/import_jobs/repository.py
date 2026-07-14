from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.db.models import (
    ImportArtifact,
    ImportJob,
    ImportJobStep,
    ImportJobUpload,
    Score,
    ScoreInputAsset,
    StorageBlob,
    Upload,
)
job_uuid_col = ImportJob.__table__.c.job_uuid
job_created_col = ImportJob.__table__.c.created_at


class ImportJobRepository:
    async def list_for_user(
        self,
        db: AsyncSession,
        user_id: int,
        *,
        page: int,
        page_size: int,
    ) -> tuple[list[ImportJob], int]:
        total = int(
            (
                await db.execute(
                    select(func.count(ImportJob.id)).where(
                        ImportJob.user_id == user_id
                    )
                )
            ).scalar_one()
        )
        rows = await db.execute(
            select(ImportJob)
            .where(ImportJob.user_id == user_id)
            .order_by(job_created_col.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(rows.scalars().all()), total
    async def get_by_uuid(self, db: AsyncSession, job_uuid: str) -> ImportJob | None:
        result = await db.execute(
            select(ImportJob).where(ImportJob.job_uuid == job_uuid)
        )
        return result.scalars().first()

    async def batch_status(
        self,
        db: AsyncSession,
        job_uuids: list[str],
        user_id: int,
    ) -> list[ImportJob]:
        result = await db.execute(
            select(ImportJob).where(
                ImportJob.user_id == user_id,
                job_uuid_col.in_(job_uuids),
            )
        )
        return list(result.scalars().all())

    async def artifact_by_uuid(
        self, db: AsyncSession, artifact_uuid: str
    ) -> ImportArtifact | None:
        return (
            await db.execute(
                select(ImportArtifact).where(
                    ImportArtifact.artifact_uuid == artifact_uuid
                )
            )
        ).scalar_one_or_none()


class SyncImportJobRepository:
    @staticmethod
    def get_by_uuid(db: Session, job_uuid: str) -> ImportJob | None:
        return db.query(ImportJob).filter_by(job_uuid=job_uuid).first()

    @staticmethod
    def get_by_idempotency_key(
        db: Session,
        user_id: int,
        idempotency_key: str,
    ) -> ImportJob | None:
        return (
            db.query(ImportJob)
            .filter_by(user_id=user_id, idempotency_key=idempotency_key)
            .first()
        )

    @staticmethod
    def get_step(db: Session, job_id: int, name: str) -> ImportJobStep | None:
        return db.query(ImportJobStep).filter_by(job_id=job_id, name=name).first()

    @staticmethod
    def list_steps(db: Session, job_id: int) -> list[ImportJobStep]:
        return (
            db.query(ImportJobStep)
            .filter_by(job_id=job_id)
            .order_by(ImportJobStep.step_order)
            .all()
        )

    @staticmethod
    def list_artifacts(db: Session, job_id: int) -> list[ImportArtifact]:
        return db.query(ImportArtifact).filter_by(job_id=job_id).all()

    @staticmethod
    def delete_artifacts_by_kind(db: Session, job_id: int, kind: str) -> None:
        db.query(ImportArtifact).filter_by(job_id=job_id, kind=kind).delete()

    @staticmethod
    def get_upload_by_uuid(db: Session, upload_uuid: str) -> Upload | None:
        return db.query(Upload).filter_by(upload_uuid=upload_uuid).first()

    @staticmethod
    def get_job_upload(
        db: Session,
        job_id: int,
        upload_id: int,
    ) -> ImportJobUpload | None:
        return (
            db.query(ImportJobUpload)
            .filter_by(job_id=job_id, upload_id=upload_id)
            .first()
        )

    @staticmethod
    def list_upload_rows(
        db: Session,
        job_id: int,
    ) -> list[tuple[ImportJobUpload, Upload, StorageBlob]]:
        return (
            db.query(ImportJobUpload, Upload, StorageBlob)
            .join(Upload, ImportJobUpload.upload_id == Upload.id)
            .join(StorageBlob, Upload.blob_id == StorageBlob.id)
            .filter(ImportJobUpload.job_id == job_id)
            .order_by(ImportJobUpload.sort_order.asc(), ImportJobUpload.id.asc())
            .all()
        )

    @staticmethod
    def get_score_uuid(db: Session, score_id: int | None) -> str | None:
        if score_id is None:
            return None
        score = db.query(Score).filter_by(id=score_id).first()
        return score.score_uuid if score else None

    @staticmethod
    def list_orphan_uploads(db: Session, cutoff: datetime) -> list[Upload]:
        job_link_id = ImportJobUpload.__table__.c.id
        input_asset_id = ScoreInputAsset.__table__.c.id
        return (
            db.query(Upload)
            .outerjoin(ImportJobUpload, Upload.id == ImportJobUpload.upload_id)
            .outerjoin(ScoreInputAsset, Upload.id == ScoreInputAsset.upload_id)
            .filter(job_link_id.is_(None))
            .filter(input_asset_id.is_(None))
            .filter(Upload.created_at < cutoff)
            .all()
        )
